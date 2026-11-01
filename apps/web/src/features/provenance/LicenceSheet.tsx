import type { DataSource } from '@biyahey/shared';
import { useEffect, useId, useRef } from 'react';
import { licenceName } from './licences';

/** The first http(s) URL in a registry `url` field (rail rows list two). */
export function firstSourceUrl(value: string): string | undefined {
  return value
    .split(/\s*·\s*/)
    .map((part) => part.trim())
    .find((part) => /^https?:\/\//.test(part));
}

/**
 * Where the L3 "report an issue" action goes.
 *
 * The repo has no issue tracker configured, and `POST /reports` is phase 4, so
 * there is no honest destination to hardcode. The link is therefore rendered
 * only when a deployment configures `VITE_REPORT_ISSUE_URL`; otherwise the sheet
 * says reporting is not wired yet instead of shipping a dead or invented URL.
 * Recorded as a proposed ruling in the Task 7 report.
 */
export function reportIssueUrl(): string | undefined {
  const configured: unknown = import.meta.env.VITE_REPORT_ISSUE_URL;
  if (typeof configured !== 'string') {
    return undefined;
  }
  const trimmed = configured.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export interface LicenceSheetProps {
  dataset: DataSource;
  onClose: () => void;
}

/**
 * L3 dataset detail (spec §11): full licence name + link, the source URL, the
 * row's attribution, and the report-an-issue action.
 *
 * Strings are API fields (R45); the licence display name is the documented SPDX
 * mapping in `licences.ts`. The sheet is modal and dismissible with Escape or
 * its close button; focus moves to the close button on open.
 */
export function LicenceSheet({ dataset, onClose }: LicenceSheetProps) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const reportUrl = reportIssueUrl();
  const sourceUrl = firstSourceUrl(dataset.url);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-0 pt-12">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="licence-sheet"
        className="flex max-h-[85dvh] w-full max-w-2xl flex-col gap-4 overflow-y-auto rounded-t-sheet bg-surface-container-lowest px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 text-on-surface shadow-elevation-3"
      >
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-on-surface-variant">
              Lisensya at pinagmulan
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
            aria-label="Isara"
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
            Lisensya
          </h3>
          <a
            href={dataset.licence_url}
            target="_blank"
            rel="noreferrer"
            className="break-words text-base font-medium text-primary underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            {licenceName(dataset.licence_spdx)}
          </a>
          <p className="text-sm text-on-surface-variant">SPDX: {dataset.licence_spdx}</p>
        </section>

        <section aria-labelledby={`${titleId}-source`} className="flex flex-col gap-1">
          <h3
            id={`${titleId}-source`}
            className="text-sm font-semibold uppercase tracking-wide text-on-surface-variant"
          >
            Source
          </h3>
          {sourceUrl !== undefined ? (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="break-all text-sm text-primary underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              {sourceUrl}
            </a>
          ) : (
            <p className="break-words text-sm text-on-surface-variant">{dataset.url}</p>
          )}
          <p className="break-words text-xs leading-4 text-on-surface-variant">
            {dataset.coverage} · huling tsek {dataset.last_checked}
          </p>
        </section>

        <section aria-labelledby={`${titleId}-attribution`} className="flex flex-col gap-1">
          <h3
            id={`${titleId}-attribution`}
            className="text-sm font-semibold uppercase tracking-wide text-on-surface-variant"
          >
            Attribution
          </h3>
          <p className="break-words text-sm leading-5">{dataset.attribution}</p>
        </section>

        <section aria-labelledby={`${titleId}-report`} className="flex flex-col gap-1">
          <h3
            id={`${titleId}-report`}
            className="text-sm font-semibold uppercase tracking-wide text-on-surface-variant"
          >
            I-report ang isyu
          </h3>
          {reportUrl !== undefined ? (
            <a
              href={reportUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-medium text-primary underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              Mag-report ng isyu sa dataset na ito
            </a>
          ) : (
            <p className="text-sm text-on-surface-variant">
              Wala pang naka-configure na report link. Hindi pa live ang pag-report (phase 4) —
              huwag mag-imbento ng isyu.
            </p>
          )}
        </section>
      </section>
    </div>
  );
}
