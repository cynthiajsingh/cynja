import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RateLimitError, UnauthorizedError, ValidationError } from '../../src/server/errors.ts';
import { csrfTokenFor, verifyCsrfToken } from '../../src/server/auth/tokens.ts';
import { createTestServices } from '../helpers/services.ts';

const PASSWORD = 'correct horse battery staple';
let s: Awaited<ReturnType<typeof createTestServices>>;
const login = (password = PASSWORD, ip = '10.0.0.1', username = 'cynthia') =>
  s.auth.login({ username, password, ip, userAgent: 'vitest' });

beforeAll(async () => {
  s = await createTestServices();
  await s.auth.setAdminPassword('cynthia', PASSWORD);
});
afterAll(() => s.db.close());

describe('admin provisioning', () => {
  it('rejects weak passwords', async () => {
    await expect(s.auth.setAdminPassword('cynthia', 'short')).rejects.toBeInstanceOf(ValidationError);
    await expect(s.auth.setAdminPassword('cynthia', 'aaaaaaaaaaaaaaaa')).rejects.toBeInstanceOf(ValidationError);
  });

  it('never stores the password in plaintext', async () => {
    const { rows } = await s.db.query<{ password_hash: string }>('SELECT password_hash FROM admins');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.password_hash).not.toContain(PASSWORD);
    expect(rows[0]!.password_hash).toMatch(/^scrypt\$131072\$8\$1\$[\w-]+\$[\w-]+$/);
  });
});

describe('login and sessions', () => {
  it('accepts the right password and returns a working session', async () => {
    const session = await login();
    const auth = await s.auth.validateSession(session.token);
    expect(auth?.admin.username).toBe('cynthia');
    // Only the hash of the token is stored.
    const { rows } = await s.db.query('SELECT 1 FROM sessions WHERE id = $1', [session.token]);
    expect(rows).toHaveLength(0);
  });

  it('rejects a wrong password and an unknown user with the same message', async () => {
    await expect(login('wrong password here', '10.0.0.2')).rejects.toThrow('Incorrect username or password.');
    await expect(login(PASSWORD, '10.0.0.2', 'mallory')).rejects.toThrow('Incorrect username or password.');
  });

  it('issues a new session id on every login (no fixation)', async () => {
    const a = await login(PASSWORD, '10.0.0.3');
    const b = await login(PASSWORD, '10.0.0.3');
    expect(a.sessionId).not.toBe(b.sessionId);
  });

  it('rejects garbage, expired and idle sessions', async () => {
    expect(await s.auth.validateSession(undefined)).toBeNull();
    expect(await s.auth.validateSession('not-a-real-token')).toBeNull();
    const expired = await login(PASSWORD, '10.0.0.4');
    await s.db.query("UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE id = $1", [expired.sessionId]);
    expect(await s.auth.validateSession(expired.token)).toBeNull();
    const idle = await login(PASSWORD, '10.0.0.4');
    await s.db.query("UPDATE sessions SET last_seen_at = now() - interval '25 hours' WHERE id = $1", [idle.sessionId]);
    expect(await s.auth.validateSession(idle.token)).toBeNull();
    const { rows } = await s.db.query('SELECT 1 FROM sessions WHERE id = $1', [idle.sessionId]);
    expect(rows).toHaveLength(0);
  });

  it('logout ends the session', async () => {
    const session = await login(PASSWORD, '10.0.0.5');
    await s.auth.logout(session.sessionId);
    expect(await s.auth.validateSession(session.token)).toBeNull();
  });

  it('locks out an IP after repeated failures, even with the right password', async () => {
    for (let i = 0; i < 5; i++) await expect(login('nope nope nope', '10.9.9.9')).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(login(PASSWORD, '10.9.9.9')).rejects.toBeInstanceOf(RateLimitError);
    // Other addresses are unaffected.
    await expect(login(PASSWORD, '10.0.0.6')).resolves.toBeTruthy();
  });

  it('binds CSRF tokens to the session', async () => {
    const a = await login(PASSWORD, '10.0.0.7');
    const b = await login(PASSWORD, '10.0.0.7');
    expect(verifyCsrfToken(a.sessionId, csrfTokenFor(a.sessionId))).toBe(true);
    expect(verifyCsrfToken(a.sessionId, csrfTokenFor(b.sessionId))).toBe(false);
    expect(verifyCsrfToken(a.sessionId, null)).toBe(false);
  });
});

describe('password change and reset', () => {
  it('requires the current password', async () => {
    const session = await login(PASSWORD, '10.1.0.1');
    const auth = (await s.auth.validateSession(session.token))!;
    await expect(s.auth.changePassword({ adminId: auth.admin.id, current: 'wrong wrong wrong', next: 'a brand new passphrase', userAgent: 'x' }))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it('signs out every other session and only the new password works afterwards', async () => {
    const other = await login(PASSWORD, '10.1.0.2');
    const mine = await login(PASSWORD, '10.1.0.2');
    const auth = (await s.auth.validateSession(mine.token))!;
    const fresh = await s.auth.changePassword({ adminId: auth.admin.id, current: PASSWORD, next: 'a brand new passphrase', userAgent: 'x' });
    expect(await s.auth.validateSession(other.token)).toBeNull();
    expect(await s.auth.validateSession(mine.token)).toBeNull();
    expect(await s.auth.validateSession(fresh.token)).not.toBeNull();
    await expect(login(PASSWORD, '10.1.0.3')).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(login('a brand new passphrase', '10.1.0.3')).resolves.toBeTruthy();
  });

  it('administrative reset replaces the password and revokes all sessions', async () => {
    const session = await login('a brand new passphrase', '10.1.0.4');
    await s.auth.setAdminPassword('cynthia', PASSWORD);
    expect(await s.auth.validateSession(session.token)).toBeNull();
    await expect(login(PASSWORD, '10.1.0.5')).resolves.toBeTruthy();
  });
});
