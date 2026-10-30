import { useState } from 'react';
import { api } from './api.ts';

export default function LogoutButton() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="link"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api.post('/api/admin/logout');
        } finally {
          window.location.href = '/admin/login';
        }
      }}
    >
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
