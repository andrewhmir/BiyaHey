import type { DataSource, ItineraryDto } from '@biyahey/shared';
import { useSyncExternalStore } from 'react';
import type { TripDraft } from '../lib/trip';

export type MapMode = 'home' | 'options' | 'detail';

export interface MapEndpoint {
  lat: number;
  lon: number;
  label: string;
  kind: 'origin' | 'destination' | 'stop';
}

export type FitKind = 'all' | 'selected' | 'active-leg';

export interface MapState {
  mode: MapMode;
  itineraries: ItineraryDto[];
  selectedId: string | null;
  /** Emphasised leg in detail mode (live walkthrough / timeline focus). */
  activeLegIndex: number | null;
  endpoints: MapEndpoint[];
  sources: DataSource[];
  userLocation: { lat: number; lon: number } | null;
  /** Bumped whenever the camera must re-fit; the map handles each nonce once. */
  fit: { kind: FitKind; nonce: number };
  /** Space the screen chrome occupies over the map, in CSS pixels. */
  inset: { bottom: number; left: number };
  /** True while a plan request the map is drawing is in flight. */
  loading: boolean;
}

const INITIAL: MapState = {
  mode: 'home',
  itineraries: [],
  selectedId: null,
  activeLegIndex: null,
  endpoints: [],
  sources: [],
  userLocation: null,
  fit: { kind: 'all', nonce: 0 },
  inset: { bottom: 0, left: 0 },
  loading: false,
};

let state: MapState = INITIAL;
let fitNonce = 0;
const listeners = new Set<() => void>();

function set(patch: Partial<MapState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function refit(kind: FitKind): Partial<MapState> {
  fitNonce += 1;
  return { fit: { kind, nonce: fitNonce } };
}

export function endpointsFromDraft(draft: TripDraft): MapEndpoint[] {
  const endpoints: MapEndpoint[] = [];
  if (draft.from !== null) {
    endpoints.push({
      lat: draft.from.lat,
      lon: draft.from.lon,
      label: draft.fromName ?? '',
      kind: 'origin',
    });
  }
  for (const stop of draft.stops) {
    endpoints.push({ lat: stop.lat, lon: stop.lon, label: stop.name, kind: 'stop' });
  }
  if (draft.dest !== null) {
    endpoints.push({
      lat: draft.dest.lat,
      lon: draft.dest.lon,
      label: draft.destName ?? '',
      kind: 'destination',
    });
  }
  return endpoints;
}

export const mapActions = {
  /** Home: no route drawn, no pins. */
  reset(): void {
    set({ ...INITIAL, inset: state.inset, fit: state.fit });
  },

  /** Route options: every alternative drawn, the first one selected. */
  showOptions(options: {
    itineraries: ItineraryDto[];
    endpoints: MapEndpoint[];
    sources: DataSource[];
  }): void {
    set({
      ...refit('selected'),
      mode: 'options',
      itineraries: options.itineraries,
      selectedId: options.itineraries[0]?.id ?? null,
      activeLegIndex: null,
      endpoints: options.endpoints,
      sources: options.sources,
    });
  },

  selectItinerary(id: string): void {
    if (state.mode === 'options') {
      set({ selectedId: id, ...refit('selected') });
    }
  },

  /** One trip: whole route drawn, optionally one leg emphasised. */
  showDetail(options: {
    itinerary: ItineraryDto;
    sources: DataSource[];
    endpoints: MapEndpoint[];
    activeLegIndex?: number | null;
  }): void {
    const activeLegIndex = options.activeLegIndex ?? null;
    set({
      ...refit(activeLegIndex === null ? 'selected' : 'active-leg'),
      mode: 'detail',
      itineraries: [options.itinerary],
      selectedId: options.itinerary.id,
      activeLegIndex,
      endpoints: options.endpoints,
      sources: options.sources,
    });
  },

  focusLeg(index: number | null): void {
    if (state.mode !== 'detail') return;
    set({ activeLegIndex: index, ...refit(index === null ? 'selected' : 'active-leg') });
  },

  setUserLocation(location: { lat: number; lon: number } | null): void {
    set({ userLocation: location });
  },

  setSources(sources: DataSource[]): void {
    set({ sources });
  },

  setLoading(loading: boolean): void {
    set({ loading });
  },

  setInset(inset: Partial<MapState['inset']>): void {
    const next = { ...state.inset, ...inset };
    if (next.bottom === state.inset.bottom && next.left === state.inset.left) return;
    set({ inset: next });
  },
} as const;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useMapState(): MapState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

export function getMapState(): MapState {
  return state;
}

/** True while the map has been asked for a plan it has not received yet. */
export function useMapLoading(): boolean {
  return useMapState().loading;
}
