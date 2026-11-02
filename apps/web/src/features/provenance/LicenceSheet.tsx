import type { DataSource } from '@biyahey/shared';
import { useEffect, useId, useRef } from 'react';
import { useT } from '../../i18n/useT';
import { sourceUrls } from '../../lib/sourceUrls';
import { licenceName } from './licences';

/**
 * Where the L3 "report an issue" action goes.
 *
 * The repo has no issue tracker configured, and `POST /reports` is phase 4, so
 * there is no honest destination to hardcode. The link is therefore rendered
 * only when a deployment configures `VITE_REPORT_ISSUE_URL` (documented in
 * `apps/web/.env.example`); otherwise the sheet says reporting is not wired yet
 * instead of shipping a dead or invented URL.
 */
export function reportIssueUrl(): string | undefined {
  const configured: unknown = import.meta.env.VITE_REPORT_ISSUE_URL;
  if (typeof configured !== 'string') {
    return undefined;
  }
  const trimmed = configured.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Buttons/links inside the sheet that participate in the Tab trap. */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface LicenceSheetProps {
  dataset: DataSource;
  onClose: () => void;
}

/**
 * L3 dataset detail (spec §11): full licence name + link, the source URL, the
 * row's attribution, and the report-an-issue action.
 *
 * Strings are API fields (R45); the licence display name is the documented SPDX
 * mapping in `licences.ts`.
 *
 * Task 9 (M4) closes the Task 7 a11y gap: the modal traps Tab/Shift+Tab inside
 * the sheet, moves focus to the close button on open and returns it to the card
 * that opened the sheet on close, closes on Escape or a backdrop tap, and locks
 * body scroll while it is open. `MapCredit`'s lighter popover gained the Escape
 * + focus-return half of the same contract.
 *
 * Task 9 (M7): every URL a registry row publishes is rendered (rail rows list
 * two), via the shared `sourceUrls()` helper.
 */
export function LicenceSheet({ dataset, onClose }: LicenceSheetProps) {
  const { t } = useT();
  const titleId = useId();
  const sheetRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const triggerRef = useRef<Element | null>(null);
  const reportUrl = reportIssueUrl();
  const urls = sourceUrls(dataset.url);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Focus the close control, lock background scrolling, and remember the
  // trigger so focus can return there when the sheet unmounts.
  useEffect(() => {
    triggerRef.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      const trigger = triggerRef.current;
      if (trigger instanceof HTMLElement && trigger.isConnected) {
        trigger.focus();
      }
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusables = sheetRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusables === undefined || focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div
      data-testid="licence-backdrop"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-0 pt-12"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onCloseRef.current();
        }
      }}
    >
      <section
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="licence-sheet"
        className="flex max-h-[85dvh] w-full max-w-2xl flex-col gap-4 overflow-y-auto rounded-t-sheet bg-surface-container-lowest px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 text-on-surface shadow-elevation-3"
      >
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-on-surface-variant">
              {t('about.sheetKicker')}
            </p>
            <h2 id={titleId} className="break-words text-lg font-semibold tracking-tight">
              {dataset.name}
            </h2>
            <p className="break-words text-sm text-on-surface-variant">{dataset.publisher}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="flex size-12 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition hover:bg-surface-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </header>

        <section aria-labelledby={`${titleId}-licence`} className="flex flex-col gap-1">
          <h3
            id={`${titleId}-licence`}
            className="text-sm font-semibold uppercase tracking-wide text-on-surface-variant"
          >
            {t('about.licenceHeading')}
          </h3>
          <a
            href={dataset.licence_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-12 items-center break-words text-base font-medium text-primary underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            {licenceName(dataset.licence_spdx)}
          </a>
          <p className="text-sm text-on-surface-variant">
            {t('about.spdx', { id: dataset.licence_spdx })}
          </p>
        </section>

        <section aria-labelledby={`${titleId}-source`} className="flex flex-col gap-1">
          <h3
            id={`${titleId}-source`}
            className="text-sm font-semibold uppercase tracking-wide text-on-surface-variant"
          >
            {t('about.sourceHeading')}
          </h3>
          {urls.length > 0 ? (
            urls.map((url, index) => (
              <a
                key={`${url}-${index}`}
                href={url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-12 items-center break-all text-sm text-primary underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              >
                {url}
              </a>
            ))
          ) : (
            <p className="break-words text-sm text-on-surface-variant">{dataset.url}</p>
          )}
          <p className="break-words text-xs leading-4 text-on-surface-variant">
            {t('about.sourceMeta', { coverage: dataset.coverage, date: dataset.last_checked })}
          </p>
        </section>

        <section aria-labelledby={`${titleId}-attribution`} className="flex flex-col gap-1">
          <h3
            id={`${titleId}-attribution`}
            className="text-sm font-semibold uppercase tracking-wide text-on-surface-variant"
          >
            {t('about.attributionHeading')}
          </h3>
          <p className="break-words text-sm leading-5">{dataset.attribution}</p>
        </section>

        <section aria-labelledby={`${titleId}-report`} className="flex flex-col gap-1">
          <h3
            id={`${titleId}-report`}
            className="text-sm font-semibold uppercase tracking-wide text-on-surface-variant"
          >
            {t('about.reportHeading')}
          </h3>
          {reportUrl !== undefined ? (
            <a
              href={reportUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-12 items-center text-sm font-medium text-primary underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              {t('about.reportLink')}
            </a>
          ) : (
            <p className="text-sm text-on-surface-variant">{t('about.reportUnconfigured')}</p>
          )}
        </section>
      </section>
    </div>
  );
}
