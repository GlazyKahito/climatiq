import 'server-only';
import { ZodError } from 'zod';
import { AuthError } from './auth/dal';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** Uniform JSON error envelope: { error: { code, message, details? } }. Never leaks stack traces. */
export function errorResponse(err: unknown): Response {
  if (err instanceof AuthError) {
    return Response.json({ error: { code: err.status === 401 ? 'unauthenticated' : 'forbidden', message: err.message } }, { status: err.status });
  }
  if (err instanceof ZodError) {
    return Response.json(
      { error: { code: 'invalid_request', message: 'Request validation failed', details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) } },
      { status: 400 },
    );
  }
  if (err instanceof HttpError) {
    return Response.json({ error: { code: codeFor(err.status), message: err.message, details: err.details } }, { status: err.status });
  }
  console.error('[api] unhandled error', err);
  return Response.json({ error: { code: 'internal_error', message: 'Something went wrong. Please retry.' } }, { status: 500 });
}

function codeFor(status: number) {
  return (
    { 400: 'invalid_request', 401: 'unauthenticated', 403: 'forbidden', 404: 'not_found', 409: 'conflict', 422: 'unprocessable', 429: 'rate_limited', 503: 'unavailable' } as Record<number, string>
  )[status] ?? 'error';
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

/** Wraps a route handler with error mapping. */
export function api<C>(handler: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

// ───────────── Simple in-memory fixed-window rate limiter (per instance; adequate for the MVP) ─────────────
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  b.count += 1;
  if (b.count > limit) {
    throw new HttpError(429, `Rate limit exceeded. Retry in ${Math.ceil((b.resetAt - now) / 1000)} s.`);
  }
}

export function clientKey(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  return (fwd?.split(',')[0] ?? req.headers.get('x-real-ip') ?? 'local').trim();
}

/** Parses JSON body with a size cap. */
export async function readJson(req: Request, maxBytes = 64 * 1024): Promise<unknown> {
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, 'Payload too large');
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(400, 'Body must be valid JSON');
  }
}
