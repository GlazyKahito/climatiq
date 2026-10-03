import 'server-only';
import { AuthError, getCurrentUser, type AppUser } from '../auth/dal';
import { api, HttpError } from '../http';
import { DomainError } from './errors';

/** Converts service DomainErrors into the shared HTTP error types understood by `api()`. */
export function mapDomainError(e: unknown): unknown {
  if (e instanceof DomainError) return e.status === 403 ? new AuthError(403, e.message) : new HttpError(e.status, e.message, e.details);
  return e;
}

/** `api()` wrapper for this module's routes: error mapping + DomainError conversion. */
export function route<C>(handler: (req: Request, ctx: C) => Promise<Response>) {
  return api<C>(async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (e) {
      throw mapDomainError(e);
    }
  });
}

/** Signed-in user or 401. */
export async function requireApiUser(): Promise<AppUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError(401, 'Sign-in required');
  return user;
}
