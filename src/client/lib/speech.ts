// Read-aloud engine. One controller for the whole app, so only one text is spoken at a time and
// every read-aloud control shows the true state of playback.
//
// Why the earlier version failed: it set only `utterance.lang` and never chose a voice. Where the
// device has no voice for that language (Chrome on Windows has none for Kannada, Tamil, Telugu or
// Bengali; many Android phones have not downloaded them), the browser reads with its default
// voice, usually English, so Indic text came out silent or as noise while the button said
// "Stop reading". Long texts were also spoken as one utterance, which Chrome cuts off after about
// 15 seconds, and the button switched to "playing" before any speech had started.
//
// Now: voices are loaded asynchronously, a voice is chosen only within the requested language
// (exact locale first, then the same language in another region), long text is split into
// sentences and queued, and "playing" is shown only after the engine reports that speech
// started. When no voice exists for the language, the server voice is used if the deployment has
// one configured; otherwise the control says plainly that this device has no voice for it.

export type SpeechStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';
export type SpeechError = 'no-voice' | 'not-supported' | 'did-not-start' | 'failed' | 'server-failed';
export type SpeechEngine = 'device' | 'server';

export interface SpeechState {
  status: SpeechStatus;
  /** Which read-aloud control owns the current playback. */
  owner: string | null;
  locale: string | null;
  engine: SpeechEngine | null;
  voiceName: string | null;
  /** 0..1, by characters spoken where the engine reports it, otherwise by sentence. */
  progress: number;
  error: SpeechError | null;
}

export const RATES = [0.75, 1, 1.25] as const;

/** Minimal shapes of the browser APIs, so tests can supply fakes. */
export interface VoiceLike {
  lang: string;
  name: string;
  localService: boolean;
  default?: boolean;
  voiceURI?: string;
}
export interface UtteranceLike {
  text: string;
  lang: string;
  rate: number;
  voice: VoiceLike | null;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onboundary: ((e: { charIndex: number }) => void) | null;
}
export interface SynthLike {
  getVoices(): VoiceLike[];
  speak(u: UtteranceLike): void;
  cancel(): void;
  pause(): void;
  resume(): void;
  addEventListener?(type: 'voiceschanged', fn: () => void): void;
  removeEventListener?(type: 'voiceschanged', fn: () => void): void;
}
export interface AudioLike {
  src: string;
  playbackRate: number;
  currentTime: number;
  duration: number;
  paused: boolean;
  play(): Promise<void>;
  pause(): void;
  onended: (() => void) | null;
  onerror: (() => void) | null;
  ontimeupdate: (() => void) | null;
}
export interface SpeechEnv {
  synth: SynthLike | null;
  makeUtterance: ((text: string) => UtteranceLike) | null;
  /** Fetches server audio; resolves to an object URL, or null when the server has no voice. */
  fetchServerAudio: ((text: string, locale: string) => Promise<string | null>) | null;
  makeAudio: (() => AudioLike) | null;
  revokeUrl: (url: string) => void;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
}

const VOICE_WAIT_MS = 3000;
/** Remote (online) voices can take a few seconds to start; after this we say it did not start. */
const START_TIMEOUT_MS = 10000;
const MAX_CHUNK = 180;

const normalize = (lang: string) => lang.replace('_', '-').toLowerCase();
const primary = (lang: string) => normalize(lang).split('-')[0]!;

/**
 * Chooses a voice for a locale. Only voices of the same language are considered: an exact locale
 * match first (kn-IN), then the same language in another region (bn-BD for bn-IN). Within a group,
 * voices installed on the device come before online ones, and a device's default before others.
 * "Multilingual" voices are skipped: they are tuned for another primary language.
 */
export function pickVoice(voices: VoiceLike[], locale: string, preferredName?: string | null): VoiceLike | null {
  const want = normalize(locale);
  const lang = primary(locale);
  const sameLang = voices.filter((v) => primary(v.lang) === lang && !/multilingual/i.test(v.name));
  if (preferredName) {
    const chosen = sameLang.find((v) => v.name === preferredName);
    if (chosen) return chosen;
  }
  const rank = (v: VoiceLike) => (normalize(v.lang) === want ? 0 : 2) + (v.localService ? 0 : 1) - (v.default ? 0.5 : 0);
  return [...sameLang].sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

/** Voices a person can choose from for a locale (same language only). */
export function voicesFor(voices: VoiceLike[], locale: string): VoiceLike[] {
  const lang = primary(locale);
  return voices.filter((v) => primary(v.lang) === lang && !/multilingual/i.test(v.name));
}

/**
 * Splits text into pieces short enough for every engine, at sentence ends (including the Devanagari
 * and Bengali danda), then at commas, then at spaces. Never splits inside a word.
 */
export function chunkText(text: string, max = MAX_CHUNK): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  // A sentence ends at . ! ? or a danda followed by a space, so amounts like 3,716.68 stay whole
  const sentences = clean.split(/(?<=[.!?।॥])\s+/u);
  const out: string[] = [];
  const push = (piece: string) => {
    const p = piece.trim();
    if (p) out.push(p);
  };
  for (const sentence of sentences) {
    if (sentence.length <= max) {
      push(sentence);
      continue;
    }
    let current = '';
    for (const part of sentence.split(/(?<=[,;:])\s+/u)) {
      if ((current + ' ' + part).trim().length <= max) {
        current = (current + ' ' + part).trim();
        continue;
      }
      push(current);
      current = '';
      if (part.length <= max) {
        current = part;
        continue;
      }
      for (const word of part.split(' ')) {
        if ((current + ' ' + word).trim().length > max) {
          push(current);
          current = word;
        } else current = (current + ' ' + word).trim();
      }
    }
    push(current);
  }
  // Merge very short neighbours so speech does not stutter between tiny utterances
  const merged: string[] = [];
  for (const piece of out) {
    const last = merged[merged.length - 1];
    if (last && last.length + piece.length + 1 <= max && last.length < 40) merged[merged.length - 1] = `${last} ${piece}`;
    else merged.push(piece);
  }
  return merged;
}

const IDLE: SpeechState = { status: 'idle', owner: null, locale: null, engine: null, voiceName: null, progress: 0, error: null };

export class SpeechController {
  private state: SpeechState = IDLE;
  private listeners = new Set<(s: SpeechState) => void>();
  private voices: VoiceLike[] = [];
  private voicesReady: Promise<VoiceLike[]> | null = null;
  /** Increments on every start/stop, so callbacks from an older playback are ignored. */
  private run = 0;
  private chunks: string[] = [];
  private chunkIndex = 0;
  private startTimer: unknown = null;
  /** Kept referenced while queued: some browsers drop events of collected utterances. */
  private live: UtteranceLike[] = [];
  private audio: AudioLike | null = null;
  private audioUrl: string | null = null;
  private last: { owner: string; text: string; locale: string } | null = null;
  rate = 1;
  preferredVoice: Record<string, string> = {};

  constructor(private readonly env: SpeechEnv) {}

  get supported(): boolean {
    return Boolean((this.env.synth && this.env.makeUtterance) || this.env.fetchServerAudio);
  }

  getState(): SpeechState {
    return this.state;
  }

  subscribe(fn: (s: SpeechState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<SpeechState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state);
  }

  /** Resolves once the browser has listed its voices (they load asynchronously), or after a wait. */
  loadVoices(): Promise<VoiceLike[]> {
    const synth = this.env.synth;
    if (!synth) return Promise.resolve([]);
    const now = synth.getVoices();
    if (now.length) {
      this.voices = now;
      return Promise.resolve(now);
    }
    if (!this.voicesReady) {
      this.voicesReady = new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          synth.removeEventListener?.('voiceschanged', finish);
          this.voices = synth.getVoices();
          this.voicesReady = null;
          resolve(this.voices);
        };
        synth.addEventListener?.('voiceschanged', finish);
        this.env.setTimeout(finish, VOICE_WAIT_MS);
      });
    }
    return this.voicesReady;
  }

  availableVoices(locale: string): VoiceLike[] {
    return voicesFor(this.voices.length ? this.voices : (this.env.synth?.getVoices() ?? []), locale);
  }

  async play(owner: string, text: string, locale: string): Promise<void> {
    this.stop();
    const run = ++this.run;
    this.last = { owner, text, locale };
    this.chunks = chunkText(text);
    this.chunkIndex = 0;
    this.set({ status: 'loading', owner, locale, engine: null, voiceName: null, progress: 0, error: null });
    if (!this.chunks.length) return this.finish(run);

    const voices = await this.loadVoices();
    if (run !== this.run) return;
    const voice = this.env.synth && this.env.makeUtterance ? pickVoice(voices, locale, this.preferredVoice[locale]) : null;
    if (voice) {
      this.set({ engine: 'device', voiceName: voice.name });
      this.speakChunk(run, voice, locale);
      return;
    }
    if (this.env.fetchServerAudio && this.env.makeAudio) {
      this.set({ engine: 'server' });
      let url: string | null = null;
      try {
        url = await this.env.fetchServerAudio(text, locale);
      } catch {
        if (run === this.run) this.fail(run, 'server-failed');
        return;
      }
      if (run !== this.run) {
        if (url) this.env.revokeUrl(url);
        return;
      }
      if (url) return this.playAudio(run, url);
    }
    this.fail(run, this.env.synth ? 'no-voice' : 'not-supported');
  }

  private speakChunk(run: number, voice: VoiceLike, locale: string) {
    const synth = this.env.synth!;
    const text = this.chunks[this.chunkIndex]!;
    const u = this.env.makeUtterance!(text);
    u.lang = voice.lang || locale;
    u.voice = voice;
    u.rate = this.rate;
    const before = this.chunks.slice(0, this.chunkIndex).join(' ').length;
    const total = this.chunks.join(' ').length;
    this.armStartTimer(run);
    u.onstart = () => {
      if (run !== this.run) return;
      this.clearStartTimer();
      if (this.state.status !== 'paused') this.set({ status: 'playing' });
    };
    u.onboundary = (e) => {
      if (run !== this.run) return;
      this.set({ progress: Math.min(1, (before + e.charIndex) / total) });
    };
    u.onend = () => {
      if (run !== this.run) return;
      this.live = this.live.filter((x) => x !== u);
      this.chunkIndex++;
      this.set({ progress: Math.min(1, this.chunks.slice(0, this.chunkIndex).join(' ').length / total) });
      if (this.chunkIndex < this.chunks.length) this.speakChunk(run, voice, locale);
      else this.finish(run);
    };
    u.onerror = (e) => {
      if (run !== this.run) return;
      // "interrupted" and "canceled" come from our own stop(); anything else is a real failure
      if (e.error === 'interrupted' || e.error === 'canceled') return;
      this.fail(run, 'failed');
    };
    this.live.push(u);
    synth.speak(u);
  }

  private playAudio(run: number, url: string) {
    const audio = this.env.makeAudio!();
    this.audio = audio;
    this.audioUrl = url;
    audio.src = url;
    audio.playbackRate = this.rate;
    audio.ontimeupdate = () => {
      if (run === this.run && audio.duration > 0) this.set({ progress: Math.min(1, audio.currentTime / audio.duration) });
    };
    audio.onended = () => {
      if (run === this.run) this.finish(run);
    };
    audio.onerror = () => {
      if (run === this.run) this.fail(run, 'server-failed');
    };
    this.armStartTimer(run);
    audio.play().then(
      () => {
        if (run !== this.run) return;
        this.clearStartTimer();
        this.set({ status: 'playing' });
      },
      () => {
        if (run === this.run) this.fail(run, 'server-failed');
      },
    );
  }

  pause(): void {
    if (this.state.status !== 'playing') return;
    if (this.audio) this.audio.pause();
    else this.env.synth?.pause();
    this.set({ status: 'paused' });
  }

  resume(): void {
    if (this.state.status !== 'paused') return;
    if (this.audio) void this.audio.play();
    else this.env.synth?.resume();
    this.set({ status: 'playing' });
  }

  replay(): void {
    if (this.last) void this.play(this.last.owner, this.last.text, this.last.locale);
  }

  setPreferredVoice(locale: string, name: string): void {
    this.preferredVoice = { ...this.preferredVoice, [locale]: name };
  }

  setRate(rate: number): void {
    this.rate = rate;
    if (this.audio) this.audio.playbackRate = rate;
  }

  /** Stops any playback. Safe to call at any time, any number of times. */
  stop(): void {
    this.run++;
    this.clearStartTimer();
    this.live = [];
    if (this.env.synth) {
      this.env.synth.cancel();
      // A cancelled engine can stay paused in some browsers; resume clears that for the next text
      this.env.synth.resume();
    }
    this.releaseAudio();
    if (this.state.status !== 'idle' || this.state.error) this.set({ ...IDLE });
  }

  private releaseAudio() {
    if (this.audio) {
      this.audio.onended = this.audio.onerror = this.audio.ontimeupdate = null;
      this.audio.pause();
      this.audio = null;
    }
    if (this.audioUrl) {
      this.env.revokeUrl(this.audioUrl);
      this.audioUrl = null;
    }
  }

  private finish(run: number) {
    if (run !== this.run) return;
    this.clearStartTimer();
    this.live = [];
    this.releaseAudio();
    this.set({ ...IDLE });
  }

  private fail(run: number, error: SpeechError) {
    if (run !== this.run) return;
    this.clearStartTimer();
    this.live = [];
    this.env.synth?.cancel();
    this.releaseAudio();
    this.set({ status: 'error', error, progress: 0 });
  }

  private armStartTimer(run: number) {
    this.clearStartTimer();
    this.startTimer = this.env.setTimeout(() => {
      if (run === this.run && this.state.status === 'loading') this.fail(run, 'did-not-start');
    }, START_TIMEOUT_MS);
  }

  private clearStartTimer() {
    if (this.startTimer !== null) this.env.clearTimeout(this.startTimer);
    this.startTimer = null;
  }
}

function browserEnv(): SpeechEnv {
  const w = typeof window !== 'undefined' ? window : undefined;
  const hasSynth = Boolean(w && 'speechSynthesis' in w && typeof SpeechSynthesisUtterance !== 'undefined');
  return {
    synth: hasSynth ? (w!.speechSynthesis as unknown as SynthLike) : null,
    makeUtterance: hasSynth ? (text) => new SpeechSynthesisUtterance(text) as unknown as UtteranceLike : null,
    fetchServerAudio: w ? fetchServerAudio : null,
    makeAudio: w && typeof Audio !== 'undefined' ? () => new Audio() as unknown as AudioLike : null,
    revokeUrl: (url) => URL.revokeObjectURL(url),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  };
}

let serverAvailable: Promise<string[]> | null = null;

/** Languages the server can voice ([] when no provider is configured). Asked once per page load. */
export function serverVoiceLanguages(): Promise<string[]> {
  serverAvailable ??= fetch('/api/tts/status', { credentials: 'same-origin' })
    .then((r) => (r.ok ? (r.json() as Promise<{ languages?: string[] }>) : { languages: [] }))
    .then((b) => b.languages ?? [])
    .catch(() => []);
  return serverAvailable;
}

async function fetchServerAudio(text: string, locale: string): Promise<string | null> {
  const languages = await serverVoiceLanguages();
  if (!languages.includes(locale)) return null;
  const res = await fetch('/api/tts', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, locale }),
  });
  if (!res.ok) throw new Error(`TTS ${res.status}`);
  return URL.createObjectURL(await res.blob());
}

const RATE_KEY = 'fairshift.speechRate';
const VOICE_KEY = 'fairshift.speechVoice';

let shared: SpeechController | null = null;

/** The app-wide controller. */
export function speech(): SpeechController {
  if (!shared) {
    shared = new SpeechController(browserEnv());
    try {
      const rate = Number(localStorage.getItem(RATE_KEY));
      if ((RATES as readonly number[]).includes(rate)) shared.rate = rate;
      shared.preferredVoice = JSON.parse(localStorage.getItem(VOICE_KEY) ?? '{}') as Record<string, string>;
    } catch {
      /* storage unavailable */
    }
  }
  return shared;
}

export function saveSpeechPreferences(c: SpeechController): void {
  try {
    localStorage.setItem(RATE_KEY, String(c.rate));
    localStorage.setItem(VOICE_KEY, JSON.stringify(c.preferredVoice));
  } catch {
    /* storage unavailable */
  }
}
