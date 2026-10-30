import type { Db } from '../db/types.ts';
import { RateLimitError, UnauthorizedError, ValidationError } from '../errors.ts';
import { dummyPasswordHash, hashPassword, passwordProblem, verifyPassword } from './password.ts';
import { hashIp, hashToken, newSessionToken } from './tokens.ts';

export const SESSION_TTL_HOURS = 24 * 7; // absolute lifetime
export const SESSION_IDLE_HOURS = 24; // signed out after a day without activity
export const LOGIN_WINDOW_MINUTES = 15;
export const MAX_FAILURES_PER_IP = 5;
export const MAX_FAILURES_GLOBAL = 50;

export interface Admin {
  id: number;
  username: string;
}

export interface AuthenticatedSession {
  admin: Admin;
  sessionId: string;
  expiresAt: string;
}

export interface NewSession {
  token: string;
  sessionId: string;
  expiresAt: string;
}

export class AuthService {
  private readonly db: Db;
  constructor(db: Db) {
    this.db = db;
  }

  async adminExists(): Promise<boolean> {
    const { rows } = await this.db.query('SELECT 1 FROM admins LIMIT 1');
    return rows.length > 0;
  }

  /** Bootstrap / recovery: creates or resets the single admin and signs out every session. */
  async setAdminPassword(username: string, password: string): Promise<Admin> {
    const problem = passwordProblem(password);
    if (problem) throw new ValidationError({ password: problem }, problem);
    const name = username.trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(name)) {
      throw new ValidationError({ username: 'Use 3–40 letters, numbers, dots, dashes or underscores.' });
    }
    const hash = await hashPassword(password);
    return this.db.transaction(async (tx) => {
      const existing = await tx.query<{ id: number }>('SELECT id FROM admins ORDER BY id LIMIT 1');
      let admin: Admin;
      if (existing.rows[0]) {
        const { rows } = await tx.query<Admin>(
          'UPDATE admins SET username = $2, password_hash = $3, password_changed_at = now() WHERE id = $1 RETURNING id, username',
          [existing.rows[0].id, name, hash],
        );
        admin = rows[0]!;
      } else {
        const { rows } = await tx.query<Admin>(
          'INSERT INTO admins (username, password_hash) VALUES ($1, $2) RETURNING id, username',
          [name, hash],
        );
        admin = rows[0]!;
      }
      await tx.query('DELETE FROM sessions WHERE admin_id = $1', [admin.id]);
      return admin;
    });
  }

  async login(input: { username: string; password: string; ip: string; userAgent: string }): Promise<NewSession & { admin: Admin }> {
    const ipHash = hashIp(input.ip || 'unknown');
    await this.assertNotRateLimited(ipHash);

    const { rows } = await this.db.query<{ id: number; username: string; password_hash: string }>(
      'SELECT id, username, password_hash FROM admins WHERE username = $1',
      [input.username.trim().toLowerCase()],
    );
    const admin = rows[0];
    const ok = await verifyPassword(input.password, admin?.password_hash ?? (await dummyPasswordHash()));
    await this.db.query('INSERT INTO login_attempts (ip_hash, succeeded) VALUES ($1, $2)', [ipHash, ok && !!admin]);
    if (!admin || !ok) throw new UnauthorizedError('Incorrect username or password.');

    const session = await this.createSession(admin.id, input.userAgent);
    return { ...session, admin: { id: admin.id, username: admin.username } };
  }

  private async assertNotRateLimited(ipHash: string): Promise<void> {
    const { rows } = await this.db.query<{ ip_failures: number; all_failures: number; oldest: string | null }>(
      `SELECT
         count(*) FILTER (WHERE ip_hash = $1) AS ip_failures,
         count(*) AS all_failures,
         min(created_at) FILTER (WHERE ip_hash = $1) AS oldest
       FROM login_attempts
       WHERE NOT succeeded AND created_at > now() - make_interval(mins => $2)`,
      [ipHash, LOGIN_WINDOW_MINUTES],
    );
    const r = rows[0];
    if (!r) return;
    if (Number(r.ip_failures) >= MAX_FAILURES_PER_IP || Number(r.all_failures) >= MAX_FAILURES_GLOBAL) {
      const oldest = r.oldest ? new Date(r.oldest).getTime() : Date.now();
      const retry = Math.max(60, Math.ceil((oldest + LOGIN_WINDOW_MINUTES * 60_000 - Date.now()) / 1000));
      throw new RateLimitError(retry);
    }
  }

  /** Always issues a brand-new session id (prevents session fixation). */
  async createSession(adminId: number, userAgent: string): Promise<NewSession> {
    const token = newSessionToken();
    const sessionId = hashToken(token);
    const { rows } = await this.db.query<{ expires_at: string }>(
      `INSERT INTO sessions (id, admin_id, expires_at, user_agent)
       VALUES ($1, $2, now() + make_interval(hours => $3), $4) RETURNING expires_at`,
      [sessionId, adminId, SESSION_TTL_HOURS, userAgent.slice(0, 300)],
    );
    return { token, sessionId, expiresAt: rows[0]!.expires_at };
  }

  async validateSession(token: string | undefined): Promise<AuthenticatedSession | null> {
    if (!token || token.length > 100) return null;
    const sessionId = hashToken(token);
    const { rows } = await this.db.query<{
      admin_id: number; username: string; expires_at: string; idle: boolean; stale: boolean;
    }>(
      `SELECT s.admin_id, a.username, s.expires_at,
              s.last_seen_at < now() - make_interval(hours => $2) AS idle,
              s.last_seen_at < now() - interval '5 minutes' AS stale
       FROM sessions s JOIN admins a ON a.id = s.admin_id
       WHERE s.id = $1 AND s.expires_at > now()`,
      [sessionId, SESSION_IDLE_HOURS],
    );
    const row = rows[0];
    if (!row) return null;
    if (row.idle) {
      await this.db.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
      return null;
    }
    if (row.stale) await this.db.query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [sessionId]);
    return { admin: { id: row.admin_id, username: row.username }, sessionId, expiresAt: row.expires_at };
  }

  async logout(sessionId: string): Promise<void> {
    await this.db.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
  }

  /** Verifies the current password, then signs out every session and issues a fresh one. */
  async changePassword(input: { adminId: number; current: string; next: string; userAgent: string }): Promise<NewSession> {
    const { rows } = await this.db.query<{ password_hash: string }>('SELECT password_hash FROM admins WHERE id = $1', [input.adminId]);
    const admin = rows[0];
    if (!admin || !(await verifyPassword(input.current, admin.password_hash))) {
      throw new ValidationError({ current: 'Your current password is incorrect.' }, 'Your current password is incorrect.');
    }
    const problem = passwordProblem(input.next);
    if (problem) throw new ValidationError({ next: problem }, problem);
    if (input.current === input.next) {
      throw new ValidationError({ next: 'Choose a password different from your current one.' });
    }
    const hash = await hashPassword(input.next);
    await this.db.transaction(async (tx) => {
      await tx.query('UPDATE admins SET password_hash = $2, password_changed_at = now() WHERE id = $1', [input.adminId, hash]);
      await tx.query('DELETE FROM sessions WHERE admin_id = $1', [input.adminId]);
    });
    return this.createSession(input.adminId, input.userAgent);
  }

  async purgeExpired(): Promise<void> {
    await this.db.query('DELETE FROM sessions WHERE expires_at < now() OR last_seen_at < now() - make_interval(hours => $1)', [SESSION_IDLE_HOURS]);
    await this.db.query("DELETE FROM login_attempts WHERE created_at < now() - interval '30 days'");
  }
}
