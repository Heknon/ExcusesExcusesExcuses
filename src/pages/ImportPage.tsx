import { useMemo, useState } from 'react';
import { parseRound } from '../../shared/whatsapp.ts';
import { api, type NewWeek } from '../api.ts';
import { PageHeader } from '../components.tsx';
import { addDays, weekStart } from '../format.ts';
import { navigate } from '../router.tsx';
import { useStore } from '../store.ts';

interface Row {
  include: boolean;
  name: string;
  goal: string;
  excuseTarget: string;
  excuseReason: string;
  betTarget: string;
  betReason: string;
}

const EXAMPLE = `*ביצועים*
* מייקל - מכין פסטה
* אלי - ריצה בשישי 5 קמ

*מי תירוצים*
* מייקל - אלי, כי יש לו הרבה דברים

*מי יהיה ביצועים (הימורים)*
* אלי - מייקל כי הוא מאמין בו`;

function defaultStartDate(taken: Set<string>) {
  let d = weekStart();
  while (taken.has(d)) d = addDays(d, 7);
  return d;
}

export function ImportPage() {
  const { state, mutate } = useStore();
  const knownNames = useMemo(() => state.members.map((m) => m.name), [state.members]);
  const [text, setText] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [startDate, setStartDate] = useState(() => defaultStartDate(new Set(state.weeks.map((w) => w.startDate))));
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);

  const included = (rows ?? []).filter((r) => r.include && r.name.trim());
  const pickOptions = [...new Set([...knownNames, ...included.map((r) => r.name)])];
  const dateTaken = state.weeks.some((w) => w.startDate === startDate);

  const parse = () => {
    const result = parseRound(text, knownNames);
    setSkipped(result.skipped);
    setRows(
      result.rows.map((r) => ({
        include: true,
        name: r.name,
        goal: r.goal,
        excuseTarget: r.excuse?.target ?? '',
        excuseReason: r.excuse?.reason ?? '',
        betTarget: r.bet?.target ?? '',
        betReason: r.bet?.reason ?? '',
      })),
    );
  };

  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs!.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const save = async () => {
    setSaving(true);
    const week = await mutate(async () => {
      // Create members in message order first, then anyone who was only picked.
      const names = [...included.map((r) => r.name), ...included.flatMap((r) => [r.excuseTarget, r.betTarget])].filter(Boolean);
      const ids = new Map(state.members.map((m) => [m.name, m.id]));
      for (const n of new Set(names)) if (!ids.has(n)) ids.set(n, (await api.addMember(n)).id);
      const entries: NewWeek['entries'] = included.map((r) => ({
        memberId: ids.get(r.name)!,
        goal: r.goal,
        excusePickId: r.excuseTarget ? ids.get(r.excuseTarget)! : null,
        excuseReason: r.excuseReason,
        betPickId: r.betTarget ? ids.get(r.betTarget)! : null,
        betReason: r.betReason,
      }));
      return api.addWeek({ title, startDate, entries });
    });
    setSaving(false);
    if (week) navigate(`/weeks/${week.id}`);
  };

  return (
    <>
      <PageHeader title="Import from WhatsApp" />
      <p className="lede">
        Paste the week's message from the group. Sections are recognized by their headings (ביצועים, תירוצים, הימורים) and
        each line should read <code dir="rtl">* name - text</code>. You can review and correct everything before saving.
      </p>

      <textarea
        className="input paste"
        dir="auto"
        rows={12}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={EXAMPLE}
        aria-label="WhatsApp message"
      />
      <div className="form-actions">
        <button className="button primary" disabled={!text.trim()} onClick={parse}>
          Review
        </button>
      </div>

      {rows && rows.length === 0 && <p className="error-text">No lines were recognized. Check that the section headings are included.</p>}

      {rows && rows.length > 0 && (
        <section className="section">
          <h2 className="section-title">Review</h2>
          <div className="form-grid">
            <label>
              Week starting
              <input type="date" className="input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              {dateTaken && <span className="error-text small">A week already starts on this date.</span>}
            </label>
            <label>
              Title <span className="muted">(optional)</span>
              <input className="input" dir="auto" value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
          </div>

          <div className="table-scroll">
            <table className="table review">
              <thead>
                <tr>
                  <th aria-label="Include" />
                  <th>Name</th>
                  <th>Goal</th>
                  <th>Calls excuses on</th>
                  <th>Bets on</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className={r.include ? '' : 'is-excluded'}>
                    <td>
                      <input
                        type="checkbox"
                        checked={r.include}
                        aria-label={`Include ${r.name}`}
                        onChange={(e) => update(i, { include: e.target.checked })}
                      />
                    </td>
                    <td>
                      <input className="input" dir="auto" value={r.name} onChange={(e) => update(i, { name: e.target.value })} />
                      {!knownNames.includes(r.name) && <span className="muted small">New person</span>}
                    </td>
                    <td>
                      <textarea className="input" dir="auto" rows={3} value={r.goal} onChange={(e) => update(i, { goal: e.target.value })} />
                    </td>
                    {(['excuse', 'bet'] as const).map((kind) => (
                      <td key={kind}>
                        <select
                          className="input select"
                          value={r[`${kind}Target`]}
                          onChange={(e) => update(i, { [`${kind}Target`]: e.target.value })}
                        >
                          <option value="">No one</option>
                          {[...new Set([...pickOptions, r[`${kind}Target`]])]
                            .filter((n) => n && n !== r.name)
                            .map((n) => (
                              <option key={n} value={n}>
                                {n}
                              </option>
                            ))}
                        </select>
                        <textarea
                          className="input"
                          dir="auto"
                          rows={2}
                          value={r[`${kind}Reason`]}
                          onChange={(e) => update(i, { [`${kind}Reason`]: e.target.value })}
                          aria-label="Reason"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {skipped.length > 0 && (
            <details className="skipped">
              <summary>{skipped.length} line(s) not recognized</summary>
              <ul>
                {skipped.map((s, i) => (
                  <li key={i} dir="auto">
                    {s}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="form-actions">
            <button className="button primary" disabled={saving || !included.length || dateTaken} onClick={save}>
              {saving ? 'Saving…' : `Create week with ${included.length} people`}
            </button>
          </div>
        </section>
      )}
    </>
  );
}
