import { useMemo } from 'react';
import { POINTS, computeStats } from '../shared/scoring.ts';
import type { AppState } from '../shared/types.ts';
import { Avatar, Empty, formatDate } from './ui.tsx';

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');

export function Leaderboard({ state }: { state: AppState }) {
  const stats = useMemo(() => computeStats(state), [state]);
  const name = (id: number) => state.members.find((m) => m.id === id)?.name ?? '?';
  const played = stats.filter((s) => s.weeks > 0);

  const best = <K extends keyof (typeof stats)[number]>(key: K, min = 1) => {
    const top = [...played].sort((a, b) => (b[key] as number) - (a[key] as number))[0];
    return top && (top[key] as number) >= min ? top : null;
  };
  /** Everyone tied with the winner on the same key, so a tie never looks like a win. */
  const tiedWith = (winner: (typeof stats)[number], key: keyof (typeof stats)[number] | 'accuracy') =>
    played.filter((s) => (key === 'accuracy' ? acc(s) === acc(winner) : s[key] === winner[key])).map((s) => name(s.memberId));
  const acc = (s: (typeof stats)[number]) => (s.excuseHits + s.betHits) / Math.max(1, s.excuseCalls + s.betCalls);
  const prophet = [...played]
    .filter((s) => s.excuseCalls + s.betCalls > 0)
    .sort(
      (a, b) =>
        (b.excuseHits + b.betHits) / (b.excuseCalls + b.betCalls) - (a.excuseHits + a.betHits) / (a.excuseCalls + a.betCalls),
    )[0];

  const awards = [
    { icon: '👑', title: 'מלך הביצועים', key: 'done', who: best('done'), detail: (s: any) => `${s.done} ביצועים` },
    { icon: '🙄', title: 'מלך התירוצים', key: 'failed', who: best('failed'), detail: (s: any) => `${s.failed} תירוצים` },
    {
      icon: '🔮',
      title: 'הנביא',
      key: 'accuracy',
      who: prophet ?? null,
      detail: (s: any) => `${pct(s.excuseHits + s.betHits, s.excuseCalls + s.betCalls)} פגיעה`,
    },
    { icon: '🔥', title: 'ברצף', key: 'streak', who: best('streak', 2), detail: (s: any) => `${s.streak} שבועות ברצף` },
    { icon: '🤨', title: 'הכי מפוקפק', key: 'doubtedBy', who: best('doubtedBy'), detail: (s: any) => `${s.doubtedBy} פקפוקים` },
  ]
    .filter((a) => a.who)
    .map((a) => ({ ...a, names: tiedWith(a.who!, a.key as any) }));

  const excuses = state.entries
    .filter((e) => e.excuse && (e.outcome === 'failed' || e.outcome === 'partial'))
    .map((e) => ({ ...e, week: state.weeks.find((w) => w.id === e.weekId) }))
    .sort((a, b) => (b.week?.startDate ?? '').localeCompare(a.week?.startDate ?? ''));

  if (!played.length) {
    return (
      <Empty>
        עוד אין תוצאות. בסוף השבוע סמנו בלשונית <b>תוצאות</b> מי ביצע ומי הביא תירוץ – והטבלה תתמלא.
      </Empty>
    );
  }

  return (
    <section className="board">
      {awards.length > 0 && (
        <div className="awards">
          {awards.map((a) => (
            <div key={a.title} className="award">
              <span className="award-icon" aria-hidden>
                {a.icon}
              </span>
              <span className="award-title">{a.title}</span>
              <span className="award-who">
                {a.names.length > 2 ? `${a.names.slice(0, 2).join(', ')} +${a.names.length - 2}` : a.names.join(', ')}
              </span>
              <span className="award-detail">{a.detail(a.who)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>שם</th>
              <th>נקודות</th>
              <th title="ביצע / חצי / תירוצים">✅ / 🤏 / 🙄</th>
              <th title="ניחש נכון מי יביא תירוצים">ניחוש תירוצים</th>
              <th title="ניחש נכון מי יבצע">ניחוש הימורים</th>
              <th>רצף</th>
            </tr>
          </thead>
          <tbody>
            {played.map((s, i) => (
              <tr key={s.memberId}>
                <td className="rank">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</td>
                <td>
                  <span className="who inline">
                    <Avatar name={name(s.memberId)} size={26} />
                    {name(s.memberId)}
                  </span>
                </td>
                <td className="num strong">{s.points}</td>
                <td className="num">
                  {s.done} / {s.partial} / {s.failed}
                </td>
                <td className="num">
                  {s.excuseHits}/{s.excuseCalls} <small>{pct(s.excuseHits, s.excuseCalls)}</small>
                </td>
                <td className="num">
                  {s.betHits}/{s.betCalls} <small>{pct(s.betHits, s.betCalls)}</small>
                </td>
                <td className="num">{s.streak ? `🔥${s.streak}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details className="rules">
        <summary>איך סופרים נקודות?</summary>
        <ul>
          <li>ביצעת את המשימה: <b>{POINTS.done}</b> נק׳ · חצי: <b>{POINTS.partial}</b> · תירוצים: <b>{POINTS.failed}</b></li>
          <li>ניחשת נכון מי יביא תירוצים: <b>+{POINTS.excuseHit}</b></li>
          <li>הימרת נכון על מי שביצע: <b>+{POINTS.betHit}</b></li>
          <li>נספרים רק שבועות שבהם סומנה תוצאה.</li>
        </ul>
      </details>

      {excuses.length > 0 && (
        <div className="hall">
          <h2>🏛️ היכל התירוצים</h2>
          <ul>
            {excuses.map((e) => (
              <li key={`${e.weekId}-${e.memberId}`}>
                <blockquote>“{e.excuse}”</blockquote>
                <cite>
                  — {name(e.memberId)}, {e.week ? e.week.title || formatDate(e.week.startDate) : ''}
                  {e.goal ? ` (על: ${e.goal})` : ''}
                </cite>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
