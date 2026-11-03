import type { DataSource } from '@biyahey/shared';
import { joinAttributions } from '@biyahey/shared';
import { defaultT, type Translate } from '../../i18n/strings';
import { useT } from '../../i18n/useT';
import { AboutDataLink } from '../navigation/AboutDataLink';

/** Copy shown when an itinerary references a dataset the response did not carry. */
export const MISSING_SOURCE_LABEL = defaultT('provenance.missingSource');

export interface ProvenanceChipProps {
  /**
   * The itinerary's `sources` ids, in the order the API returned them. The chip
   * deliberately takes ids (not rows) so the caller cannot invent an attribution
   * string; the rows come from the same response via `knownSources` (R43/R45).
   */
  sourcesFromItinerary: readonly string[];
  /** Provenance rows the response carried (`GET /plan`'s `sources[]`). */
  knownSources: readonly DataSource[];
  className?: string;
}

/**
 * The L1 provenance chip body: the attributions of the first two source ids the
 * itinerary actually used, then the "Data sources" affordance (Task 5's text,
 * unchanged by Task 7's extraction).
 *
 * An id with no matching row is never rendered as its raw value or as
 * `undefined`: a wholly missing set says "source unavailable", and a partly
 * missing set appends `· source unavailable` after the resolved attributions.
 *
 * The attribution fragments themselves are API data (R45) and are rendered
 * verbatim in whatever language the registry publishes; only the joining words
 * come from the string module.
 */
export function provenanceLabel(
  sourcesFromItinerary: readonly string[],
  knownSources: readonly DataSource[],
  t: Translate = defaultT,
): string {
  const requested = sourcesFromItinerary.slice(0, 2);
  const resolved = requested
    .map((sourceId) => knownSources.find((source) => source.id === sourceId))
    .filter((source): source is DataSource => source !== undefined);

  const attribution = joinAttributions(resolved);
  const missing = requested.length > resolved.length;
  const prefix =
    attribution.length > 0 ? attribution : missing ? t('provenance.missingSource') : '';
  const missingNote =
    attribution.length > 0 && missing ? ` · ${t('provenance.missingSource')}` : '';
  return `${prefix}${missingNote}${prefix.length > 0 ? ' · ' : ''}${t('provenance.dataSources')}`;
}

/**
 * Shared L1 provenance chip (route-card footer, Task 5 + Task 7).
 *
 * The chip is itself the ⓘ entry point to `/sources`, reachable in one tap. It
 * is a link built by `AboutDataLink`, never a nested button: a route card's
 * select action stays a button, and the chip renders beside it in the card
 * footer so neither control wraps the other. `AboutDataLink` supplies the 48 dp
 * target introduced by Task 9 (M1).
 */
export function ProvenanceChip({
  sourcesFromItinerary,
  knownSources,
  className,
}: ProvenanceChipProps) {
  const { t } = useT();
  const label = provenanceLabel(sourcesFromItinerary, knownSources, t);

  return (
    <span
      data-testid="provenance-chip"
      className={
        className ??
        'inline-flex max-w-full items-center rounded-pill bg-surface-container-low px-2 py-0.5 text-[11px] leading-4 text-on-surface-variant'
      }
    >
      <AboutDataLink className="text-inherit">
        {label}
        <span aria-hidden="true"> ⓘ</span>
      </AboutDataLink>
    </span>
  );
}
