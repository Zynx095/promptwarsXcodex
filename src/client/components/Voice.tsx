// Optional voice support for workers with limited literacy. Both controls use only the
// browser's built-in speech APIs (no external service, no API keys) and render nothing
// where the browser lacks support, so typing and reading always remain available.
import { useEffect, useRef, useState } from 'react';
import { Mic, Square, Volume2 } from 'lucide-react';
import { useI18n } from '../lib/i18n';

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

/** Reads a text aloud in the selected language. */
export function ReadAloudButton({ text, className }: { text: string; className?: string }) {
  const { t, locale } = useI18n();
  const [speaking, setSpeaking] = useState(false);
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';

  useEffect(
    () => () => {
      if (supported) window.speechSynthesis.cancel();
    },
    [supported],
  );
  if (!supported) return null;

  const toggle = () => {
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = locale;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(u);
  };

  return (
    <button type="button" className={`btn btn-ghost btn-sm ${className ?? ''}`} aria-pressed={speaking} onClick={toggle}>
      <Volume2 className="icon" aria-hidden="true" />
      {speaking ? t('voice.stopReading') : t('voice.readAloud')}
    </button>
  );
}
