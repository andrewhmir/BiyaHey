import type { DataSource } from '@biyahey/shared';
import { defaultT, type Translate } from '../../i18n/strings';
import { useT } from '../../i18n/useT';
import { licenceName } from './licences';

/**
 * The registry rows publish no `confidence` field today (the shape is fixed in
 * Plan 1's `DataSource`). Spec §11 lists confidence among the L2 fields, so the
 * card reports the absence instead of inventing a value; a future additive
 * `confidence` field on the registry row is rendered as soon as the API sends
 * it. See the Task 7 report's proposed ruling (R68).
 */
export function datasetConfidence(dataset: DataSource, t: Translate = defaultT): string {
  const confidence = (dataset as DataSource & { confidence?: unknown }).confidence;
  if (typeof confidence === 'string' && confidence.trim().length > 0) {
    return confidence.trim();
  }
  return t('about.confidenceUnpublished');
}

export interface DatasetCardProps {
  dataset: DataSource;
  /** Opens the L3 licence sheet for this row. */
  onOpen: (dataset: DataSource) => void;
}

/**
 * One L2 dataset card (spec §11: name, publisher, SPDX licence, last updated,
 * coverage, confidence), plus the row's own attribution as a micro-credit.
 *
 * Every value is a field of the `DataSource` the API returned (R43/R45); the
 * only mappings are presentation ones (SPDX id → human licence name, documented
 * in `licences.ts`). The whole card is the affordance that opens the L3 sheet.
 * The L2 field labels are Taglish strings from the module (Task 9 M12).
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
      className="flex w-full flex-col gap-2 rounded-card border border-outline-variant bg-surface-container-lowest p-4 text-left transition hover:bg-surface-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
    >
      <span className="flex flex-col gap-1">
        <span className="text-base font-semibold leading-6 text-on-surface">{dataset.name}</span>
        {/* The row's published attribution, rendered verbatim from the API. */}
        <span className="text-xs leading-4 text-on-surface-variant">{dataset.attribution}</span>
      </span>

      <span className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm leading-5">
        <span className="text-on-surface-variant">{t('about.publisher')}</span>
        <span className="min-w-0 break-words text-on-surface">{dataset.publisher}</span>

        <span className="text-on-surface-variant">{t('about.licence')}</span>
        <span className="min-w-0 break-words text-on-surface">
          <span data-testid="dataset-licence">{licence}</span>
          <span className="text-on-surface-variant"> · {dataset.licence_spdx}</span>
        </span>

        <span className="text-on-surface-variant">{t('about.lastChecked')}</span>
        <span data-testid="dataset-last-checked" className="text-on-surface">
          {dataset.last_checked}
        </span>

        <span className="text-on-surface-variant">{t('about.coverage')}</span>
        <span className="min-w-0 break-words text-on-surface">{dataset.coverage}</span>

        <span className="text-on-surface-variant">{t('about.confidence')}</span>
        <span data-testid="dataset-confidence" className="min-w-0 break-words text-on-surface">
          {confidence}
        </span>
      </span>

      <span className="flex items-center gap-1 text-xs font-medium text-primary">
        <span>{t('about.openDetail')}</span>
        <span aria-hidden="true">ⓘ</span>
      </span>
    </button>
  );
}
