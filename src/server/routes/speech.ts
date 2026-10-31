// Server voice for read-aloud, used only when the worker's device has no voice for their
// language. Google Cloud Text-to-Speech has voices for all six FairShift locales. The API key
// stays on the server, the spoken text is never logged or stored, and audio is not cached.
import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context';
import { HttpError, parse } from '../http';
import { requireUser } from '../auth/session';
import { RateLimiter } from '../rateLimit';

export const TTS_LOCALES = ['en-IN', 'kn-IN', 'hi-IN', 'ta-IN', 'te-IN', 'bn-IN'] as const;
const ENDPOINT = 'https://texttospeech.googleapis.com/v1/text:synthesize';

const ttsSchema = z.object({
  text: z.string().trim().min(1).max(2000),
  locale: z.enum(TTS_LOCALES),
});

export function speechRoutes(ctx: AppContext): Router {
  const r = Router();
  const perMinute = new RateLimiter(12, 60_000, 'Too many read-aloud requests. Wait a minute and try again.');
  const perDay = new RateLimiter(300, 24 * 60 * 60_000, 'The daily read-aloud allowance is used up. Read the text on screen.');

  r.get('/tts/status', (req, res) => {
    requireUser(req);
    res.json({ languages: ctx.config.googleTtsApiKey ? TTS_LOCALES : [] });
  });

  r.post('/tts', async (req, res) => {
    const user = requireUser(req);
    const key = ctx.config.googleTtsApiKey;
    if (!key) throw new HttpError(404, 'TTS_NOT_CONFIGURED', 'No server voice is configured.');
    const { text, locale } = parse(ttsSchema, req.body);
    const now = ctx.now().getTime();
    perMinute.take(user.id, now);
    perDay.take(user.id, now);

    const doFetch = ctx.fetch ?? fetch;
    let audio: string | undefined;
    try {
      const response = await doFetch(ENDPOINT, {
        method: 'POST',
        // The key goes in a header, not the URL, so it does not appear in proxy logs
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key },
        body: JSON.stringify({ input: { text }, voice: { languageCode: locale }, audioConfig: { audioEncoding: 'MP3' } }),
        signal: AbortSignal.timeout(8000),
      });
      if (response.ok) audio = ((await response.json()) as { audioContent?: string }).audioContent;
      else console.warn(`[fairshift] text-to-speech provider returned ${response.status}`);
    } catch (err) {
      console.warn('[fairshift] text-to-speech provider unreachable:', err instanceof Error ? err.name : 'error');
    }
    if (!audio) throw new HttpError(502, 'TTS_UNAVAILABLE', 'The server voice is not available right now.');
    const bytes = Buffer.from(audio, 'base64');
    if (bytes.length === 0) throw new HttpError(502, 'TTS_UNAVAILABLE', 'The server voice is not available right now.');
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', String(bytes.length));
    res.end(bytes);
  });

  return r;
}
