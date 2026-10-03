/**
 * Applies migrations, then runs the idempotent demo seed when DEMO_MODE=true.
 * Usage: node --import tsx scripts/db-setup.ts [--migrate-only]
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import * as schema from '../src/server/db/schema';
import type { DB } from '../src/server/db/types';
import { runSeed } from '../src/server/db/seed';

async function main() {
  // Migrations prefer a direct (non-pooled) connection when the provider offers one (e.g. Neon).
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const pool = new Pool({ connectionString: url, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined });
  const db = drizzle(pool, { schema }) as unknown as DB;
  console.log('› Applying migrations …');
  await migrate(drizzle(pool), { migrationsFolder: 'drizzle' });
  if (!process.argv.includes('--migrate-only') && (process.env.DEMO_MODE === 'true' || process.env.DEMO_MODE === '1')) {
    await runSeed(db, { log: (m) => console.log(`› ${m}`) });
  }
  await pool.end();
  console.log('✓ Database ready');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
