import type { DataSource } from '@biyahey/shared';
import { joinAttributions } from '@biyahey/shared';
import { AboutDataLink } from '../navigation/AboutDataLink';

/** Copy shown when an itinerary references a dataset the response did not carry. */
export const MISSING_SOURCE_LABEL = 'source unavailable';

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
 */
export function provenanceLabel(
  sourcesFromItinerary: readonly string[],
  knownSources: readonly DataSource[],
): string {
  const requested = sourcesFromItinerary.slice(0, 2);
  const resolved = requested
    .map((sourceId) => knownSources.find((source) => source.id === sourceId))
    .filter((source): source is DataSource => source !== undefined);

  const attribution = joinAttributions(resolved);
  const missing = requested.length > resolved.length;
  const prefix = attribution.length > 0 ? attribution : missing ? MISSING_SOURCE_LABEL : '';
  const missingNote = attribution.length > 0 && missing ? ` · ${MISSING_SOURCE_LABEL}` : '';
  return `${prefix}${missingNote}${prefix.length > 0 ? ' · ' : ''}Data sources`;
}

/**
 * Shared L1 provenance chip (route-card footer, Task 5 + Task 7).
 *
 * The chip is itself the ⓘ entry point to `/sources`, reachable in one tap. It
 * is a link built by `AboutDataLink`, never a nested button: a route card's
 * select action stays a button, and the chip renders beside it in the card
 * footer so neither control wraps the other.
 */
export function ProvenanceChip({
  sourcesFromItinerary,
  knownSources,
  className,
}: ProvenanceChipProps) {
  const label = provenanceLabel(sourcesFromItinerary, knownSources);

  return (
    <span
      data-testid="provenance-chip"
      className={className ?? 'text-[11px] leading-4 text-on-surface-variant'}
    >
      <AboutDataLink className="text-inherit">
        {label}
        <span aria-hidden="true"> ⓘ</span>
      </AboutDataLink>
    </span>
  );
}
