import { useEffect, useState } from 'react';
import { ApiError, api } from '../api.ts';
import { plural } from '../format.ts';
import { Link, navigate } from '../router.tsx';
import { useSession } from '../session.tsx';
import { Button, Icon, Spinner } from '../ui.tsx';

type Invite = Awaited<ReturnType<typeof api.lookupInvite>>;

export function JoinPage({ code }: { code: string }) {
  const { refresh } = useSession();
  const [invite, setInvite] = useState<Invite | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.lookupInvite(code).then(setInvite, (e: ApiError) => setError(e.message));
  }, [code]);

  const join = async () => {
    setBusy(true);
    try {
      const r = await api.requestJoin(code);
      await refresh();
      if (r.status === 'active') navigate(`/g/${r.id}`, { replace: true });
      else setInvite((i) => i && { ...i, status: 'pending' });
    } catch (e) {
      setError((e as Error).message);
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
          <h1>Invite not found</h1>
          <p className="muted">{error}. Check the code with whoever sent it — admins can reset codes.</p>
          <Link to="/" className="btn btn-secondary btn-md">
            Back to your games
          </Link>
        </div>
      </div>
    );
  }
  if (!invite) return <Spinner />;

  return (
    <div className="page page-narrow">
      <div className="join-card">
        <p className="eyebrow">You’re invited to</p>
        <h1 className="display" dir="auto">
          {invite.name}
        </h1>
        <p className="muted">{plural(invite.players, 'player')} so far</p>

        {invite.status === 'active' ? (
          <Button variant="primary" size="lg" onClick={() => navigate(`/g/${invite.id}`)}>
            You’re in — open the game
          </Button>
        ) : invite.status === 'pending' ? (
          <div className="join-waiting">
            <Icon name="clock" />
            <div>
              <b>Request sent.</b>
              <p className="muted">An admin will let you in. The game will show up on your home screen once they do.</p>
            </div>
          </div>
        ) : (
          <>
            <Button variant="primary" size="lg" loading={busy} onClick={join}>
              Ask to join
            </Button>
            <p className="muted small">The game’s admin approves every new player.</p>
          </>
        )}
        <Link to="/" className="join-back">
          <Icon name="chevronLeft" size={16} /> Your games
        </Link>
      </div>
    </div>
  );
}
