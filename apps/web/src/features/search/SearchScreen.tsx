import type { SearchGroup, SearchResultDto } from '@biyahey/shared';
import { ArrowLeft, ArrowUpDown, LocateFixed, Plus, Search as SearchIcon, X } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Translate } from '../../i18n/strings';
import { useT } from '../../i18n/useT';
import { SearchResults } from './SearchResults';
import { MAX_TRIP_STOPS, buildPlanPath, parseTripParams, type TripPoint } from './tripParams';
import { useSearch, type SearchOutcome } from './useSearch';

/**
 * `/search` — the trip planner (R89, approved Option A directions form).
 *
 * The screen is a Google-Maps-style form: an explicit `From`, up to two optional
 * stops, an explicit `To`, a swap button and a "Maghanap ng ruta" CTA. The
 * typeahead below the form fills whichever field is active; a stop field filters
 * the results to the Stops group because the router's `via` accepts stop ids
 * only. Everything the previous search screen promised is still here: the 250 ms
 * debounced/cancellable search with its cache, the polite result-count region,
 * the partial-results note, offline saved places under the exact mandated copy,
 * and idle recents/saved places.
 *
 * The trip travels in the URL (`tripParams.ts`) so `/plan` can plan it and a
 * back/edit link can prefill this same form.
 */

/** One bounded geolocation read: the browser must answer inside this window. */
export const GEOLOCATION_TIMEOUT_MS = 8_000;

interface PickedPlace extends TripPoint {
  name: string;
}

interface PickedStop extends PickedPlace {
  stopId: string;
}

type Field = { kind: 'from' } | { kind: 'to' } | { kind: 'stop'; index: number };

type LocateFailure = 'denied' | 'unavailable' | 'timeout' | 'unsupported';

type LocateState =
  { status: 'idle' } | { status: 'locating' } | { status: 'failed'; reason: LocateFailure };

const LOCATE_FAILURE_KEYS: Record<LocateFailure, string> = {
  denied: 'search.locateDenied',
  unavailable: 'search.locateUnavailable',
  timeout: 'search.locateTimeout',
  unsupported: 'search.locateUnsupported',
};

interface TripForm {
  from: PickedPlace | null;
  dest: PickedPlace | null;
  stops: Array<PickedStop | null>;
}

type TripSearchParams = { get(name: string): string | null; has(name: string): boolean };

function toPickedPlace(point: TripPoint | null, name: string | null): PickedPlace | null {
  return point === null ? null : { lat: point.lat, lon: point.lon, name: name ?? '' };
}

/** Initial form state from the URL: `/search?from=…&dest=…&via=…` prefills it. */
function initialTripForm(params: TripSearchParams): TripForm {
  const parsed = parseTripParams(params);
  return {
    from: toPickedPlace(parsed.from, parsed.fromName),
    dest: toPickedPlace(parsed.dest, parsed.destName),
    stops: parsed.stops.map((stop) => ({ ...stop })),
  };
}

/** The next missing endpoint (From, then To); empty stop rows are not "next". */
function firstEmptyEndpoint(form: TripForm): Field | null {
  if (form.from === null) {
    return { kind: 'from' };
  }
  if (form.dest === null) {
    return { kind: 'to' };
  }
  return null;
}

/** Reading/tab order: From, To, then any added stop rows. */
function firstEmptyField(form: TripForm): Field | null {
  if (form.from === null) {
    return { kind: 'from' };
  }
  if (form.dest === null) {
    return { kind: 'to' };
  }
  const index = form.stops.findIndex((stop) => stop === null);
  return index === -1 ? null : { kind: 'stop', index };
}

function fieldKey(field: Field | null): string {
  if (field === null) {
    return 'none';
  }
  return field.kind === 'stop' ? `stop:${field.index}` : field.kind;
}

/** Stop slots are optional: an added-but-empty row never reaches the URL. */
function pickedStops(stops: Array<PickedStop | null>): PickedStop[] {
  return stops.filter((stop): stop is PickedStop => stop !== null);
}

/**
 * A stop picker only offers stops. The router's `via` needs a served stop id,
 * so a landmark would produce a route request the BFF must reject; hiding the
 * other groups (including saved landmarks) is the honest filter.
 */
function onlyStops(groups: SearchGroup): SearchGroup {
  const isStop = (result: SearchResultDto) => result.type === 'stop';
  return {
    stops: groups.stops.filter(isStop),
    landmarks: [],
    routes: [],
    saved: groups.saved.filter(isStop),
  };
}

function countGroups(groups: SearchGroup): number {
  return groups.stops.length + groups.landmarks.length + groups.routes.length + groups.saved.length;
}

function locateMessage(locate: LocateState, t: Translate): string {
  if (locate.status === 'locating') {
    return t('plan.locatingStatus');
  }
  if (locate.status === 'failed') {
    return t(LOCATE_FAILURE_KEYS[locate.reason]);
  }
  return '';
}

function statusMessage(
  search: SearchOutcome,
  t: Translate,
  stopMode: boolean,
  visibleCount: number,
): string {
  switch (search.status) {
    case 'loading':
      return t('search.loading');
    case 'success':
      if (visibleCount === 0) {
        // A partial answer never proves the place does not exist, so the
        // zero-result claim stays explicitly incomplete.
        if (stopMode) {
          return search.partial
            ? t('search.partialNoStops', { query: search.query })
            : t('search.noStops', { query: search.query });
        }
        return search.partial
          ? t('search.partialNoResults', { query: search.query })
          : t('search.noResults', { query: search.query });
      }
      return t('search.results', { count: visibleCount });
    case 'offline':
      return t('search.offline');
    case 'error':
      return t('search.error');
    case 'idle':
    default:
      return t('search.idle');
  }
}

interface PlaceFieldProps {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  inputRef: (element: HTMLInputElement | null) => void;
  onFocus: () => void;
  onChange: (value: string) => void;
  /** Removes the picked value; the caller reports it through `onChange('')`. */
  onClear?: () => void;
}

/**
 * One labelled picker input; the visible micro-label doubles as its `<label>`.
 *
 * A picked endpoint keeps a 48 dp clear affordance, so a rider can re-pick a
 * field without typing over the old value (Kalsada directions form).
 */
function PlaceField({
  id,
  label,
  placeholder,
  value,
  inputRef,
  onFocus,
  onChange,
  onClear,
}: PlaceFieldProps) {
  const { t } = useT();
  return (
    <div className="flex min-w-0 flex-1 flex-col px-1">
      <label
        htmlFor={id}
        className="text-[10px] font-bold uppercase tracking-[0.12em] text-on-surface-variant"
      >
        {label}
      </label>
      <div className="flex min-w-0 items-center">
        <input
          id={id}
          ref={inputRef}
          type="search"
          autoComplete="off"
          enterKeyHint="search"
          value={value}
          placeholder={placeholder}
          onFocus={onFocus}
          onChange={(event) => onChange(event.currentTarget.value)}
          className="min-h-12 min-w-0 flex-1 bg-transparent py-1 text-base font-medium text-on-surface placeholder:font-normal placeholder:text-on-surface-variant focus:outline-none"
        />
        {value.length > 0 && onClear !== undefined ? (
          <button
            type="button"
            onClick={onClear}
            aria-label={t('search.clear')}
            className="flex size-12 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition hover:bg-surface-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function SearchScreen() {
  const navigate = useNavigate();
  const { t } = useT();
  const [params] = useSearchParams();
  const fromId = useId();
  const toId = useId();
  const stopIdBase = useId();
  const statusId = useId();

  const [form, setForm] = useState<TripForm>(() => initialTripForm(params));
  const [active, setActive] = useState<Field | null>(() =>
    firstEmptyField(initialTripForm(params)),
  );
  const [term, setTerm] = useState('');
  const [locate, setLocate] = useState<LocateState>({ status: 'idle' });
  const [focusStop, setFocusStop] = useState<number | null>(null);
  // Focus is applied in an effect, after the commit that enables the target:
  // calling .focus() on a still-disabled CTA is a no-op and would drop focus to
  // <body> (R89 review).
  const [pendingFocus, setPendingFocus] = useState<Field | 'cta' | null>(null);

  const fromInputRef = useRef<HTMLInputElement | null>(null);
  const toInputRef = useRef<HTMLInputElement | null>(null);
  const stopInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  // Keyboard/reader continuity: a selection or removal that unmounts the
  // focused result must hand focus to a stable control (R89 review).
  const ctaRef = useRef<HTMLButtonElement | null>(null);
  const addStopRef = useRef<HTMLButtonElement | null>(null);

  const search = useSearch(term, {
    // One typeahead session per field: switching fields clears the previous
    // query before paint, so its results can never be picked as the new field's
    // value (trip-planner R89 bug found in the live E2E run).
    resetToken: active === null ? 'idle' : fieldKey(active),
  });
  const stopMode = active !== null && active.kind === 'stop';

  const inputFor = useCallback((field: Field): HTMLInputElement | null => {
    if (field.kind === 'from') {
      return fromInputRef.current;
    }
    if (field.kind === 'to') {
      return toInputRef.current;
    }
    return stopInputRefs.current[field.index] ?? null;
  }, []);

  // Autofocus the first empty field once, so the global `/` shortcut and plain
  // typing work immediately. `/search` is remounted on navigation, so the URL
  // state is only read here.
  useEffect(() => {
    // A prefilled edit state (the route-options "change starting point" hand-off)
    // has no empty field: focus the CTA rather than dropping focus to <body>, and
    // without focusing From (which would hide the prefilled start behind the
    // active-field query state).
    const field = firstEmptyField(initialTripForm(params));
    if (field !== null) {
      inputFor(field)?.focus();
      return;
    }
    ctaRef.current?.focus();
    // Mount-only: a later URL change is a new mount of this lazy route.
  }, []);

  // A newly added stop row mounts after the click; focus it once it exists.
  useEffect(() => {
    if (focusStop === null) {
      return;
    }
    stopInputRefs.current[focusStop]?.focus();
    setFocusStop(null);
  }, [focusStop]);

  /**
   * Move focus to the next missing endpoint, else the CTA. Used after every
   * action that unmounts the focused result button: a disabled CTA cannot take
   * focus, so the form would otherwise drop focus to <body> (R89 review).
   */
  const focusAfterPick = (next: TripForm) => {
    setPendingFocus(firstEmptyEndpoint(next) ?? 'cta');
  };

  // Apply the queued focus after React has committed the enabling render.
  useEffect(() => {
    if (pendingFocus === null) {
      return;
    }
    if (pendingFocus === 'cta') {
      ctaRef.current?.focus();
    } else {
      inputFor(pendingFocus)?.focus();
    }
    setPendingFocus(null);
  }, [pendingFocus, inputFor]);

  const handleFieldFocus = (field: Field) => {
    if (fieldKey(active) === fieldKey(field)) {
      return;
    }
    // The active field owns the typeahead query, so switching fields starts a
    // fresh query instead of reusing the previous field's term.
    setActive(field);
    setTerm('');
  };

  const handleFieldChange = (field: Field, value: string) => {
    setActive(field);
    setTerm(value);
    // Typing starts a new pick: the old selection for this field is no longer
    // what the field shows, so it must stop being what the CTA submits. Without
    // this the form could display "Guadalupe" while POSTing the previous start.
    setForm((current) => {
      if (field.kind === 'from') {
        return current.from === null ? current : { ...current, from: null };
      }
      if (field.kind === 'to') {
        return current.dest === null ? current : { ...current, dest: null };
      }
      if (current.stops[field.index] === null) {
        return current;
      }
      return {
        ...current,
        stops: current.stops.map((entry, index) => (index === field.index ? null : entry)),
      };
    });
  };

  const handleSelect = (result: SearchResultDto) => {
    // Idle saved places can be tapped with no field active; fall back to the
    // first empty field so a tap is never a dead end.
    const field = active ?? firstEmptyField(form) ?? ({ kind: 'to' } as const);
    const place: PickedPlace = { lat: result.lat, lon: result.lon, name: result.label };

    if (field.kind === 'from') {
      setForm((current) => ({ ...current, from: place }));
      setTerm('');
      // Move on to the destination only while it is still empty. If the rider
      // already chose one, focusing it would blank its displayed value for the
      // duration of the edit session (and invites an accidental overwrite).
      const nextField: Field | null = form.dest === null ? { kind: 'to' } : null;
      setActive(nextField);
      if (nextField !== null) {
        toInputRef.current?.focus();
      } else {
        focusAfterPick({ ...form, from: place });
      }
      return;
    }

    if (field.kind === 'to') {
      setForm((current) => ({ ...current, dest: place }));
      setTerm('');
      setActive(null);
      focusAfterPick({ ...form, dest: place });
      return;
    }

    // A stop must be a real stop: the request carries its served id.
    if (result.type !== 'stop') {
      return;
    }
    const stop: PickedStop = {
      lat: result.lat,
      lon: result.lon,
      name: result.name,
      stopId: result.id,
    };
    setForm((current) => ({
      ...current,
      stops: current.stops.map((entry, index) => (index === field.index ? stop : entry)),
    }));
    setTerm('');
    setActive(null);
    focusAfterPick(form);
  };

  const handleAddStop = () => {
    if (form.stops.length >= MAX_TRIP_STOPS) {
      return;
    }
    const index = form.stops.length;
    setForm((current) =>
      current.stops.length >= MAX_TRIP_STOPS
        ? current
        : { ...current, stops: [...current.stops, null] },
    );
    setActive({ kind: 'stop', index });
    setTerm('');
    setFocusStop(index);
  };

  const handleRemoveStop = (index: number) => {
    setForm((current) => ({
      ...current,
      stops: current.stops.filter((_entry, currentIndex) => currentIndex !== index),
    }));
    setActive((current) => {
      if (current === null || current.kind !== 'stop') {
        return current;
      }
      if (current.index === index) {
        return null;
      }
      return current.index > index ? { kind: 'stop', index: current.index - 1 } : current;
    });
    if (active !== null && active.kind === 'stop' && active.index === index) {
      setTerm('');
    }
    // The remove button disappears with its row; move focus to a stable control.
    addStopRef.current?.focus();
  };

  const handleSwap = () => {
    const swapped = { ...form, from: form.dest, dest: form.from };
    setForm(swapped);
    setActive(null);
    setTerm('');
    focusAfterPick(swapped);
  };

  const handleLocate = () => {
    if (locate.status === 'locating') {
      return;
    }
    if (typeof navigator === 'undefined' || navigator.geolocation === undefined) {
      setLocate({ status: 'failed', reason: 'unsupported' });
      return;
    }
    // Exactly one bounded read, only on this tap — never automatically.
    setLocate({ status: 'locating' });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setForm((current) => ({
          ...current,
          from: {
            lat: position.coords.latitude,
            lon: position.coords.longitude,
            name: t('plan.originCurrent'),
          },
        }));
        setLocate({ status: 'idle' });
        setTerm('');
        setActive(null);
        const located: PickedPlace = {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          name: t('plan.originCurrent'),
        };
        focusAfterPick({ ...form, from: located });
      },
      (error) => {
        const reason: LocateFailure =
          error.code === 1 ? 'denied' : error.code === 3 ? 'timeout' : 'unavailable';
        setLocate({ status: 'failed', reason });
      },
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: GEOLOCATION_TIMEOUT_MS },
    );
  };

  const canSearch = form.from !== null && form.dest !== null;
  const stops = pickedStops(form.stops);

  const handleSubmit = () => {
    if (form.from === null || form.dest === null) {
      return;
    }
    navigate(
      buildPlanPath({
        from: form.from,
        fromName: form.from.name.length > 0 ? form.from.name : null,
        dest: form.dest,
        destName: form.dest.name.length > 0 ? form.dest.name : null,
        stops,
      }),
    );
  };

  const idleGroups = useMemo<SearchGroup>(
    () => ({ stops: [], landmarks: [], routes: [], saved: search.savedPlaces }),
    [search.savedPlaces],
  );
  const baseGroups = search.status === 'idle' ? idleGroups : search.groups;
  const visibleGroups = stopMode ? onlyStops(baseGroups) : baseGroups;
  const visibleCount = countGroups(visibleGroups);
  const showResults =
    search.status === 'idle' || search.status === 'success' || search.status === 'offline';
  const idle = search.status === 'idle' || search.status === 'offline';

  const fromValue = active?.kind === 'from' ? term : (form.from?.name ?? '');
  const fromPlaceholder =
    form.from !== null && form.from.name.length > 0 ? form.from.name : t('search.fromPlaceholder');
  const toValue = active?.kind === 'to' ? term : (form.dest?.name ?? '');
  const toPlaceholder =
    form.dest !== null && form.dest.name.length > 0 ? form.dest.name : t('search.placeholder');

  const stopValue = (index: number): string => {
    if (active !== null && active.kind === 'stop' && active.index === index) {
      return term;
    }
    return form.stops[index]?.name ?? '';
  };
  const stopPlaceholder = (index: number): string => {
    const stop = form.stops[index];
    return stop !== null && stop !== undefined && stop.name.length > 0
      ? stop.name
      : t('search.stopPlaceholder');
  };

  const locateNote = locateMessage(locate, t);

  return (
    <main className="flex min-h-dvh flex-col bg-surface text-on-surface">
      <header className="border-b border-outline-variant bg-surface-container-lowest px-4 pb-3 pt-3">
        <div className="mx-auto flex w-full max-w-2xl items-start gap-2">
          <button
            type="button"
            aria-label={t('common.back')}
            onClick={() => navigate(-1)}
            className="flex size-12 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition hover:bg-surface-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            <ArrowLeft aria-hidden="true" className="size-5" />
          </button>
          <div className="flex min-w-0 flex-col">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-primary">
              {t('home.brand')}
            </p>
            <h1 className="text-xl font-bold tracking-tight text-on-surface">
              {t('search.title')}
            </h1>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-4">
        <form
          role="search"
          aria-label={t('search.title')}
          onSubmit={(event) => {
            event.preventDefault();
            handleSubmit();
          }}
          className="rounded-card border border-outline-variant bg-surface-container-lowest p-3 shadow-elevation-2"
        >
          <div className="flex items-start gap-2">
            <span aria-hidden="true" className="mt-6 flex w-5 flex-col items-center gap-1">
              <span className="size-3 rounded-full border-2 border-primary-container bg-primary" />
              <span className="h-4 w-0.5 bg-outline-variant" />
            </span>
            <PlaceField
              id={fromId}
              label={t('search.fromLabel')}
              placeholder={fromPlaceholder}
              value={fromValue}
              inputRef={(element) => {
                fromInputRef.current = element;
              }}
              onFocus={() => handleFieldFocus({ kind: 'from' })}
              onChange={(value) => handleFieldChange({ kind: 'from' }, value)}
              onClear={() => {
                handleFieldChange({ kind: 'from' }, '');
                fromInputRef.current?.focus();
              }}
            />
            <button
              type="button"
              aria-label={t('search.useMyLocation')}
              aria-busy={locate.status === 'locating'}
              disabled={locate.status === 'locating'}
              onClick={handleLocate}
              className="mt-4 flex size-12 shrink-0 items-center justify-center rounded-full border border-outline-variant bg-surface-container text-primary transition hover:bg-surface-container-high focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-wait disabled:opacity-70"
            >
              <LocateFixed aria-hidden="true" className="size-5" />
            </button>
          </div>

          {form.stops.map((_stop, index) => (
            <div
              key={index}
              data-testid={`stop-row-${index + 1}`}
              className="my-1 ml-7 flex items-center gap-1 rounded-card bg-surface-container px-2 py-1"
            >
              <span aria-hidden="true" className="pl-1 text-sm text-on-surface-variant">
                ↳
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <label htmlFor={`${stopIdBase}-${index}`} className="sr-only">
                  {t('search.stopLabel', { index: index + 1 })}
                </label>
                <input
                  id={`${stopIdBase}-${index}`}
                  ref={(element) => {
                    stopInputRefs.current[index] = element;
                  }}
                  type="search"
                  autoComplete="off"
                  enterKeyHint="search"
                  value={stopValue(index)}
                  placeholder={stopPlaceholder(index)}
                  onFocus={() => handleFieldFocus({ kind: 'stop', index })}
                  onChange={(event) =>
                    handleFieldChange({ kind: 'stop', index }, event.currentTarget.value)
                  }
                  className="min-h-12 w-full bg-transparent py-1 text-sm font-medium text-on-surface placeholder:font-normal placeholder:text-on-surface-variant focus:outline-none"
                />
              </div>
              <button
                type="button"
                aria-label={t('search.removeStopIndex', { index: index + 1 })}
                onClick={() => handleRemoveStop(index)}
                className="flex size-12 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition hover:bg-surface-container-high focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            </div>
          ))}

          <div className="flex items-start gap-2">
            <span aria-hidden="true" className="mt-6 flex w-5 items-center justify-center">
              <span className="size-3 rotate-45 rounded-sm border-2 border-outline-variant bg-on-surface" />
            </span>
            <PlaceField
              id={toId}
              label={t('search.toLabel')}
              placeholder={toPlaceholder}
              value={toValue}
              inputRef={(element) => {
                toInputRef.current = element;
              }}
              onFocus={() => handleFieldFocus({ kind: 'to' })}
              onChange={(value) => handleFieldChange({ kind: 'to' }, value)}
              onClear={() => {
                handleFieldChange({ kind: 'to' }, '');
                toInputRef.current?.focus();
              }}
            />
            <button
              type="button"
              aria-label={t('search.swap')}
              onClick={handleSwap}
              className="mt-4 flex size-12 shrink-0 items-center justify-center rounded-full border border-outline-variant bg-surface-container text-on-surface-variant transition hover:bg-surface-container-high focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              <ArrowUpDown aria-hidden="true" className="size-5" />
            </button>
          </div>

          <div className="mt-2">
            <button
              ref={addStopRef}
              type="button"
              onClick={handleAddStop}
              disabled={form.stops.length >= MAX_TRIP_STOPS}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-pill border border-dashed border-outline bg-transparent px-4 text-sm font-semibold text-primary transition hover:bg-surface-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:border-outline-variant disabled:text-on-surface-variant"
            >
              <Plus aria-hidden="true" className="size-4" />
              {t('search.addStop')}
              <span className="text-xs font-medium tabular-nums text-on-surface-variant">
                ({form.stops.length}/{MAX_TRIP_STOPS})
              </span>
            </button>
          </div>

          <button
            ref={ctaRef}
            type="button"
            onClick={handleSubmit}
            disabled={!canSearch}
            className="mt-2 flex min-h-12 w-full items-center justify-center rounded-pill bg-primary px-6 text-base font-semibold text-on-primary shadow-elevation-1 transition enabled:hover:opacity-90 enabled:active:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:bg-surface-container disabled:text-on-surface-variant disabled:shadow-none"
          >
            {t('search.findRoute')}
          </button>
        </form>

        {locateNote.length > 0 && (
          <p
            data-testid="locate-note"
            role="status"
            aria-live="polite"
            className="rounded-card bg-tertiary-container px-3 py-2 text-sm text-on-tertiary-container"
          >
            {locateNote}
          </p>
        )}

        <p
          id={statusId}
          data-testid="search-status"
          role="status"
          aria-live="polite"
          className="px-1 text-sm text-on-surface-variant"
        >
          {statusMessage(search, t, stopMode, visibleCount)}
        </p>

        {search.partial && (
          <p className="rounded-card bg-tertiary-container px-3 py-2 text-sm text-on-tertiary-container">
            {t('search.partialNote')}
          </p>
        )}

        {search.status === 'error' && (
          <button
            type="button"
            onClick={search.retry}
            className="flex min-h-12 w-full items-center justify-center rounded-pill bg-primary px-6 text-base font-medium text-on-primary transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring active:opacity-80"
          >
            {t('common.retry')}
          </button>
        )}

        {search.status === 'idle' && search.recents.length > 0 && (
          <section aria-labelledby="recents-heading">
            <h2
              id="recents-heading"
              className="px-1 pb-2 text-sm font-semibold uppercase tracking-wide text-on-surface-variant"
            >
              {t('search.recentsHeading')}
            </h2>
            <ul className="flex flex-wrap gap-2">
              {search.recents.map((recent) => (
                <li key={recent}>
                  <button
                    type="button"
                    onClick={() => {
                      // A recent chip must always type into a visible field and
                      // drop that field's old pick, or the query would run
                      // invisibly and a later selection could overwrite To.
                      const field: Field = active ?? firstEmptyField(form) ?? { kind: 'to' };
                      setActive(field);
                      setTerm(recent);
                      setForm((current) => {
                        if (field.kind === 'from') {
                          return { ...current, from: null };
                        }
                        if (field.kind === 'to') {
                          return { ...current, dest: null };
                        }
                        return {
                          ...current,
                          stops: current.stops.map((entry, index) =>
                            index === field.index ? null : entry,
                          ),
                        };
                      });
                    }}
                    className="min-h-12 rounded-pill border border-outline-variant bg-surface-container-low px-4 text-sm text-on-surface transition hover:bg-surface-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                  >
                    {recent}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {showResults && <SearchResults groups={visibleGroups} onSelect={handleSelect} />}

        {idle && search.savedPlaces.length === 0 && (
          <p className="px-1 text-sm text-on-surface-variant">{t('search.noSavedPlaces')}</p>
        )}

        {idle && (
          <button
            type="button"
            onClick={() => navigate('/saved')}
            className="flex min-h-12 items-center gap-3 rounded-card border border-outline-variant bg-surface-container-lowest px-4 text-left text-base font-medium text-on-surface transition hover:bg-surface-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            <span className="flex size-10 items-center justify-center rounded-full bg-surface-container text-on-surface-variant">
              <SearchIcon aria-hidden="true" className="size-5" />
            </span>
            {t('search.savedPlaces')}
          </button>
        )}
      </div>
    </main>
  );
}
