import { createContext, useContext, type CSSProperties, type ReactNode } from 'react';

/**
 * Sheet-height padding for anything rendered inside the map slot.
 *
 * `MapCanvas` consumes this to call `map.setPadding({ bottom })`; keeping it in
 * React context as well as the CSS variable means controls do not have to parse
 * the DOM.
 */
const MapPaddingContext = createContext(0);

/** Space map controls must keep clear at the bottom, in CSS pixels. */
export function useMapPadding(): number {
  return useContext(MapPaddingContext);
}

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
 * Full-bleed slot for the map canvas. Map padding is published as one source of
 * truth for the canvas and its controls: React context for `MapCanvas`, plus
 * `--map-padding-bottom` / the data attribute for CSS-positioned controls.
 */
export function MapSlot({ mapPadding = 0, children }: MapSlotProps) {
  const style = {
    '--map-padding-bottom': `${mapPadding}px`,
  } as CSSProperties;

  return (
    <MapPaddingContext.Provider value={mapPadding}>
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
    </MapPaddingContext.Provider>
  );
}
