import { describe, expect, it } from 'vitest';
import {
  chunkText,
  pickVoice,
  SpeechController,
  type AudioLike,
  type SpeechEnv,
  type SynthLike,
  type UtteranceLike,
  type VoiceLike,
} from '../../src/client/lib/speech';

const v = (lang: string, name: string, localService = false): VoiceLike => ({ lang, name, localService });
const EDGE_VOICES = [
  v('en-US', 'Ava Multilingual'),
  v('en-US', 'Jenny'),
  v('en-IN', 'Neerja'),
  v('hi-IN', 'Swara'),
  v('kn-IN', 'Sapna'),
  v('ta-IN', 'Pallavi'),
  v('ta-LK', 'Saranya'),
  v('te-IN', 'Shruti'),
  v('bn-BD', 'Nabanita'),
  v('bn-IN', 'Tanishaa'),
];

/** A scripted speech engine: utterances start, report boundaries and end on the next ticks. */
class FakeSynth implements SynthLike {
  spoken: UtteranceLike[] = [];
  cancelled = 0;
  paused = false;
  private listeners: (() => void)[] = [];
  /** When false, utterances never start (an engine that silently does nothing). */
  starts = true;
  /** Set to an error name to fail every utterance. */
  failWith: string | null = null;
  constructor(public voices: VoiceLike[]) {}
  getVoices() {
    return this.voices;
  }
  speak(u: UtteranceLike) {
    this.spoken.push(u);
    if (!this.starts) return;
    queueMicrotask(() => {
      if (this.failWith) return u.onerror?.({ error: this.failWith });
      u.onstart?.();
      u.onboundary?.({ charIndex: Math.floor(u.text.length / 2) });
      queueMicrotask(() => u.onend?.());
    });
  }
  cancel() {
    this.cancelled++;
  }
  pause() {
    this.paused = true;
  }
  resume() {
    this.paused = false;
  }
  addEventListener(_: 'voiceschanged', fn: () => void) {
    this.listeners.push(fn);
  }
  removeEventListener(_: 'voiceschanged', fn: () => void) {
    this.listeners = this.listeners.filter((f) => f !== fn);
  }
  announceVoices(voices: VoiceLike[]) {
    this.voices = voices;
    for (const fn of [...this.listeners]) fn();
  }
}

function env(synth: FakeSynth | null, server?: { languages: string[]; fail?: boolean }) {
  const timers: { fn: () => void; ms: number }[] = [];
  const audios: (AudioLike & { played: boolean })[] = [];
  const revoked: string[] = [];
  const e: SpeechEnv = {
    synth,
    makeUtterance: synth ? (text) => ({ text, lang: '', rate: 1, voice: null, onstart: null, onend: null, onerror: null, onboundary: null }) : null,
    fetchServerAudio: server
      ? async (_text, locale) => {
          if (server.fail) throw new Error('provider down');
          return server.languages.includes(locale) ? `blob:${locale}` : null;
        }
      : null,
    makeAudio: () => {
      const a = {
        src: '',
        playbackRate: 1,
        currentTime: 0,
        duration: 4,
        paused: true,
        played: false,
        onended: null,
        onerror: null,
        ontimeupdate: null,
        play() {
          a.played = true;
          a.paused = false;
          return Promise.resolve();
        },
        pause() {
          a.paused = true;
        },
      } as AudioLike & { played: boolean };
      audios.push(a);
      return a;
    },
    revokeUrl: (url) => revoked.push(url),
    setTimeout: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length - 1;
    },
    clearTimeout: (id) => {
      const t = timers[id as number];
      if (t) t.fn = () => {};
    },
  };
  return { e, timers, audios, revoked };
}

const settle = async () => {
  for (let i = 0; i < 50; i++) await Promise.resolve();
};

describe('read-aloud voice selection', () => {
  it('picks the exact locale for each of the six FairShift languages', () => {
    expect(pickVoice(EDGE_VOICES, 'en-IN')?.name).toBe('Neerja');
    expect(pickVoice(EDGE_VOICES, 'kn-IN')?.name).toBe('Sapna');
    expect(pickVoice(EDGE_VOICES, 'hi-IN')?.name).toBe('Swara');
    expect(pickVoice(EDGE_VOICES, 'ta-IN')?.name).toBe('Pallavi');
    expect(pickVoice(EDGE_VOICES, 'te-IN')?.name).toBe('Shruti');
    expect(pickVoice(EDGE_VOICES, 'bn-IN')?.name).toBe('Tanishaa');
  });

  it('falls back only within the same language, never to another one', () => {
    expect(pickVoice([v('bn-BD', 'Nabanita')], 'bn-IN')?.name).toBe('Nabanita');
    expect(pickVoice([v('en_US', 'Jenny')], 'en-IN')?.name).toBe('Jenny');
    // A Hindi voice must not read Kannada, and an English one must not read Tamil
    expect(pickVoice([v('hi-IN', 'Swara'), v('en-IN', 'Neerja')], 'kn-IN')).toBeNull();
    expect(pickVoice([v('en-US', 'Jenny')], 'ta-IN')).toBeNull();
    // Multilingual voices are tuned for another primary language
    expect(pickVoice([v('en-US', 'Ava Multilingual')], 'en-IN')).toBeNull();
  });

  it('prefers installed voices, and a voice the person chose', () => {
    const voices = [v('hi-IN', 'Online'), v('hi-IN', 'Installed', true), v('hi-IN', 'Other', true)];
    expect(pickVoice(voices, 'hi-IN')?.name).toBe('Installed');
    expect(pickVoice(voices, 'hi-IN', 'Other')?.name).toBe('Other');
    expect(pickVoice(voices, 'hi-IN', 'A voice not on this device')?.name).toBe('Installed');
  });
});

describe('read-aloud text splitting', () => {
  it('splits long text at sentence ends, including the danda, without breaking words or Unicode', () => {
    const kn = 'ನಿಮ್ಮ ಈ ವಾರದ ವೇತನ ₹3,716.68. '.repeat(12);
    const hi = 'आपका वेतन तैयार है। '.repeat(20);
    for (const text of [kn, hi, 'word '.repeat(400)]) {
      const chunks = chunkText(text);
      expect(chunks.length).toBeGreaterThan(1);
      for (const c of chunks) expect(c.length).toBeLessThanOrEqual(180);
      expect(chunks.join(' ').replace(/\s+/g, ' ')).toBe(text.replace(/\s+/g, ' ').trim());
    }
    expect(chunkText(hi)[0]!.endsWith('।')).toBe(true);
    expect(chunkText('   ')).toEqual([]);
    expect(chunkText('Short.')).toEqual(['Short.']);
  });
});

describe('read-aloud playback', () => {
  it('reads every sentence in order with the language voice, and shows playing only after speech starts', async () => {
    const synth = new FakeSynth(EDGE_VOICES);
    const { e } = env(synth);
    const c = new SpeechController(e);
    const seen: string[] = [];
    c.subscribe((s) => seen.push(s.status));
    const text = 'ಮೊದಲ ವಾಕ್ಯ ಇಲ್ಲಿದೆ. '.repeat(15);
    const done = c.play('a', text, 'kn-IN');
    expect(c.getState().status).toBe('loading');
    await done;
    await settle();
    expect(synth.spoken.length).toBe(chunkText(text).length);
    expect(synth.spoken.every((u) => u.voice?.name === 'Sapna' && u.lang === 'kn-IN')).toBe(true);
    expect(seen.indexOf('loading')).toBeLessThan(seen.indexOf('playing'));
    expect(c.getState()).toMatchObject({ status: 'idle', owner: null });
  });

  it('waits for voices that load asynchronously', async () => {
    const synth = new FakeSynth([]);
    const { e } = env(synth);
    const c = new SpeechController(e);
    const done = c.play('a', 'বেতন', 'bn-IN');
    await Promise.resolve();
    synth.announceVoices(EDGE_VOICES);
    await done;
    await settle();
    expect(synth.spoken[0]?.voice?.name).toBe('Tanishaa');
  });

  it('reports a missing voice instead of claiming to read, when there is no server voice', async () => {
    const synth = new FakeSynth([v('en-IN', 'Neerja'), v('hi-IN', 'Swara')]);
    const { e, timers } = env(synth);
    const c = new SpeechController(e);
    const done = c.play('a', 'ತಮಿಳು', 'kn-IN');
    timers.forEach((t) => t.fn()); // voice wait times out
    await done;
    expect(synth.spoken).toHaveLength(0);
    expect(c.getState()).toMatchObject({ status: 'error', error: 'no-voice', owner: 'a' });
  });

  it('uses the server voice when the device has none for the language', async () => {
    const synth = new FakeSynth([v('en-IN', 'Neerja')]);
    const { e, audios } = env(synth, { languages: ['ta-IN'] });
    const c = new SpeechController(e);
    await c.play('a', 'வணக்கம்', 'ta-IN');
    await settle();
    expect(synth.spoken).toHaveLength(0);
    expect(audios[0]?.src).toBe('blob:ta-IN');
    expect(c.getState()).toMatchObject({ status: 'playing', engine: 'server' });
    audios[0]!.onended?.();
    expect(c.getState().status).toBe('idle');
  });

  it('reports a server voice failure honestly', async () => {
    const { e } = env(new FakeSynth([v('en-IN', 'Neerja')]), { languages: ['te-IN'], fail: true });
    const c = new SpeechController(e);
    const done = c.play('a', 'నమస్తే', 'te-IN');
    await done;
    await settle();
    expect(c.getState()).toMatchObject({ status: 'error', error: 'server-failed' });
  });

  it('says the voice did not start when the engine stays silent', async () => {
    const synth = new FakeSynth(EDGE_VOICES);
    synth.starts = false;
    const { e, timers } = env(synth);
    const c = new SpeechController(e);
    await c.play('a', 'Hello', 'en-IN');
    expect(c.getState().status).toBe('loading');
    timers.filter((t) => t.ms >= 10000).forEach((t) => t.fn());
    expect(c.getState()).toMatchObject({ status: 'error', error: 'did-not-start' });
  });

  it('treats engine errors as failures but ignores its own interruptions', async () => {
    const synth = new FakeSynth(EDGE_VOICES);
    synth.failWith = 'interrupted';
    const { e } = env(synth);
    const c = new SpeechController(e);
    await c.play('a', 'Hello', 'en-IN');
    await settle();
    expect(c.getState().status).toBe('loading');
    synth.failWith = 'synthesis-failed';
    await c.play('a', 'Hello', 'en-IN');
    await settle();
    expect(c.getState()).toMatchObject({ status: 'error', error: 'failed' });
  });

  it('survives rapid play and stop: only the last request speaks, and stop leaves nothing running', async () => {
    const synth = new FakeSynth(EDGE_VOICES);
    const { e } = env(synth);
    const c = new SpeechController(e);
    const first = c.play('a', 'First text.', 'en-IN');
    c.stop();
    const second = c.play('b', 'आपका वेतन।', 'hi-IN');
    await Promise.all([first, second]);
    await settle();
    expect(synth.spoken.map((u) => u.text)).toEqual(['आपका वेतन।']);
    expect(synth.cancelled).toBeGreaterThanOrEqual(2);

    const third = c.play('a', 'Long text. '.repeat(40), 'en-IN');
    await third;
    c.stop();
    await settle();
    expect(c.getState()).toMatchObject({ status: 'idle', owner: null });
  });

  it('pauses, resumes and replays', async () => {
    const synth = new FakeSynth(EDGE_VOICES);
    synth.starts = true;
    const { e } = env(synth);
    const c = new SpeechController(e);
    // An engine that starts but never ends, so the state can be inspected mid-reading
    synth.speak = function (u) {
      this.spoken.push(u);
      queueMicrotask(() => u.onstart?.());
    };
    await c.play('a', 'Hello there.', 'en-IN');
    await settle();
    expect(c.getState().status).toBe('playing');
    c.pause();
    expect(synth.paused).toBe(true);
    expect(c.getState().status).toBe('paused');
    c.resume();
    expect(synth.paused).toBe(false);
    expect(c.getState().status).toBe('playing');
    c.replay();
    await settle();
    expect(synth.spoken.length).toBe(2);
  });

  it('is unsupported only when neither the device nor the server can speak', () => {
    expect(new SpeechController(env(null).e).supported).toBe(false);
    expect(new SpeechController(env(null, { languages: [] }).e).supported).toBe(true);
    expect(new SpeechController(env(new FakeSynth([])).e).supported).toBe(true);
  });
});
