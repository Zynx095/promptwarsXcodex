// Voice support for workers with limited literacy. Dictation uses the browser's speech
// recognition and renders nothing where it is missing. Read-aloud uses the device's voices
// (lib/speech.ts), falls back to the server voice when one is configured, and says plainly when
// neither can read the language, so the text on screen always remains the source.
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { Gauge, Mic, Pause, Play, RotateCcw, Square, Volume2 } from 'lucide-react';
import { LANGUAGES, useI18n, type MessageKey } from '../lib/i18n';
import { RATES, saveSpeechPreferences, speech, type SpeechError } from '../lib/speech';

interface RecognitionResultEvent {
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
  resultIndex: number;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionResultEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Appends spoken words to a text field. */
export function DictateButton({ onText }: { onText: (text: string) => void }) {
  const { t, locale } = useI18n();
  const [listening, setListening] = useState(false);
  const [failed, setFailed] = useState(false);
  const rec = useRef<Recognition | null>(null);
  const Ctor = recognitionCtor();

  useEffect(() => () => rec.current?.stop(), []);
  if (!Ctor) return null;

  const toggle = () => {
    if (listening) {
      rec.current?.stop();
      return;
    }
    const r = new Ctor();
    r.lang = locale;
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!;
        if (res.isFinal) onText(res[0]!.transcript.trim());
      }
    };
    r.onerror = () => setFailed(true);
    r.onend = () => setListening(false);
    rec.current = r;
    setFailed(false);
    setListening(true);
    r.start();
  };

  return (
    <div className="voice-row">
      <button type="button" className="btn btn-secondary btn-sm" aria-pressed={listening} onClick={toggle}>
        {listening ? <Square className="icon" aria-hidden="true" /> : <Mic className="icon" aria-hidden="true" />}
        {listening ? t('voice.stop') : t('voice.speak')}
      </button>
      <span className="small muted" aria-live="polite">
        {listening ? t('voice.listening') : failed ? t('voice.error') : ''}
      </span>
    </div>
  );
}

const ERROR_KEY: Record<SpeechError, MessageKey> = {
  'no-voice': 'voice.err.noVoice',
  'not-supported': 'voice.err.notSupported',
  'did-not-start': 'voice.err.didNotStart',
  failed: 'voice.err.failed',
  'server-failed': 'voice.err.server',
};

const formatRate = (rate: number) => `${rate}×`;
/** "Microsoft ಸಪ್ನಾ Online (Natural) - Kannada (India)" → "ಸಪ್ನಾ" */
const voiceLabel = (name: string) =>
  name
    .replace(/^(Microsoft|Google|Apple)\s+/, '')
    .replace(/\s+Online \(Natural\)/, '')
    .replace(/\s+-\s+.*$/, '')
    .trim() || name;

/**
 * Reads a text aloud in the selected language: play, pause, resume, stop, replay, speed and, where
 * the device has several voices for the language, a choice of voice. The state shown is the
 * engine's real state: "Reading" appears only once speech has started.
 */
export function ReadAloudButton({ text, className }: { text: string; className?: string }) {
  const { t, lang, locale } = useI18n();
  const owner = useId();
  const controller = speech();
  const state = useSyncExternalStore(
    (fn) => controller.subscribe(fn),
    () => controller.getState(),
    () => controller.getState(),
  );
  const [, setPrefs] = useState(0);
  const mine = state.owner === owner;
  const active = mine && (state.status === 'loading' || state.status === 'playing' || state.status === 'paused');
  const language = LANGUAGES.find((l) => l.code === lang)?.label ?? lang;

  // Switching language mid-sentence would keep reading the old text in the old voice: stop it.
  const playingLocale = mine ? state.locale : null;
  useEffect(() => {
    if (playingLocale && playingLocale !== locale) controller.stop();
  }, [controller, locale, playingLocale]);
  useEffect(
    () => () => {
      if (controller.getState().owner === owner) controller.stop();
    },
    [controller, owner],
  );

  if (!controller.supported) return null;

  const voices = active && state.engine === 'device' ? controller.availableVoices(locale) : [];
  let message = '';
  if (mine && state.status === 'error') message = t(ERROR_KEY[state.error ?? 'failed'], { language });
  else if (mine && state.status === 'loading') message = t('voice.loading');
  else if (mine && state.status === 'paused') message = t('voice.paused');
  else if (mine && state.status === 'playing') message = t('voice.playing', { language });
  const nextRate = RATES[(RATES.indexOf(controller.rate as (typeof RATES)[number]) + 1) % RATES.length]!;

  return (
    <div className={`speak${active ? ' is-active' : ''}${className ? ` ${className}` : ''}`}>
      <div className="speak-main">
        {active ? (
          <>
            {state.status === 'paused' ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => controller.resume()}>
                <Play className="icon" aria-hidden="true" />
                {t('voice.resume')}
              </button>
            ) : (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => controller.pause()} disabled={state.status === 'loading'}>
                <Pause className="icon" aria-hidden="true" />
                {t('voice.pause')}
              </button>
            )}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => controller.stop()}>
              <Square className="icon" aria-hidden="true" />
              {t('voice.stopReading')}
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void controller.play(owner, text, locale)}>
            <Volume2 className="icon" aria-hidden="true" />
            {mine && state.status === 'error' ? t('voice.tryAgain') : t('voice.readAloud')}
            <span className="speak-lang">{language}</span>
          </button>
        )}
      </div>
      {active ? (
        <div className="speak-panel">
          <div
            className="speak-progress"
            role="progressbar"
            aria-label={t('voice.progress')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(state.progress * 100)}
          >
            <span style={{ transform: `scaleX(${state.progress})` }} />
          </div>
          <div className="speak-tools">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => controller.replay()}>
              <RotateCcw className="icon" aria-hidden="true" />
              {t('voice.replay')}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              aria-label={t('voice.speedLabel', { speed: formatRate(controller.rate) })}
              onClick={() => {
                controller.setRate(nextRate);
                saveSpeechPreferences(controller);
                setPrefs((n) => n + 1);
                // Device voices take a new rate only from the next utterance: restart so it applies now
                if (state.engine === 'device') controller.replay();
              }}
            >
              <Gauge className="icon" aria-hidden="true" />
              {formatRate(controller.rate)}
            </button>
            {voices.length > 1 ? (
              <label className="speak-voice">
                <span className="visually-hidden">{t('voice.voice')}</span>
                <select
                  value={state.voiceName ?? ''}
                  onChange={(e) => {
                    controller.setPreferredVoice(locale, e.target.value);
                    saveSpeechPreferences(controller);
                    controller.replay();
                  }}
                >
                  {voices.map((v) => (
                    <option key={v.name} value={v.name}>
                      {voiceLabel(v.name)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {state.engine === 'server' ? <span className="speak-engine">{t('voice.serverVoice')}</span> : null}
          </div>
        </div>
      ) : null}
      <p className={`speak-status${mine && state.status === 'error' ? ' is-error' : ''}`} aria-live="polite">
        {message}
      </p>
    </div>
  );
}
