import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { sessionSecret } from '../config.ts';

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Only this hash is stored, so a leaked sessions table cannot be replayed. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function hmac(purpose: string, value: string): string {
  return createHmac('sha256', sessionSecret()).update(`${purpose}:${value}`).digest('base64url');
}

/** CSRF token bound to the session; rotates whenever the session does. */
export function csrfTokenFor(sessionId: string): string {
  return hmac('csrf', sessionId);
}

export function verifyCsrfToken(sessionId: string, token: string | null): boolean {
  if (!token) return false;
  const expected = Buffer.from(csrfTokenFor(sessionId));
  const actual = Buffer.from(token);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Rate limiting keys on a keyed hash, so raw IP addresses are never stored. */
export function hashIp(ip: string): string {
  return hmac('ip', ip);
}
