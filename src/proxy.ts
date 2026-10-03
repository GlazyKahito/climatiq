import { NextResponse, type NextRequest } from 'next/server';

/**
 * Optimistic auth redirect only (cookie presence). Real authorisation happens server-side in the DAL
 * (`requireUser`, `authorize`) for every page, action and API route.
 */
const PROTECTED = ['/command', '/forecasts', '/stations', '/advisories', '/alerts', '/response', '/analytics', '/admin', '/settings'];

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const isProtected = PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (isProtected && !req.cookies.has('cq_session')) {
    const url = new URL('/login', req.url);
    url.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(url);
  }
  const res = NextResponse.next();
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set('X-Frame-Options', 'SAMEORIGIN');
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|geo/|textures/|.*\\.(?:png|jpg|svg|webp|json|glb)$).*)'],
};
