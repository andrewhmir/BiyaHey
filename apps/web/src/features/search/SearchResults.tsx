import type { SearchGroup, SearchResultDto } from '@biyahey/shared';
import { Landmark, MapPin } from 'lucide-react';

/** Display order fixed by the Task 4 contract: Stops · Landmarks · Routes · Saved. */
export const SEARCH_GROUP_ORDER = ['stops', 'landmarks', 'routes', 'saved'] as const;

const GROUP_TITLES: Record<keyof SearchGroup, string> = {
  stops: 'Stops',
  landmarks: 'Landmarks',
  routes: 'Routes',
  saved: 'Saved',
};

/**
 * Format the API's `distanceM` for a result row.
 *
 * The API is the only source of this number (R45: no recomputation), so the
 * formatter only chooses units: metres below 1 km, one decimal of kilometres
 * above it.
 */
export function formatDistance(distanceM: number): string {
  if (!Number.isFinite(distanceM) || distanceM < 0) {
    return '';
  }
  if (distanceM < 1000) {
    return `≈ ${Math.round(distanceM)} m`;
  }
  return `≈ ${(distanceM / 1000).toFixed(1)} km`;
}

export interface SearchResultsProps {
  groups: SearchGroup;
  onSelect: (result: SearchResultDto) => void;
}

/** Grouped, keyboard-reachable result lists. Empty groups render no heading. */
export function SearchResults({ groups, onSelect }: SearchResultsProps) {
  return (
    <div className="flex flex-col gap-6" data-testid="search-results">
      {SEARCH_GROUP_ORDER.map((key) => {
        const results = groups[key];
        if (results.length === 0) {
          return null;
        }
        const headingId = `search-group-${key}`;
        return (
          <section key={key} aria-labelledby={headingId} data-testid={`search-group-${key}`}>
            <h2
              id={headingId}
              className="px-1 pb-2 text-sm font-semibold uppercase tracking-wide text-on-surface-variant"
            >
              {GROUP_TITLES[key]}
            </h2>
            <ul className="flex flex-col gap-2">
              {results.map((result) => (
                <li key={result.id}>
                  <ResultRow result={result} onSelect={onSelect} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function ResultRow({
  result,
  onSelect,
}: {
  result: SearchResultDto;
  onSelect: (result: SearchResultDto) => void;
}) {
  const Icon = result.type === 'stop' ? MapPin : Landmark;
  // The API's `locality` is the PSGC city/municipality; fall back to the label
  // only when it adds information the name does not already show.
  const subtitle = result.locality ?? (result.label !== result.name ? result.label : '');
  const distance = typeof result.distanceM === 'number' ? formatDistance(result.distanceM) : '';

  return (
    <button
      type="button"
      onClick={() => onSelect(result)}
      className="flex min-h-12 w-full items-center gap-3 rounded-card bg-surface-container-lowest px-3 py-2 text-left shadow-elevation-1 transition hover:shadow-elevation-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring active:shadow-none"
    >
      <span
        aria-hidden="true"
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-container text-on-surface-variant"
      >
        <Icon className="size-5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-base font-medium text-on-surface">{result.name}</span>
        {subtitle.length > 0 && (
          <span className="truncate text-sm text-on-surface-variant">{subtitle}</span>
        )}
      </span>
      {distance.length > 0 && (
        <span className="shrink-0 text-sm tabular-nums text-on-surface-variant">{distance}</span>
      )}
    </button>
  );
}
