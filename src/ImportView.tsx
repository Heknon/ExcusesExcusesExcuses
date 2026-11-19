import { useMemo, useState } from 'react';
import { parseRound } from '../shared/whatsapp.ts';
import type { EntryPatch } from '../shared/types.ts';
import { api } from './api.ts';
import type { Store } from './store.ts';
import { thisSunday } from './ui.tsx';

interface DraftRow {
  name: string;
  include: boolean;
  goal: string;
  excuseTarget: string;
  excuseReason: string;
  betTarget: string;
  betReason: string;
}

export function ImportView({ store, onDone }: { store: Store; onDone: (weekId: number) => void }) {
  const { state, run } = store;
  const [text, setText] = useState('');
  const [startDate, setStartDate] = useState(thisSunday());
  const [title, setTitle] = useState('');
  const [rows, setRows] = useState<DraftRow[] | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const knownNames = useMemo(() => state.members.map((m) => m.name), [state.members]);
  const allNames = useMemo(
    () => [...new Set([...knownNames, ...(rows ?? []).filter((r) => r.include).map((r) => r.name)])],
    [knownNames, rows],
  );

  const parse = () => {
    const r = parseRound(text, knownNames);
    setSkipped(r.skipped);
    setRows(
      r.rows.map((p) => ({
        name: p.name,
        include: true,
        goal: p.goal,
        excuseTarget: p.excuse?.target ?? '',
        excuseReason: p.excuse?.reason ?? '',
        betTarget: p.bet?.target ?? '',
        betReason: p.bet?.reason ?? '',
      })),
    );
  };

  const update = (i: number, p: Partial<DraftRow>) =>
    setRows((rs) => rs!.map((r, j) => (j === i ? { ...r, ...p } : r)));

  const save = async () => {
    if (!rows) return;
    setSaving(true);
    let newWeekId = 0;
    await run(async () => {
      const included = rows.filter((r) => r.include && r.name.trim());
      // Make sure everyone (including pick targets) exists as a member.
      // Participants first (in message order), then anyone who was only picked.
      const needed = new Set([...included.map((r) => r.name), ...included.flatMap((r) => [r.excuseTarget, r.betTarget])].filter(Boolean));
      const ids = new Map(state.members.map((m) => [m.name, m.id]));
      for (const n of needed) if (!ids.has(n)) ids.set(n, (await api.addMember(n)).id);
      const entries: (EntryPatch & { memberId: number })[] = included.map((r) => ({
        memberId: ids.get(r.name)!,
        goal: r.goal,
        excusePickId: r.excuseTarget ? ids.get(r.excuseTarget)! : null,
        excuseReason: r.excuseReason,
        betPickId: r.betTarget ? ids.get(r.betTarget)! : null,
        betReason: r.betReason,
      }));
      newWeekId = (await api.addWeek({ title, startDate, entries })).id;
    });
    setSaving(false);
    if (newWeekId) onDone(newWeekId);
  };

  return (
    <section className="import">
      <h2>ייבוא סבב מוואטסאפ</h2>
      <p className="hint">
        הדביקו את ההודעה מהקבוצה (עם הכותרות <b>ביצועים</b>, <b>תירוצים</b>, <b>הימורים</b>). אפשר לתקן הכל לפני השמירה.
      </p>
      <textarea
        className="field paste"
        dir="rtl"
        rows={10}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'*ביצועים*\n* מייקל - מכין פסטה עם חיה\n…\n\n*מי תירוצים*\n* מייקל - אלי, כי…\n\n*מי יהיה ביצועים (הימורים)*\n* מייקל - רינגלר כי…'}
      />
      <div className="import-bar">
        <button className="btn" disabled={!text.trim()} onClick={parse}>
          פענח ←
        </button>
      </div>

      {rows && (
        <>
          {rows.length === 0 ? (
            <p className="warn">לא מצאתי שורות. ודאו שיש כותרות ושכל שורה בצורה “שם - טקסט”.</p>
          ) : (
            <>
              <div className="import-meta">
                <label>
                  שבוע שמתחיל ב־
                  <input type="date" className="field date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </label>
                <label>
                  שם (לא חובה)
                  <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="למשל: שבוע 1" />
                </label>
              </div>
              <div className="table-wrap">
                <table className="table preview">
                  <thead>
                    <tr>
                      <th></th>
                      <th>שם</th>
                      <th className="c-goals">ביצועים</th>
                      <th className="c-excuses">תירוצים</th>
                      <th className="c-bets">הימורים</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} className={r.include ? '' : 'off'}>
                        <td>
                          <input
                            type="checkbox"
                            checked={r.include}
                            aria-label={`לכלול את ${r.name}`}
                            onChange={(e) => update(i, { include: e.target.checked })}
                          />
                        </td>
                        <td>
                          <input className="field name" value={r.name} onChange={(e) => update(i, { name: e.target.value })} />
                          {!knownNames.includes(r.name) && <span className="new-tag">חדש</span>}
                        </td>
                        <td>
                          <textarea className="field" rows={Math.max(2, Math.ceil(r.goal.length / 22))} value={r.goal} onChange={(e) => update(i, { goal: e.target.value })} />
                        </td>
                        {(['excuse', 'bet'] as const).map((k) => (
                          <td key={k}>
                            <select
                              className="field select"
                              value={r[`${k}Target`]}
                              onChange={(e) => update(i, { [`${k}Target`]: e.target.value })}
                            >
                              <option value="">—</option>
                              {[...new Set([...allNames, r[`${k}Target`]])]
                                .filter((n) => n && n !== r.name)
                                .map((n) => (
                                  <option key={n} value={n}>
                                    {n}
                                  </option>
                                ))}
                            </select>
                            <textarea
                              className="field reason"
                              rows={2}
                              value={r[`${k}Reason`]}
                              onChange={(e) => update(i, { [`${k}Reason`]: e.target.value })}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {skipped.length > 0 && (
                <details className="warn">
                  <summary>{skipped.length} שורות לא זוהו</summary>
                  <ul>
                    {skipped.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </details>
              )}
              <div className="import-bar">
                <button className="btn primary" disabled={saving} onClick={save}>
                  {saving ? 'שומר…' : `צור שבוע עם ${rows.filter((r) => r.include).length} משתתפים`}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
