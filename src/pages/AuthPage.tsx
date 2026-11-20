import { useState, type FormEvent } from 'react';
import { api } from '../api.ts';
import { Link, navigate } from '../router.tsx';
import { useSession } from '../session.tsx';
import { Button } from '../ui.tsx';

export function AuthPage({ mode, next }: { mode: 'login' | 'signup'; next: string }) {
  const { refresh } = useSession();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const isSignup = mode === 'signup';
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  const other = `${isSignup ? '/login' : '/signup'}${safeNext !== '/' ? `?next=${encodeURIComponent(safeNext)}` : ''}`;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (isSignup) await api.signup({ email, name, password });
      else await api.login({ email, password });
      await refresh();
      navigate(safeNext, { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <aside className="auth-brand">
        <div className="wordmark wordmark-xl">
          Excuses,
          <br />
          excuses,
          <br />
          <span>excuses.</span>
        </div>
        <ol className="auth-rules">
          <li>
            <b>Commit.</b> Every week, say what you’ll get done.
          </li>
          <li>
            <b>Call it.</b> Pick who’ll come back with excuses.
          </li>
          <li>
            <b>Back someone.</b> Bet on who’ll actually deliver.
          </li>
        </ol>
        <p className="auth-foot">Picks stay secret until the week starts. Points for doing it, and for reading your friends right.</p>
      </aside>

      <main className="auth-main">
        <form className="auth-card" onSubmit={submit} noValidate>
          <h1>{isSignup ? 'Create your account' : 'Welcome back'}</h1>
          <p className="muted">{isSignup ? 'You’ll use this to join your group’s game.' : 'Sign in to see this week’s round.'}</p>

          {isSignup && (
            <label className="field">
              <span className="field-label">Your name</span>
              <input className="input" dir="auto" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={40} required autoFocus />
            </label>
          )}
          <label className="field">
            <span className="field-label">Email</span>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
              autoFocus={!isSignup}
            />
          </label>
          <label className="field">
            <span className="field-label">Password</span>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              minLength={8}
              required
            />
            {isSignup && <span className="field-hint">At least 8 characters.</span>}
          </label>

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          <Button type="submit" variant="primary" size="lg" loading={busy} className="btn-block">
            {isSignup ? 'Create account' : 'Sign in'}
          </Button>

          <p className="auth-switch">
            {isSignup ? 'Already have an account?' : 'New here?'} <Link to={other}>{isSignup ? 'Sign in' : 'Create an account'}</Link>
          </p>
        </form>
      </main>
    </div>
  );
}
