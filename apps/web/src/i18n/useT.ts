import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';
import {
  DEFAULT_LOCALE,
  translate,
  type Locale,
  type Translate,
  type StringVars,
} from './strings';

/**
 * Locale plumbing for the Taglish UI (R44).
 *
 * v1 ships one locale: Taglish (`tl`). There is no Settings screen in the plan
 * and no task owns a language picker, so the provider takes the locale as a
 * prop and defaults to `tl`; a future settings/toggle surface only has to pass
 * `locale="en"` and every screen, `aria-label` and status message follows
 * (recorded as a proposed ruling in the Task 9 report).
 *
 * The provider also keeps the document language honest: `<html lang>` is
 * updated whenever the locale changes, and `index.html`/the PWA manifest already
 * start at `tl`. That is what screen readers use to choose a voice; the
 * elements that render a mandated English sentence inside the Taglish UI tag
 * themselves with `lang="en"`.
 *
 * This file stays a `.ts` module (the plan's interface names `useT.ts`), so the
 * provider uses `createElement` instead of JSX.
 */
const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export interface LocaleProviderProps {
  /** Active UI locale; defaults to Taglish. */
  locale?: Locale;
  children: ReactNode;
}

export function LocaleProvider({ locale = DEFAULT_LOCALE, children }: LocaleProviderProps) {
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  return createElement(LocaleContext.Provider, { value: locale }, children);
}

/** The active locale; `tl` outside a provider. */
export function useLocale(): Locale {
  return useContext(LocaleContext);
}

export interface UseTResult {
  /** Translate a key into the active locale, filling `{name}` placeholders. */
  t: Translate;
  locale: Locale;
}

/**
 * `t(key, vars?)` plus the active `locale`.
 *
 * `t` is stable for a locale, so it is safe in effect dependency arrays. Keys
 * outside the module fall back to Taglish and then to the key itself instead of
 * throwing (a render must never crash for copy).
 */
export function useT(): UseTResult {
  const locale = useContext(LocaleContext);
  const t = useCallback<Translate>(
    (key: string, vars?: StringVars) => translate(locale, key, vars),
    [locale],
  );
  return useMemo(() => ({ t, locale }), [t, locale]);
}
