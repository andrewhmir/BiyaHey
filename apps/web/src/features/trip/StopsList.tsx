import type { LegStopDto } from '@biyahey/shared';
import { useState } from 'react';
import { formatClockTime } from '../../lib/time';

/**
 * Expandable served-stop list for one ride leg (spec §11 screen 4, R61).
 *
 * The API's `LegDto.stops` is already board-first / intermediates / alight-last.
 * The board stop is the leg row's origin, so the expander's `show N stops`
 * label counts the remaining stops (intermediates + alight) while the list
 * itself renders every row. The alight row is pinned last with
 * `data-alight="true"`; that is the row the rider watches for.
 *
 * Long lines are virtualised above {@link STOPS_VIRTUALIZE_ABOVE} rows so a
 * 100-stop provincial route does not mount 100 DOM rows at once. The alight
 * row stays rendered (pinned) outside the scroll window.
 */
export const STOPS_VIRTUALIZE_ABOVE = 30;
const ROW_HEIGHT_PX = 48;
const VISIBLE_ROWS = 8;
const OVERSCAN_ROWS = 2;

function stopTime(stop: LegStopDto, alight: boolean): string | null {
  return formatClockTime(
    alight ? (stop.arrivalTime ?? stop.departureTime) : (stop.departureTime ?? stop.arrivalTime),
  );
}

function StopRow({ stop, index, last }: { stop: LegStopDto; index: number; last: boolean }) {
  const board = index === 0;
  const time = stopTime(stop, last);
  return (
    <li
      data-testid="stop-row"
      data-alight={last ? 'true' : undefined}
      data-board={board ? 'true' : undefined}
      className={`flex items-start gap-3 py-2 ${
        last ? 'rounded-card border border-primary bg-surface-container-lowest px-3' : ''
      }`}
    >
      <span
        aria-hidden="true"
        className={`mt-1.5 size-2.5 shrink-0 rounded-full ${
          last ? 'bg-primary' : board ? 'bg-on-surface' : 'bg-outline'
        }`}
      />
      <span className="min-w-0 flex-1">
        <span className="block break-words text-base leading-6 text-on-surface">{stop.name}</span>
        <span className="block text-xs leading-4 text-on-surface-variant">
          {board ? 'Sakayan' : last ? 'Baba' : 'Daanan'}
          {time === null ? '' : ` · ${time}`}
        </span>
      </span>
    </li>
  );
}

export function StopsList({ stops }: { stops: readonly LegStopDto[] }) {
  const [scrollTop, setScrollTop] = useState(0);

  if (stops.length === 0) {
    return null;
  }

  if (stops.length <= STOPS_VIRTUALIZE_ABOVE) {
    return (
      <ol aria-label="Mga hintuan" className="flex flex-col">
        {stops.map((stop, index) => (
          <StopRow
            key={`${stop.stopId ?? stop.name}-${index}`}
            stop={stop}
            index={index}
            last={index === stops.length - 1}
          />
        ))}
      </ol>
    );
  }

  // The alight stop stays rendered (and last) outside the scroll window; the
  // board and intermediates scroll so only a small slice is mounted.
  const scrollable = stops.slice(0, -1);
  const alight = stops[stops.length - 1];
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT_PX) - OVERSCAN_ROWS);
  const end = Math.min(scrollable.length, start + VISIBLE_ROWS + OVERSCAN_ROWS * 2);

  return (
    <div className="flex flex-col">
      <div
        data-testid="stops-scroll"
        className="max-h-96 overflow-y-auto"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <ol aria-label="Mga hintuan" className="flex flex-col">
          <li aria-hidden="true" style={{ height: start * ROW_HEIGHT_PX }} />
          {scrollable.slice(start, end).map((stop, offset) => {
            const index = start + offset;
            return (
              <StopRow
                key={`${stop.stopId ?? stop.name}-${index}`}
                stop={stop}
                index={index}
                last={false}
              />
            );
          })}
          <li
            aria-hidden="true"
            style={{ height: Math.max(0, scrollable.length - end) * ROW_HEIGHT_PX }}
          />
        </ol>
      </div>
      <ol aria-label="Baba" className="flex flex-col">
        <StopRow stop={alight} index={stops.length - 1} last />
      </ol>
    </div>
  );
}
