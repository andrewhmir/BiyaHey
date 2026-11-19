import { Link } from 'react-router-dom';
import { useCopy } from '../i18n';

/** Footer: provenance, licence and where to contribute. */
export function Footer() {
  const { t } = useCopy();

  return (
    <footer className="mt-6 bg-ink px-5 py-6 text-sm text-white/70">
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-base font-bold text-white">BiyaHey!</p>
          <p className="mt-1 text-xs text-white/60">{t('app.partOf')} · {t('app.tagline')}</p>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs">
          <Link to="/sources" className="text-white/80 hover:text-white hover:underline">
            {t('footer.linkData')}
          </Link>
          <a
            href="https://github.com/andrewhmir/BiyaHey"
            className="text-white/80 hover:text-white hover:underline"
            rel="noreferrer"
          >
            {t('app.github')}
          </a>
        </div>
        <div className="border-t border-white/10 pt-3 text-[11px] leading-relaxed text-white/50">
          <p>{t('footer.data')}</p>
          <p className="mt-1">{t('footer.licence')}</p>
        </div>
      </div>
    </footer>
  );
}
