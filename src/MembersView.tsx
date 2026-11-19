import { useState } from 'react';
import { api } from './api.ts';
import type { Store } from './store.ts';
import { Avatar, EditableText } from './ui.tsx';

export function MembersView({ store }: { store: Store }) {
  const { state, run } = store;
  const [name, setName] = useState('');

  const add = () => {
    if (!name.trim()) return;
    run(() => api.addMember(name));
    setName('');
  };

  return (
    <section className="members">
      <h2>החבר׳ה</h2>
      <p className="hint">חברים פעילים מצורפים אוטומטית לכל שבוע חדש.</p>
      <ul className="rows">
        {state.members.map((m) => (
          <li key={m.id} className={`row ${m.active ? '' : 'inactive'}`}>
            <div className="who">
              <Avatar name={m.name} />
            </div>
            <div className="what">
              <EditableText value={m.name} ariaLabel="שם" onSave={(n) => run(() => api.updateMember(m.id, { name: n }))} />
            </div>
            <label className="toggle">
              <input
                type="checkbox"
                checked={m.active}
                onChange={(e) => run(() => api.updateMember(m.id, { active: e.target.checked }))}
              />
              פעיל
            </label>
            <button
              className="icon-btn"
              aria-label={`מחק את ${m.name}`}
              title="מחיקה (כולל כל ההיסטוריה שלו)"
              onClick={() => confirm(`למחוק את ${m.name} וכל ההיסטוריה שלו?`) && run(() => api.deleteMember(m.id))}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <form
        className="add-member"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="שם חדש" />
        <button className="btn" type="submit" disabled={!name.trim()}>
          הוסף
        </button>
      </form>
    </section>
  );
}
