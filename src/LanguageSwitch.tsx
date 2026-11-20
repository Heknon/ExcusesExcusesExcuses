import type { Locale } from '../shared/types.ts';
import { api } from './api.ts';
import { useI18n } from './i18n.tsx';
import { useSession } from './session.tsx';

/** EN | עב switch. Saves to the account when signed in, otherwise to this device. */
export function LanguageSwitch({ className }: { className?: string }) {
  const { locale, setLocale, t } = useI18n();
  const { state, refresh } = useSession();
  const choose = async (l: Locale) => {
    setLocale(l);
    if (state.status === 'signedIn') {
      await api.updateProfile({ locale: l }).catch(() => {});
      refresh();
    }
  };
  return (
    <div className={`lang-switch ${className ?? ''}`} role="radiogroup" aria-label={t.language}>
      {(
        [
          ['en', 'EN', 'English'],
          ['he', 'עב', 'עברית'],
        ] as const
      ).map(([l, short, full]) => (
        <button key={l} type="button" role="radio" aria-checked={locale === l} aria-label={full} lang={l} onClick={() => choose(l)}>
          {short}
        </button>
      ))}
    </div>
  );
}
