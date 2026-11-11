import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useCopy } from '../i18n';
import { mapActions } from '../map/store';

export type Detent = 'peek' | 'half' | 'full';

const DETENTS: Record<Detent, string> = {
  peek: 'h-[35dvh] min-h-[232px]',
  half: 'h-[58dvh]',
  full: 'h-[92dvh]',
};

const NEXT: Record<Detent, Detent> = { peek: 'half', half: 'full', full: 'peek' };

/**
 * The detent each screen asks for via `usePanelDetent` (kept in step with the
 * screens). Panels are created before those effects run, so deriving the first
 * render's height from the route makes a cold deep link paint the sheet at its
 * final size. Without it, Home starts at the default `half`, animates to
 * `peek` after mount and the 300 ms height transition is a measurable layout
 * shift on the first screen the rider sees.
 */
function initialDetentFor(pathname: string): Detent {
  if (pathname === '/search' || pathname === '/saved' || pathname === '/sources') return 'full';
  if (pathname === '/plan' || pathname.startsWith('/trip/')) return 'half';
  return 'peek';
}

interface PanelValue {
  detent: Detent;
  setDetent: (detent: Detent) => void;
}

const PanelContext = createContext<PanelValue>({ detent: 'half', setDetent: () => undefined });

export function usePanel(): PanelValue {
  return useContext(PanelContext);
}

/** A screen's preferred sheet height on mobile (desktop is always the sidebar). */
export function usePanelDetent(detent: Detent): void {
  const { setDetent } = usePanel();
  useEffect(() => {
    setDetent(detent);
  }, [detent, setDetent]);
}

/**
 * The one surface every screen renders into: a BetterGov-style card panel that
 * is a bottom sheet on phones and the left sidebar on desktop.
 */
export function Panel({ children }: { children: ReactNode }) {
  const { t } = useCopy();
  const [detent, setDetent] = useState<Detent>(() =>
    typeof window === 'undefined' ? 'half' : initialDetentFor(window.location.pathname),
  );
  const [desktop, setDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches,
  );
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)');
    const onChange = (event: MediaQueryListEvent) => setDesktop(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  // Tell the map how much chrome covers it, so route fits stay visible.
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const publish = () => {
      const rect = element.getBoundingClientRect();
      mapActions.setInset(
        // Desktop: the map sits beside the sidebar, so only the mobile sheet
        // overlaps map pixels.
        desktop ? { left: 0, bottom: 0 } : { bottom: rect.height, left: 0 },
      );
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(element);
    return () => observer.disconnect();
  }, [desktop, detent]);

  return (
    <PanelContext.Provider value={{ detent, setDetent }}>
      <aside
        id="biyahey-panel"
        ref={ref}
        aria-label={t('panel.label')}
        className={`fixed inset-x-0 bottom-0 z-30 flex flex-col overflow-hidden rounded-t-2xl bg-white shadow-[0_-8px_28px_rgba(0,0,0,0.16)] transition-[height] duration-300 ease-out lg:static lg:z-auto lg:h-full lg:w-[400px] lg:shrink-0 lg:rounded-none lg:border-r lg:border-line lg:shadow-none lg:transition-none ${
          desktop ? '' : DETENTS[detent]
        }`}
      >
        <button
          type="button"
          onClick={() => setDetent(NEXT[detent])}
          aria-label={detent === 'full' ? t('panel.collapse') : t('panel.expand')}
          aria-expanded={detent !== 'peek'}
          className="flex h-7 w-full shrink-0 items-center justify-center pt-2 lg:hidden"
        >
          <span aria-hidden="true" className="block h-1.5 w-10 rounded-full bg-line-strong" />
        </button>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
          {children}
        </div>
      </aside>
    </PanelContext.Provider>
  );
}
