import 'server-only';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { env } from '../config/env';

export const SESSION_COOKIE = 'cq_session';
const MAX_AGE_SECONDS = 60 * 60 * 12; // 12 hours

type SessionPayload = { uid: string; demo: boolean };

function key() {
  return new TextEncoder().encode(env().SESSION_SECRET);
}

export async function encryptSession(payload: SessionPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer('climatiq')
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(key());
}

export async function decryptSession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ['HS256'], issuer: 'climatiq' });
    if (typeof payload.uid !== 'string') return null;
    return { uid: payload.uid, demo: payload.demo === true };
  } catch {
    return null;
  }
}

export async function createSession(uid: string, demo: boolean) {
  const token = await encryptSession({ uid, demo });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env().NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function readSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  return decryptSession(store.get(SESSION_COOKIE)?.value);
}

export async function deleteSession() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
