import type { AstroCookies } from 'astro';
import { isProduction } from '../config.ts';

// "__Host-" cookies must be Secure, host-only and Path=/, so they cannot be
// set or overwritten by subdomains. Plain HTTP local development cannot use it.
export const SESSION_COOKIE = isProduction() ? '__Host-cynja_admin' : 'cynja_admin';

export function setSessionCookie(cookies: AstroCookies, token: string, expiresAt: string): void {
  cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'strict',
    path: '/',
    expires: new Date(expiresAt),
  });
}

export function clearSessionCookie(cookies: AstroCookies): void {
  cookies.delete(SESSION_COOKIE, { path: '/', secure: isProduction(), httpOnly: true, sameSite: 'strict' });
}
