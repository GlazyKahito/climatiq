/**
 * Domain error for the advisories / alerts / notifications / incidents services.
 *
 * Deliberately free of `server-only` imports: these services also run inside the Node seed script
 * (scripts/db-setup.ts), where `server-only` throws. Route handlers convert it with `mapDomainError` (see api.ts);
 * server actions turn it into a user-facing message.
 */
export type DomainStatus = 400 | 403 | 404 | 409 | 410 | 422;

export class DomainError extends Error {
  constructor(
    public status: DomainStatus,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export const forbidden = (message: string) => new DomainError(403, message);
export const notFound = (message: string) => new DomainError(404, message);

/** Message safe to show users for any error thrown by a service (unknown errors are not leaked). */
export function userMessage(e: unknown): string {
  if (e instanceof DomainError) return e.message;
  if (e && typeof e === 'object' && 'status' in e && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
    const status = Number((e as { status: unknown }).status);
    if (status >= 400 && status < 500) return (e as { message: string }).message;
  }
  if (e && typeof e === 'object' && 'issues' in e) return 'Some fields are invalid — please check the form.';
  console.error('[operations] unexpected error', e);
  return 'Something went wrong. Please retry.';
}
