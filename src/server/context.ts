import type { Db } from './db/db';
import type { AppConfig } from './config';

export interface AppContext {
  db: Db;
  config: AppConfig;
  /** Injectable clock so time-dependent rules are testable. */
  now: () => Date;
  /** Outbound HTTP for optional providers (speech, image analysis); tests inject a fake. */
  fetch?: typeof fetch;
}

export const nowIso = (ctx: AppContext) => ctx.now().toISOString();
