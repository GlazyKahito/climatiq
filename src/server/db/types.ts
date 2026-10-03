import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type * as schema from './schema';

/** Driver-agnostic database type (node-postgres in the app, PGlite in tests). */
export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;
