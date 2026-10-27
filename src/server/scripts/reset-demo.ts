// Deletes the local SQLite database and re-seeds the synthetic demonstration dataset.
// Usage: npm run seed
import { existsSync, rmSync } from 'node:fs';
import { loadConfig } from '../config';
import { openDb } from '../db/db';
import { seedIfEmpty } from '../db/seed';

if (existsSync('.env')) process.loadEnvFile('.env');
const config = loadConfig();
if (config.production) {
  console.error('Refusing to reset the database with NODE_ENV=production.');
  process.exit(1);
}
for (const suffix of ['', '-wal', '-shm']) {
  const file = `${config.databasePath}${suffix}`;
  if (existsSync(file)) rmSync(file);
}
const db = openDb(config.databasePath);
seedIfEmpty({ db, config, now: () => new Date() });
db.close();
console.log(`Seeded synthetic demo data into ${config.databasePath}`);
