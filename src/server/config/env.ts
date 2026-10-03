import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),
  DATABASE_SSL: bool,
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  DEMO_MODE: bool,
  APP_URL: z.string().url().default('http://localhost:3100'),
  AI_PROVIDER: z.enum(['gemini', 'anthropic', 'template']).default('template'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-3.5-flash-lite'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-haiku-4-5'),
  OPEN_METEO_FORECAST_URL: z.string().url().default('https://api.open-meteo.com/v1/forecast'),
  OPEN_METEO_ARCHIVE_URL: z.string().url().default('https://archive-api.open-meteo.com/v1/archive'),
  OPEN_METEO_API_KEY: z.string().optional(),
  CRON_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Validated server environment. Throws a readable error on misconfiguration. Never import from client code. */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid CLIMATIQ environment configuration:\n${issues}\nSee .env.example.`);
  }
  cached = parsed.data;
  return cached;
}

/** For tests only. */
export function resetEnvCache() {
  cached = undefined;
}
