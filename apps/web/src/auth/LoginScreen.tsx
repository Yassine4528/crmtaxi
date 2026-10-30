import type { SessionUser } from '@taxi-crm/domain';
import { useState, type FormEvent } from 'react';
import { ApiError, api } from '../api/client.ts';

export function LoginScreen({ onLogin }: { onLogin: (user: SessionUser) => void }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api.post<{ user: SessionUser }>(
        '/api/auth/login',
        { login, password },
        { expectUnauthorized: true },
      );
      onLogin(res.user);
    } catch (err) {
      setPassword('');
      setError(err instanceof ApiError ? err.message : 'Une erreur est survenue.');
      setBusy(false);
    }
  };

  return (
    <div id="login">
      <form className="box" onSubmit={(e) => void submit(e)}>
        <h2>Connexion</h2>
        <label htmlFor="login-user">Identifiant</label>
        <input
          id="login-user"
          type="text"
          autoFocus
          required
          autoComplete="username"
          placeholder="Votre prénom"
          value={login}
          onChange={(e) => setLogin(e.target.value)}
        />
        <label htmlFor="login-password">Code d'accès</label>
        <input
          id="login-password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <div className="err" role="alert">
          {error}
        </div>
        <div className="btns">
          <button className="p" disabled={busy}>
            Entrer
          </button>
        </div>
      </form>
    </div>
  );
}
