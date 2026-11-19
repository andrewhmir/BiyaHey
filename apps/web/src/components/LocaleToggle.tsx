import { useCopy } from '../i18n';
import type { Locale } from '../copy';

/** TL / EN segmented control, in the utility-bar style. */
export function LocaleToggle({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const { locale, setLocale, t } = useCopy();
  const options: { value: Locale; label: string }[] = [
    { value: 'tl', label: t('lang.tl') },
    { value: 'en', label: t('lang.en') },
  ];
  const activeClass = tone === 'dark' ? 'bg-white text-navy' : 'bg-brand text-white';
  const idleClass =
    tone === 'dark' ? 'text-white/70 hover:text-white' : 'text-ink-soft hover:text-ink';

  return (
    <div
      role="group"
      aria-label={t('lang.switch')}
      className={
        tone === 'dark'
          ? 'flex items-center gap-0.5 rounded-md bg-white/10 p-0.5'
          : 'flex items-center gap-0.5 rounded-md border border-line bg-canvas p-0.5'
      }
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          lang={option.value === 'tl' ? 'tl' : 'en'}
          aria-pressed={locale === option.value}
          onClick={() => setLocale(option.value)}
          className={`rounded px-2 py-0.5 text-xs font-semibold transition ${
            locale === option.value ? activeClass : idleClass
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
