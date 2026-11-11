import { Bookmark } from 'lucide-react';
import { Link, NavLink } from 'react-router-dom';
import { useCopy } from '../i18n';
import { LocaleToggle } from './LocaleToggle';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-2 text-sm font-semibold transition ${
    isActive ? 'bg-brand-tint text-brand' : 'text-ink-soft hover:bg-canvas hover:text-ink'
  }`;

/** BetterGov-style chrome: navy utility bar over a white, sticky service bar. */
export function Header() {
  const { t } = useCopy();

  return (
    <header className="sticky top-0 z-40 bg-white shadow-sm">
      <div className="hidden h-9 items-center justify-between gap-4 bg-navy px-4 text-xs text-white/80 md:flex lg:px-6">
        <p className="truncate">{t('app.communityPortal')}</p>
        <div className="flex items-center gap-4">
          <a href="https://bettergov.ph" className="hover:text-white hover:underline">
            {t('app.bettergov')}
          </a>
          <Link to="/sources" className="hover:text-white hover:underline">
            {t('nav.data')}
          </Link>
          <a
            href="https://github.com/bettergovph"
            className="hover:text-white hover:underline"
            rel="noreferrer"
          >
            {t('app.github')}
          </a>
          <LocaleToggle tone="dark" />
        </div>
      </div>

      <div className="flex h-14 items-center justify-between gap-3 px-4 lg:px-6">
        <Link to="/" className="flex min-w-0 items-center gap-2">
          <img src="/icons/mark.svg" alt="" className="size-8 shrink-0" />
          <span className="text-lg font-bold tracking-tight text-ink">BiyaHey!</span>
          <span className="hidden truncate text-xs text-ink-faint sm:inline">
            · {t('app.tagline')}
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex" aria-label={t('nav.menu')}>
          <NavLink to="/search" className={navLinkClass}>
            {t('nav.plan')}
          </NavLink>
          <NavLink to="/saved" className={navLinkClass}>
            {t('nav.saved')}
          </NavLink>
          <NavLink to="/sources" className={navLinkClass}>
            {t('nav.data')}
          </NavLink>
        </nav>

        <div className="flex items-center gap-2 md:hidden">
          <LocaleToggle />
          <Link
            to="/saved"
            aria-label={t('nav.saved')}
            className="flex size-9 items-center justify-center rounded-md border border-line text-ink-soft"
          >
            <Bookmark aria-hidden="true" className="size-4" />
          </Link>
        </div>
      </div>
    </header>
  );
}
