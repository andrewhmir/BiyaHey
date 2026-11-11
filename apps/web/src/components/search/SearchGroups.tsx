import type { SearchGroup, SearchResultDto } from '@biyahey/shared';
import { Landmark, MapPin } from 'lucide-react';
import { useId } from 'react';
import { useCopy } from '../../i18n';
import { distanceLabel } from '../../lib/format';

/** Fixed display order: stops, landmarks, routes, saved. */
const GROUP_ORDER: ReadonlyArray<keyof SearchGroup> = ['stops', 'landmarks', 'routes', 'saved'];

interface ResultRowProps {
  result: SearchResultDto;
  onSelect: (result: SearchResultDto) => void;
}

function ResultRow({ result, onSelect }: ResultRowProps) {
  const Icon = result.type === 'stop' ? MapPin : Landmark;
  const subtitle = result.locality ?? (result.label !== result.name ? result.label : '');
  const distance =
    typeof result.distanceM === 'number' ? `≈ ${distanceLabel(result.distanceM)}` : '';

  return (
    <button
      type="button"
      aria-label={distance.length > 0 ? `${result.label} ${distance}` : result.label}
      onClick={() => onSelect(result)}
      className="flex min-h-12 w-full items-center gap-3 rounded-md px-2 py-2 text-left transition hover:bg-canvas"
    >
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-canvas text-ink-soft"
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-ink">{result.name}</span>
        {subtitle.length > 0 ? (
          <span className="block truncate text-xs text-ink-faint">{subtitle}</span>
        ) : null}
      </span>
      {distance.length > 0 ? (
        <span className="shrink-0 text-xs tabular-nums text-ink-faint">{distance}</span>
      ) : null}
    </button>
  );
}

/** Grouped, keyboard-reachable typeahead results. Empty groups render nothing. */
export function SearchGroups({
  groups,
  onSelect,
}: {
  groups: SearchGroup;
  onSelect: (result: SearchResultDto) => void;
}) {
  const { t } = useCopy();
  const baseId = useId();

  return (
    <div className="mt-1 flex flex-col gap-4">
      {GROUP_ORDER.map((key) => {
        const results = groups[key];
        if (results.length === 0) return null;
        const headingId = `${baseId}-${key}`;
        return (
          <section key={key} aria-labelledby={headingId}>
            <h2
              id={headingId}
              className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint"
            >
              {t(`group.${key}`)}
            </h2>
            <ul className="flex list-none flex-col">
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
