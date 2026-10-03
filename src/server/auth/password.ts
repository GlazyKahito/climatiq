import bcrypt from 'bcryptjs';

const ROUNDS = 10;
let dummy: string | undefined;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** A real bcrypt hash used to keep the failed-login path as slow as the successful one (no user enumeration). */
export function dummyHash(): string {
  dummy ??= bcrypt.hashSync('climatiq-timing-equaliser', ROUNDS);
  return dummy;
}
