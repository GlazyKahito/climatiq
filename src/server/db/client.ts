import 'server-only';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
import type { DB } from './types';
import { env } from '../config/env';

export type { DB };

type Global = typeof globalThis & { __climatiqDb?: DB; __climatiqPool?: Pool };
const g = globalThis as Global;

/** Returns the process-wide database handle (re-used across hot reloads in development). */
export function getDb(): DB {
  if (g.__climatiqDb) return g.__climatiqDb;
  const pool = new Pool({
    connectionString: env().DATABASE_URL,
    max: env().DATABASE_POOL_MAX,
    ssl: env().DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
  });
  pool.on('error', (err) => console.error('[db] idle client error', err.message));
  g.__climatiqPool = pool;
  g.__climatiqDb = drizzle(pool, { schema }) as unknown as DB;
  return g.__climatiqDb;
}

/** Test hook: swap the database (e.g. for an in-memory PGlite instance). */
export function setDb(db: DB | undefined) {
  g.__climatiqDb = db;
}

export { schema };
