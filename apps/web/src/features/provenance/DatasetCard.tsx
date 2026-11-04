import { ChevronRight } from 'lucide-react';
import { defaultT, type Translate } from '../../i18n/strings';
import { useT } from '../../i18n/useT';
import type { ProvenanceRow } from '../../lib/api';
import { licenceName } from './licences';

/**
 * The registry rows publish no `confidence` field today (the shape is fixed in
 * Plan 1's `DataSource`). Spec §11 lists confidence among the L2 fields, so the
 * card reports the absence instead of inventing a value; a future additive
 * `confidence` field on the registry row is rendered as soon as the API sends
 * it. See the Task 7 report's proposed ruling (R68).
 */
export function datasetConfidence(
  dataset: ProvenanceRow,
  t: Translate = defaultT,
): string {
  const confidence = (dataset as ProvenanceRow & { confidence?: unknown }).confidence;
  if (typeof confidence === 'string' && confidence.trim().length > 0) {
    return confidence.trim();
  }
  return t('about.confidenceUnpublished');
}

export interface DatasetCardProps {
  dataset: ProvenanceRow;
  /** Opens the L3 licence sheet for this row. */
  onOpen: (dataset: ProvenanceRow) => void;
}

/**
 * One L2 dataset card (spec §11: name, publisher, SPDX licence, last updated,
 * coverage, confidence), plus the row's own attribution as a micro-credit.
 *
 * Every value is a field of the `DataSource` the API returned (R43/R45); the
 * only mappings are presentation ones (SPDX id → human licence name, documented
 * in `licences.ts`). The whole card is the affordance that opens the L3 sheet.
 *
 * UX v2 restyle: the card reads as a Kalsada provenance record — name and
 * publisher head it, the licence and last-checked date sit in quiet chips, and
 * coverage/confidence keep their labelled grid. No row is dropped or invented.
 */
export function DatasetCard({ dataset, onOpen }: DatasetCardProps) {
  const { t } = useT();
  const licence = licenceName(dataset.licence_spdx);
  const confidence = datasetConfidence(dataset, t);

  return (
    <button
      type="button"
      data-testid="dataset-card"
      aria-haspopup="dialog"
      onClick={() => onOpen(dataset)}
      className="flex w-full flex-col gap-3 rounded-card border border-outline-variant bg-surface-container-lowest p-4 text-left shadow-elevation-1 transition hover:border-primary/50 hover:shadow-elevation-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring active:shadow-none"
    >
      <span className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="break-words text-base font-semibold leading-6 text-on-surface">
            {dataset.name}
          </span>
          <span className="break-words text-sm leading-5 text-on-surface-variant">
            {dataset.publisher}
          </span>
        </span>
        <ChevronRight aria-hidden="true" className="mt-1 size-5 shrink-0 text-on-surface-variant" />
      </span>

      {/* Licence + freshness: the two facts a rider checks before trusting a
          row. Both come from the API row; the display name is the documented
          SPDX → name mapping in `licences.ts`. */}
      <span className="flex flex-wrap items-center gap-1.5">
        <span
          data-testid="dataset-licence"
          className="rounded-pill border border-outline-variant bg-primary-container px-2.5 py-1 text-[11px] font-semibold leading-4 text-on-primary-container"
        >
          {licence} · {dataset.licence_spdx}
        </span>
        <span
          data-testid="dataset-last-checked"
          className="rounded-pill bg-surface-container px-2.5 py-1 text-[11px] font-medium leading-4 text-on-surface-variant"
        >
          {t('about.lastChecked')}: {dataset.last_checked}
        </span>
      </span>

      <span className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-outline-variant pt-3 text-sm leading-5">
        <span className="text-on-surface-variant">{t('about.coverage')}</span>
        <span className="min-w-0 break-words text-on-surface">{dataset.coverage}</span>

        <span className="text-on-surface-variant">{t('about.confidence')}</span>
        <span data-testid="dataset-confidence" className="min-w-0 break-words text-on-surface">
          {confidence}
        </span>
      </span>

      {/* The row's published attribution, rendered verbatim from the API. */}
      <span className="break-words text-xs leading-4 text-on-surface-variant">
        {dataset.attribution}
      </span>

      <span className="flex items-center gap-1 text-xs font-semibold text-primary">
        <span>{t('about.openDetail')}</span>
        <span aria-hidden="true">ⓘ</span>
      </span>
    </button>
  );
}
