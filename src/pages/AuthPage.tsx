import { useState, type FormEvent } from 'react';
import { api } from '../api.ts';
import { LanguageSwitch } from '../LanguageSwitch.tsx';
import { useI18n } from '../i18n.tsx';
import { Link, navigate } from '../router.tsx';
import { useSession } from '../session.tsx';
import { Button } from '../ui.tsx';

export function AuthPage({ mode, next }: { mode: 'login' | 'signup'; next: string }) {
  const { refresh } = useSession();
  const { t, locale, errorText } = useI18n();
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
      if (isSignup) await api.signup({ email, name, password, locale });
      else await api.login({ email, password });
      await refresh();
      navigate(safeNext, { replace: true });
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <aside className="auth-brand">
        <div className="wordmark wordmark-xl">
          {t.wordmarkLines[0]}
          <br />
          {t.wordmarkLines[1]}
          <br />
          <span>{t.wordmarkLines[2]}</span>
        </div>
        <ol className="auth-rules">
          {t.auth.rules.map(([lead, text]) => (
            <li key={lead}>
              <span>
                <b>{lead}</b> {text}
              </span>
            </li>
          ))}
        </ol>
        <p className="auth-foot">{t.auth.foot}</p>
      </aside>

      <main className="auth-main">
        <LanguageSwitch className="auth-lang" />
        <form className="auth-card" onSubmit={submit} noValidate>
          <h1>{isSignup ? t.auth.signupTitle : t.auth.loginTitle}</h1>
          <p className="muted">{isSignup ? t.auth.signupSub : t.auth.loginSub}</p>

          {isSignup && (
            <label className="field">
              <span className="field-label">{t.auth.name}</span>
              <input className="input" dir="auto" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={40} required autoFocus />
            </label>
          )}
          <label className="field">
            <span className="field-label">{t.auth.email}</span>
            <input
              className="input"
              type="email"
              dir="ltr"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              autoCapitalize="none"
              required
              autoFocus={!isSignup}
            />
          </label>
          <label className="field">
            <span className="field-label">{t.auth.password}</span>
            <input
              className="input"
              type="password"
              dir="ltr"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              minLength={8}
              required
            />
            {isSignup && <span className="field-hint">{t.auth.passwordHint}</span>}
          </label>

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          <Button type="submit" variant="primary" size="lg" loading={busy} className="btn-block">
            {isSignup ? t.auth.signupCta : t.auth.loginCta}
          </Button>

          <p className="auth-switch">
            {isSignup ? t.auth.haveAccount : t.auth.newHere} <Link to={other}>{isSignup ? t.auth.toLogin : t.auth.toSignup}</Link>
          </p>
        </form>
      </main>
    </div>
  );
}
