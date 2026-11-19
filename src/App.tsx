import { useEffect, useState } from 'react';
import { api, setPasscode } from './api.ts';
import { useAppState } from './store.ts';
import { WeekView } from './WeekView.tsx';
import { Leaderboard } from './Leaderboard.tsx';
import { ImportView } from './ImportView.tsx';
import { MembersView } from './MembersView.tsx';
import { Empty, formatDate, thisSunday } from './ui.tsx';

type View = 'week' | 'board' | 'import' | 'members';

const NAV: { id: View; label: string }[] = [
  { id: 'week', label: '📅 השבוע' },
  { id: 'board', label: '🏆 טבלה' },
  { id: 'import', label: '📥 ייבוא' },
  { id: 'members', label: '👥 חברים' },
];

export function App() {
  const store = useAppState();
  const { state, status, error, setError, run } = store;
  const [view, setView] = useState<View>('week');
  const [weekId, setWeekId] = useState<number | null>(null);

  useEffect(() => {
    if (weekId != null && state.weeks.some((w) => w.id === weekId)) return;
    setWeekId(state.weeks[0]?.id ?? null);
  }, [state.weeks, weekId]);

  if (status === 'locked') return <PasscodeGate onSubmit={() => store.reload()} />;
  if (status === 'loading') return <div className="splash">טוען תירוצים…</div>;

  const week = state.weeks.find((w) => w.id === weekId) ?? null;

  const newWeek = () =>
    run(async () => {
      const taken = new Set(state.weeks.map((w) => w.startDate));
      const date = taken.has(thisSunday()) ? nextFreeSunday(taken) : thisSunday();
      const w = await api.addWeek({ startDate: date });
      setWeekId(w.id);
    });

  return (
    <div className="app">
      <header className="top">
        <h1 className="logo">
          <span>Excuses</span> <span>Excuses</span> <span>Excuses</span>
        </h1>
        <p className="tagline">א ביצועים · א תירוצים · א הימורים</p>
        <nav className="nav">
          {NAV.map((n) => (
            <button key={n.id} className={`nav-btn ${view === n.id ? 'on' : ''}`} onClick={() => setView(n.id)}>
              {n.label}
            </button>
          ))}
        </nav>
      </header>

      {error && (
        <div className="toast" role="alert" onClick={() => setError('')}>
          ⚠️ {error}
        </div>
      )}
      {status === 'error' && <Empty>אין חיבור לשרת. {error}</Empty>}

      <main>
        {view === 'week' && (
          <>
            <div className="week-picker">
              <button className="btn primary" onClick={newWeek} disabled={!state.members.length}>
                + שבוע חדש
              </button>
              <div className="week-pills">
                {state.weeks.map((w) => (
                  <button key={w.id} className={`pill ${w.id === weekId ? 'on' : ''}`} onClick={() => setWeekId(w.id)}>
                    {w.closed ? '🔒 ' : ''}
                    {w.title || formatDate(w.startDate)}
                  </button>
                ))}
              </div>
            </div>
            {week ? (
              <WeekView key={week.id} store={store} week={week} onDeleted={() => setWeekId(null)} />
            ) : (
              <Empty>
                <p>עוד אין שבועות.</p>
                <p>
                  הכי מהיר: <button className="link" onClick={() => setView('import')}>להדביק את ההודעה מהוואטסאפ</button>
                  {' '}או <button className="link" onClick={() => setView('members')}>להוסיף חברים</button> ואז “שבוע חדש”.
                </p>
              </Empty>
            )}
          </>
        )}
        {view === 'board' && <Leaderboard state={state} />}
        {view === 'import' && (
          <ImportView
            store={store}
            onDone={(id) => {
              setWeekId(id);
              setView('week');
            }}
          />
        )}
        {view === 'members' && <MembersView store={store} />}
      </main>
    </div>
  );
}

function nextFreeSunday(taken: Set<string>) {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay());
  const pad = (n: number) => String(n).padStart(2, '0');
  for (;;) {
    d.setDate(d.getDate() + 7);
    const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    if (!taken.has(iso)) return iso;
  }
}

function PasscodeGate({ onSubmit }: { onSubmit: () => void }) {
  const [v, setV] = useState('');
  return (
    <div className="gate">
      <h1 className="logo">
        <span>Excuses</span> <span>Excuses</span> <span>Excuses</span>
      </h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setPasscode(v);
          onSubmit();
        }}
      >
        <label>
          סיסמת הקבוצה
          <input className="field" type="password" value={v} autoFocus onChange={(e) => setV(e.target.value)} />
        </label>
        <button className="btn primary" type="submit">
          כניסה
        </button>
      </form>
    </div>
  );
}
