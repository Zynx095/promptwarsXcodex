import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { PHONES, setup } from './helpers';

const SAMPLE_MP3 = Buffer.from('ID3fake-mp3-bytes').toString('base64');

function fakeProvider(respond: (body: { input: { text: string }; voice: { languageCode: string } }) => Response | Promise<Response>) {
  const calls: { url: string; headers: Record<string, string>; body: { input: { text: string }; voice: { languageCode: string } } }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { input: { text: string }; voice: { languageCode: string } };
    calls.push({ url, headers: init.headers as Record<string, string>, body });
    return respond(body);
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe('server voice for read-aloud', () => {
  it('is off unless a provider key is configured', async () => {
    const env = await setup();
    const worker = await env.login(PHONES.ravi);
    expect((await worker.get('/api/tts/status')).body).toEqual({ languages: [] });
    const res = await worker.post('/api/tts').send({ text: 'Hello', locale: 'en-IN' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('TTS_NOT_CONFIGURED');
  });

  it('requires a signed-in user', async () => {
    const env = await setup(undefined, { googleTtsApiKey: 'k' });
    expect((await request(env.app).get('/api/tts/status')).status).toBe(401);
    expect((await request(env.app).post('/api/tts').send({ text: 'Hi', locale: 'en-IN' })).status).toBe(401);
  });

  it('voices all six languages through the provider, keeping the key in a header', async () => {
    const provider = fakeProvider(() => Response.json({ audioContent: SAMPLE_MP3 }));
    const env = await setup(undefined, { googleTtsApiKey: 'server-only-key' }, provider.f);
    const worker = await env.login(PHONES.ravi);
    const status = await worker.get('/api/tts/status');
    expect(status.body.languages).toEqual(['en-IN', 'kn-IN', 'hi-IN', 'ta-IN', 'te-IN', 'bn-IN']);
    const samples: Record<string, string> = {
      'en-IN': 'Your take-home pay is ₹3,716.68.',
      'kn-IN': 'ನಿಮ್ಮ ವೇತನ',
      'hi-IN': 'आपका वेतन।',
      'ta-IN': 'உங்கள் ஊதியம்',
      'te-IN': 'మీ జీతం',
      'bn-IN': 'আপনার বেতন।',
    };
    for (const [locale, text] of Object.entries(samples)) {
      const res = await worker.post('/api/tts').send({ text, locale }).buffer(true);
      expect(res.status, locale).toBe(200);
      expect(res.headers['content-type']).toBe('audio/mpeg');
      expect(res.headers['cache-control']).toBe('no-store');
    }
    expect(provider.calls.map((c) => c.body.voice.languageCode)).toEqual(Object.keys(samples));
    expect(provider.calls.map((c) => c.body.input.text)).toEqual(Object.values(samples));
    for (const c of provider.calls) {
      expect(c.url).not.toContain('server-only-key');
      expect(c.headers['X-Goog-Api-Key']).toBe('server-only-key');
    }
  });

  it('rejects unsupported languages, empty and oversized text', async () => {
    const provider = fakeProvider(() => Response.json({ audioContent: SAMPLE_MP3 }));
    const env = await setup(undefined, { googleTtsApiKey: 'k' }, provider.f);
    const worker = await env.login(PHONES.ravi);
    expect((await worker.post('/api/tts').send({ text: 'Hola', locale: 'es-ES' })).status).toBe(400);
    expect((await worker.post('/api/tts').send({ text: '   ', locale: 'en-IN' })).status).toBe(400);
    expect((await worker.post('/api/tts').send({ text: 'a'.repeat(2001), locale: 'en-IN' })).status).toBe(400);
    expect(provider.calls).toHaveLength(0);
  });

  it('reports a provider failure or empty answer as unavailable, never as audio', async () => {
    for (const respond of [() => new Response('quota', { status: 429 }), () => Response.json({}), () => Promise.reject(new TypeError('network down'))]) {
      const env = await setup(undefined, { googleTtsApiKey: 'k' }, fakeProvider(respond).f);
      const worker = await env.login(PHONES.ravi);
      const res = await worker.post('/api/tts').send({ text: 'Hello', locale: 'en-IN' });
      expect(res.status).toBe(502);
      expect(res.body.error.code).toBe('TTS_UNAVAILABLE');
    }
  });

  it('limits how often one person can use the paid voice', async () => {
    const provider = fakeProvider(() => Response.json({ audioContent: SAMPLE_MP3 }));
    const env = await setup(undefined, { googleTtsApiKey: 'k' }, provider.f);
    const worker = await env.login(PHONES.ravi);
    const statuses: number[] = [];
    for (let i = 0; i < 14; i++) statuses.push((await worker.post('/api/tts').send({ text: `Line ${i}`, locale: 'en-IN' })).status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(12);
    expect(statuses.slice(12)).toEqual([429, 429]);
    env.advance(2);
    expect((await worker.post('/api/tts').send({ text: 'Again', locale: 'en-IN' })).status).toBe(200);
  });
});
