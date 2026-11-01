import type { CSSProperties, ReactNode } from 'react';

export interface MapSlotProps {
  /**
   * Space map controls should keep clear at the bottom (the sheet height), in
   * CSS pixels. Exposed as `--map-padding-bottom` and a data attribute instead
   * of CSS padding so the MapLibre canvas stays full-bleed; Task 3 feeds it to
   * `map.padding` rather than shrinking the canvas box.
   */
  mapPadding?: number;
  children?: ReactNode;
}

/**
 * Full-bleed placeholder for the map canvas (Task 3 replaces the `children` with
 * `MapCanvas`). Map padding is published as one source of truth for the future
 * canvas and its controls.
 */
export function MapSlot({ mapPadding = 0, children }: MapSlotProps) {
  const style = {
    '--map-padding-bottom': `${mapPadding}px`,
  } as CSSProperties;

  return (
    <div
      data-testid="map-slot"
      data-map-padding-bottom={mapPadding}
      className="size-full bg-surface-container-low"
      style={style}
    >
      {children ?? (
        <div aria-hidden="true" className="flex size-full items-center justify-center">
          <span className="rounded-pill bg-surface-container px-4 py-2 text-sm font-medium text-on-surface-variant shadow-elevation-1">
            Map
          </span>
        </div>
      )}
    </div>
  );
}
