import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/server/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:54330/climatiq',
  },
  strict: true,
  verbose: true,
});
