import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from '@/server/db/schema';
import type { DB } from '@/server/db/types';

/** Fresh in-memory PostgreSQL (PGlite) with all migrations applied. */
export async function createTestDb(): Promise<{ db: DB; close: () => Promise<void> }> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: 'drizzle' });
  return { db: db as unknown as DB, close: () => client.close() };
}
