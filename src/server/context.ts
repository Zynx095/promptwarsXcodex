import type { Db } from './db/db';
import type { AppConfig } from './config';

export interface AppContext {
  db: Db;
  config: AppConfig;
  /** Injectable clock so time-dependent rules are testable. */
  now: () => Date;
}

export const nowIso = (ctx: AppContext) => ctx.now().toISOString();
