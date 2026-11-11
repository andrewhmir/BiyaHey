import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useCopy } from '../../i18n';

/** The honest notice shown when a `/trip/:id` link has nothing left to resolve. */
export function NoTripNotice({ message }: { message: string }) {
  const { t } = useCopy();
  return (
    <div className="px-5 py-6">
      <h1 className="text-xl font-bold text-ink">{t('plan.noRouteTitle')}</h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-soft">{message}</p>
      <Link
        to="/search"
        className="mt-5 inline-flex min-h-12 items-center gap-2 rounded-md bg-brand px-4 text-sm font-semibold text-white transition hover:bg-brand-strong"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t('plan.backToSearch')}
      </Link>
    </div>
  );
}
