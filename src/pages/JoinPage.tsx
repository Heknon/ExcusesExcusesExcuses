import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { Link, navigate } from '../router.tsx';
import { useSession } from '../session.tsx';
import { Button, Icon, Spinner } from '../ui.tsx';

type Invite = Awaited<ReturnType<typeof api.lookupInvite>>;

export function JoinPage({ code }: { code: string }) {
  const { refresh } = useSession();
  const { t, errorText } = useI18n();
  const [invite, setInvite] = useState<Invite | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.lookupInvite(code).then(setInvite, setError);
  }, [code]);

  const join = async () => {
    setBusy(true);
    try {
      const r = await api.requestJoin(code);
      await refresh();
      if (r.status === 'active') navigate(`/g/${r.id}`, { replace: true });
      else setInvite((i) => i && { ...i, status: 'pending' });
    } catch (e) {
      setError(e);
    }
    setBusy(false);
  };

  if (error) {
    return (
      <div className="page page-narrow">
        <div className="join-card">
          <span className="join-icon is-error">
            <Icon name="x" size={24} />
          </span>
          <h1>{t.join.notFoundTitle}</h1>
          <p className="muted">
            {errorText(error)}. {t.join.notFoundBody}
          </p>
          <Link to="/" className="btn btn-secondary btn-md">
            {t.common.yourGames}
          </Link>
        </div>
      </div>
    );
  }
  if (!invite) return <Spinner />;

  return (
    <div className="page page-narrow">
      <div className="join-card">
        <p className="eyebrow">{t.join.invitedTo}</p>
        <h1 className="display" dir="auto">
          {invite.name}
        </h1>
        <p className="muted">{t.join.soFar(invite.players)}</p>

        {invite.status === 'active' ? (
          <Button variant="primary" size="lg" onClick={() => navigate(`/g/${invite.id}`)}>
            {t.join.openGame}
          </Button>
        ) : invite.status === 'pending' ? (
          <div className="join-waiting">
            <Icon name="clock" />
            <div>
              <b>{t.join.sentTitle}</b>
              <p className="muted">{t.join.sentBody}</p>
            </div>
          </div>
        ) : (
          <>
            <Button variant="primary" size="lg" loading={busy} onClick={join}>
              {t.join.ask}
            </Button>
            <p className="muted small">{t.join.askHint}</p>
          </>
        )}
        <Link to="/" className="join-back">
          <Icon name="chevronLeft" size={16} /> {t.common.yourGames}
        </Link>
      </div>
    </div>
  );
}
