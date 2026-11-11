import type { SearchResultDto } from '@biyahey/shared';
import {
  ArrowUpDown,
  Bookmark,
  CircleDot,
  LocateFixed,
  MapPin,
  MapPinned,
  Plus,
  Search as SearchIcon,
  TriangleAlert,
  X,
} from 'lucide-react';
import { Fragment, useEffect, useId, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { usePanelDetent } from '../components/Panel';
import { PlaceField } from '../components/search/PlaceField';
import { RecentTrips } from '../components/search/RecentTrips';
import { SearchGroups } from '../components/search/SearchGroups';
import { LOCATE_FAILURE_KEYS, useLocate } from '../components/search/useLocate';
import { countGroups, onlyStops, useTypeahead } from '../components/search/useTypeahead';
import { useCopy } from '../i18n';
import { MAX_TRIP_STOPS, buildPlanPath, parseTripParams, type TripDraft } from '../lib/trip';
import { mapActions } from '../map/store';

interface PickedPlace {
  lat: number;
  lon: number;
  name: string;
}

interface PickedStop extends PickedPlace {
  stopId: string;
}

type Field = { kind: 'from' } | { kind: 'to' } | { kind: 'stop'; index: number };

type FocusTarget =
  | { kind: 'from' }
  | { kind: 'to' }
  | { kind: 'submit' }
  | { kind: 'addStop' }
  | { kind: 'stop'; index: number };

interface TripForm {
  from: PickedPlace | null;
  dest: PickedPlace | null;
  stops: Array<PickedStop | null>;
}

function sameField(a: Field | null, b: Field | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind !== b.kind) return false;
  return a.kind === 'stop' && b.kind === 'stop' ? a.index === b.index : true;
}

/** `/search?from=…&dest=…&via=…` prefills the directions form. */
function formFromParams(params: URLSearchParams): TripForm {
  const parsed = parseTripParams(params);
  return {
    from: parsed.from === null ? null : { ...parsed.from, name: parsed.fromName ?? '' },
    dest: parsed.dest === null ? null : { ...parsed.dest, name: parsed.destName ?? '' },
    stops: parsed.stops.map((stop) => ({
      lat: stop.lat,
      lon: stop.lon,
      stopId: stop.stopId,
      name: stop.name,
    })),
  };
}

/** `/search` — the directions form: From, up to two via stops, To, then results. */
export function Search() {
  usePanelDetent('full');
  const navigate = useNavigate();
  const { t } = useCopy();
  const [params] = useSearchParams();
  const baseId = useId();

  const [form, setForm] = useState<TripForm>(() => formFromParams(params));
  const [active, setActive] = useState<Field | null>(null);
  const [term, setTerm] = useState('');
  const [pendingFocus, setPendingFocus] = useState<FocusTarget | null>(null);

  const fromRef = useRef<HTMLInputElement | null>(null);
  const toRef = useRef<HTMLInputElement | null>(null);
  const stopRefs = useRef<Array<HTMLInputElement | null>>([]);
  const submitRef = useRef<HTMLButtonElement | null>(null);
  const addStopRef = useRef<HTMLButtonElement | null>(null);

  const near = form.from === null ? undefined : { lat: form.from.lat, lon: form.from.lon };
  const typeahead = useTypeahead(active === null ? '' : term, near);
  const stopMode = active !== null && active.kind === 'stop';
  const groups = stopMode ? onlyStops(typeahead.groups) : typeahead.groups;
  const visibleCount = countGroups(groups);
  const canSubmit = form.from !== null && form.dest !== null;

  // A fresh search starts on a clean map; a stale plan must not show through.
  useEffect(() => {
    mapActions.reset();
  }, []);

  // Focus the first thing the rider still has to fill in.
  useEffect(() => {
    if (form.from === null) fromRef.current?.focus();
    else if (form.dest === null) toRef.current?.focus();
    else submitRef.current?.focus();
    // Mount only: the URL is read once.
  }, []);

  useEffect(() => {
    if (pendingFocus === null) return;
    const target = pendingFocus;
    setPendingFocus(null);
    if (target.kind === 'from') fromRef.current?.focus();
    else if (target.kind === 'to') toRef.current?.focus();
    else if (target.kind === 'submit') submitRef.current?.focus();
    else if (target.kind === 'addStop') addStopRef.current?.focus();
    else stopRefs.current[target.index]?.focus();
  }, [pendingFocus]);

  const located = useLocate((point) => {
    setForm((current) => ({
      ...current,
      from: { lat: point.lat, lon: point.lon, name: t('plan.originCurrent') },
    }));
    setActive(null);
    setTerm('');
    mapActions.setUserLocation(point);
    setPendingFocus(form.dest === null ? { kind: 'to' } : { kind: 'submit' });
  });

  const valueFor = (field: Field): string => {
    if (sameField(active, field)) return term;
    if (field.kind === 'from') return form.from?.name ?? '';
    if (field.kind === 'to') return form.dest?.name ?? '';
    return form.stops[field.index]?.name ?? '';
  };

  const startEditing = (field: Field) => {
    if (sameField(active, field)) return;
    const current = valueFor(field);
    setActive(field);
    setTerm(current);
  };

  const clearPicked = (field: Field) => {
    setForm((current) => {
      if (field.kind === 'from') {
        return current.from === null ? current : { ...current, from: null };
      }
      if (field.kind === 'to') {
        return current.dest === null ? current : { ...current, dest: null };
      }
      if (current.stops[field.index] === undefined || current.stops[field.index] === null) {
        return current;
      }
      return {
        ...current,
        stops: current.stops.map((stop, index) => (index === field.index ? null : stop)),
      };
    });
  };

  const handleChange = (field: Field, value: string) => {
    setActive(field);
    setTerm(value);
    // Typing means the old pick is no longer what the field submits.
    clearPicked(field);
  };

  const handleClear = (field: Field) => {
    setActive(field);
    setTerm('');
    clearPicked(field);
    if (field.kind === 'from') fromRef.current?.focus();
    else if (field.kind === 'to') toRef.current?.focus();
    else stopRefs.current[field.index]?.focus();
  };

  const handleSelect = (result: SearchResultDto) => {
    const field: Field =
      active ??
      (form.from === null ? { kind: 'from' } : form.dest === null ? { kind: 'to' } : { kind: 'to' });
    const place: PickedPlace = { lat: result.lat, lon: result.lon, name: result.label };

    if (field.kind === 'from') {
      setForm((current) => ({ ...current, from: place }));
      setTerm('');
      if (form.dest === null) {
        setActive({ kind: 'to' });
        setPendingFocus({ kind: 'to' });
      } else {
        setActive(null);
        setPendingFocus({ kind: 'submit' });
      }
      return;
    }

    if (field.kind === 'to') {
      setForm((current) => ({ ...current, dest: place }));
      setTerm('');
      setActive(null);
      setPendingFocus(form.from === null ? { kind: 'from' } : { kind: 'submit' });
      return;
    }

    // A via stop needs the served stop id; landmarks cannot be routed through.
    if (result.type !== 'stop') return;
    const stop: PickedStop = {
      lat: result.lat,
      lon: result.lon,
      name: result.label,
      stopId: result.id,
    };
    setForm((current) => ({
      ...current,
      stops: current.stops.map((entry, index) => (index === field.index ? stop : entry)),
    }));
    setTerm('');
    setActive(null);
    setPendingFocus(form.from !== null && form.dest !== null ? { kind: 'submit' } : { kind: 'from' });
  };

  const handleAddStop = () => {
    if (form.stops.length >= MAX_TRIP_STOPS) return;
    const index = form.stops.length;
    setForm((current) =>
      current.stops.length >= MAX_TRIP_STOPS
        ? current
        : { ...current, stops: [...current.stops, null] },
    );
    setActive({ kind: 'stop', index });
    setTerm('');
    setPendingFocus({ kind: 'stop', index });
  };

  const handleRemoveStop = (index: number) => {
    setForm((current) => ({
      ...current,
      stops: current.stops.filter((_stop, currentIndex) => currentIndex !== index),
    }));
    setActive(null);
    setTerm('');
    setPendingFocus({ kind: 'addStop' });
  };

  const handleSwap = () => {
    setForm((current) => ({ ...current, from: current.dest, dest: current.from }));
    setActive(null);
    setTerm('');
    if (form.from === null) setPendingFocus({ kind: 'from' });
    else if (form.dest === null) setPendingFocus({ kind: 'to' });
    else setPendingFocus({ kind: 'submit' });
  };

  const handleSubmit = () => {
    if (form.from === null || form.dest === null) return;
    const draft: TripDraft = {
      from: { lat: form.from.lat, lon: form.from.lon },
      fromName: form.from.name.trim().length > 0 ? form.from.name.trim() : null,
      dest: { lat: form.dest.lat, lon: form.dest.lon },
      destName: form.dest.name.trim().length > 0 ? form.dest.name.trim() : null,
      stops: form.stops.filter((stop): stop is PickedStop => stop !== null),
    };
    navigate(buildPlanPath(draft));
  };

  const statusMessage = (() => {
    switch (typeahead.status) {
      case 'loading':
        return t('search.loading');
      case 'success':
        if (visibleCount > 0) return t('search.results', { count: visibleCount });
        if (stopMode) {
          return typeahead.partial
            ? t('search.partialNoStops', { query: typeahead.query })
            : t('search.noStops', { query: typeahead.query });
        }
        return typeahead.partial
          ? t('search.partialNoResults', { query: typeahead.query })
          : t('search.noResults', { query: typeahead.query });
      case 'error':
        return t('search.error');
      case 'idle':
      default:
        return t('search.idle');
    }
  })();

  const locateNote =
    located.state.status === 'locating'
      ? t('plan.locatingStatus')
      : located.state.status === 'failed'
        ? t(LOCATE_FAILURE_KEYS[located.state.reason])
        : '';
  const locateFailed = located.state.status === 'failed';
  const locateReason = located.state.status === 'failed' ? located.state.reason : null;

  return (
    <div className="flex flex-col pb-6">
      <div className="px-5 pb-3 pt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand">
          {t('home.eyebrow')}
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink">{t('search.heading')}</h1>
      </div>

      <form
        role="search"
        aria-label={t('search.title')}
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit();
        }}
        className="mx-5 flex flex-col gap-3"
      >
        <div className="overflow-hidden rounded-lg border border-line bg-white shadow-sm">
          <PlaceField
            id={`${baseId}-from`}
            label={t('search.fromLabel')}
            placeholder={t('search.fromPlaceholder')}
            value={valueFor({ kind: 'from' })}
            icon={<CircleDot className="size-4 text-success" />}
            inputRef={(element) => {
              fromRef.current = element;
            }}
            onFocus={() => startEditing({ kind: 'from' })}
            onChange={(value) => handleChange({ kind: 'from' }, value)}
            onClear={() => handleClear({ kind: 'from' })}
            trailing={
              <button
                type="button"
                onClick={located.locate}
                disabled={located.state.status === 'locating'}
                aria-busy={located.state.status === 'locating'}
                aria-label={t('search.useMyLocation')}
                className="flex size-12 shrink-0 items-center justify-center rounded-full text-brand transition hover:bg-brand-tint disabled:cursor-wait disabled:opacity-60"
              >
                <LocateFixed
                  aria-hidden="true"
                  className={`size-5 ${located.state.status === 'locating' ? 'animate-pulse' : ''}`}
                />
              </button>
            }
          />

          {form.stops.map((_stop, index) => (
            <Fragment key={`stop-${index}`}>
              <div className="mx-3 h-px bg-line" />
              <PlaceField
                id={`${baseId}-stop-${index}`}
                label={t('search.stopLabel', { index: index + 1 })}
                placeholder={t('search.stopPlaceholder')}
                value={valueFor({ kind: 'stop', index })}
                icon={<MapPin className="size-4" />}
                inputRef={(element) => {
                  stopRefs.current[index] = element;
                }}
                onFocus={() => startEditing({ kind: 'stop', index })}
                onChange={(value) => handleChange({ kind: 'stop', index }, value)}
                trailing={
                  <button
                    type="button"
                    onClick={() => handleRemoveStop(index)}
                    aria-label={t('search.removeStopIndex', { index: index + 1 })}
                    className="flex size-12 shrink-0 items-center justify-center rounded-full text-ink-faint transition hover:bg-canvas hover:text-danger"
                  >
                    <X aria-hidden="true" className="size-4" />
                  </button>
                }
              />
            </Fragment>
          ))}

          <div className="mx-3 h-px bg-line" />
          <PlaceField
            id={`${baseId}-to`}
            label={t('search.toLabel')}
            placeholder={t('search.placeholder')}
            value={valueFor({ kind: 'to' })}
            icon={<MapPinned className="size-4 text-danger" />}
            inputRef={(element) => {
              toRef.current = element;
            }}
            onFocus={() => startEditing({ kind: 'to' })}
            onChange={(value) => handleChange({ kind: 'to' }, value)}
            onClear={() => handleClear({ kind: 'to' })}
            trailing={
              <button
                type="button"
                onClick={handleSwap}
                aria-label={t('search.swap')}
                className="flex size-12 shrink-0 items-center justify-center rounded-full text-ink-soft transition hover:bg-canvas hover:text-brand"
              >
                <ArrowUpDown aria-hidden="true" className="size-5" />
              </button>
            }
          />
        </div>

        <button
          ref={addStopRef}
          type="button"
          onClick={handleAddStop}
          disabled={form.stops.length >= MAX_TRIP_STOPS}
          className="flex min-h-12 items-center justify-center gap-2 rounded-md border border-dashed border-line-strong bg-white text-sm font-semibold text-brand transition hover:border-brand hover:bg-brand-tint disabled:cursor-not-allowed disabled:text-ink-faint disabled:hover:border-line-strong disabled:hover:bg-white"
        >
          <Plus aria-hidden="true" className="size-4" />
          {t('search.addStop')}
          <span className="text-xs font-medium tabular-nums text-ink-faint">
            ({form.stops.length}/{MAX_TRIP_STOPS})
          </span>
        </button>

        <button
          ref={submitRef}
          type="submit"
          disabled={!canSubmit}
          className="flex min-h-12 items-center justify-center gap-2 rounded-md bg-brand px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-strong disabled:cursor-not-allowed disabled:bg-line-strong disabled:text-ink-faint"
        >
          <SearchIcon aria-hidden="true" className="size-4" />
          {t('search.findRoute')}
        </button>
      </form>

      {locateNote.length > 0 ? (
        <div
          role="status"
          aria-live="polite"
          className={`mx-5 mt-3 flex items-start gap-2 rounded-md px-3 py-2 text-xs leading-5 ${
            locateFailed
              ? 'border border-danger/40 bg-white text-ink'
              : 'bg-brand-tint text-brand-deep'
          }`}
        >
          {locateFailed ? (
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-danger" />
          ) : null}
          <span className="min-w-0 flex-1">{locateNote}</span>
          {locateFailed && locateReason !== 'unsupported' ? (
            <button
              type="button"
              onClick={located.locate}
              className="shrink-0 font-semibold text-brand underline-offset-2 hover:underline"
            >
              {t('common.retry')}
            </button>
          ) : null}
        </div>
      ) : null}

      <section className="px-5 pt-4" aria-label={t('search.label')}>
        <p role="status" aria-live="polite" className="text-sm font-semibold text-ink-soft">
          {statusMessage}
        </p>

        {typeahead.status === 'success' && typeahead.partial ? (
          <p className="mt-1 rounded-md bg-brand-tint px-3 py-2 text-xs leading-5 text-brand-deep">
            {t('search.partialNote')}
          </p>
        ) : null}

        {typeahead.status === 'error' ? (
          <button
            type="button"
            onClick={typeahead.retry}
            className="mt-2 min-h-12 rounded-md border border-line-strong bg-white px-4 text-sm font-semibold text-brand"
          >
            {t('common.retry')}
          </button>
        ) : null}

        {typeahead.status === 'success' && visibleCount > 0 ? (
          <SearchGroups groups={groups} onSelect={handleSelect} />
        ) : null}

        {typeahead.status === 'idle' ? (
          <div className="mt-2 flex flex-col gap-4">
            <RecentTrips onOpen={(id) => navigate(`/trip/${id}`)} />
            <button
              type="button"
              onClick={() => navigate('/saved')}
              className="flex min-h-12 items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm font-medium text-ink shadow-sm transition hover:border-brand hover:bg-brand-tint"
            >
              <Bookmark aria-hidden="true" className="size-4 text-brand" />
              {t('home.saved')}
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
