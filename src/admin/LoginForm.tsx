import { useState, type FormEvent } from 'react';
import { api, ApiError } from './api.ts';

export default function LoginForm({ next, configured }: { next: string; configured: boolean }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});

  async function submit(e: FormEvent) {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (!username.trim()) local.username = 'Enter your username.';
    if (!password) local.password = 'Enter your password.';
    setFields(local);
    setError('');
    if (Object.keys(local).length) return;
    setBusy(true);
    try {
      await api.post('/api/admin/login', { username, password });
      window.location.href = next;
    } catch (err) {
      setPassword('');
      if (err instanceof ApiError) {
        setError(err.message);
        setFields(err.fields);
      } else setError('Could not sign in. Please try again.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate aria-describedby={error ? 'login-error' : undefined}>
      {!configured && (
        <p className="form-error" role="alert">
          No admin account exists yet. Create one with <code>npm run admin:set-password</code> (see README).
        </p>
      )}
      {error && <p className="form-error" id="login-error" role="alert">{error}</p>}
      <div className="field">
        <label htmlFor="username">Username</label>
        <input id="username" className="input" autoComplete="username" autoCapitalize="none" spellCheck={false}
          value={username} onChange={(e) => setUsername(e.target.value)} aria-invalid={!!fields.username}
          aria-describedby={fields.username ? 'username-err' : undefined} autoFocus />
        {fields.username && <span className="err" id="username-err">{fields.username}</span>}
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <div className="pw-wrap">
          <input id="password" className="input" type={show ? 'text' : 'password'} autoComplete="current-password"
            value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!fields.password}
            aria-describedby={fields.password ? 'password-err' : undefined} />
          <button type="button" onClick={() => setShow((s) => !s)} aria-pressed={show}
            aria-label={show ? 'Hide password' : 'Show password'}>{show ? 'Hide' : 'Show'}</button>
        </div>
        {fields.password && <span className="err" id="password-err">{fields.password}</span>}
      </div>
      <button type="submit" className="a-btn primary" style={{ width: '100%', minHeight: 46 }} disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
