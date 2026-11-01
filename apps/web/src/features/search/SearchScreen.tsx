import type { SearchGroup, SearchResultDto } from '@biyahey/shared';
import { ArrowLeft, Search as SearchIcon, X } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SearchResults } from './SearchResults';
import { useSearch, type SearchOutcome } from './useSearch';

/**
 * Typeahead search screen (spec §10, Task 4).
 *
 * The screen owns the query string and renders the hook's honest state:
 * recents/saved places while idle, a live result count (in the polite status
 * region), an incomplete-results note for `partial: true`, a retryable error,
 * and — when the device is offline — saved places under the exact
 * "Walang signal — showing saved places" copy instead of a blank screen.
 */
export function SearchScreen() {
  const [term, setTerm] = useState('');
  const navigate = useNavigate();
  const inputId = useId();
  const statusId = useId();
  const search = useSearch(term);

  const idleGroups = useMemo<SearchGroup>(
    () => ({ stops: [], landmarks: [], routes: [], saved: search.savedPlaces }),
    [search.savedPlaces],
  );
  const groups = search.status === 'idle' ? idleGroups : search.groups;
  const showResults =
    search.status === 'idle' || search.status === 'success' || search.status === 'offline';

  const handleSelect = (result: SearchResultDto) => {
    // Task 5 owns the route-options screen; the chosen place travels in the URL
    // so it can be planned without a second search.
    navigate(
      `/plan?dest=${result.lat},${result.lon}&name=${encodeURIComponent(result.name)}`,
    );
  };

  return (
    <main className="flex min-h-dvh flex-col bg-surface text-on-surface">
      <header className="border-b border-outline-variant bg-surface-container-lowest px-4 pb-3 pt-3">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-2">
          <button
            type="button"
            aria-label="Bumalik"
            onClick={() => navigate(-1)}
            className="flex size-12 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition hover:bg-surface-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            <ArrowLeft aria-hidden="true" className="size-5" />
          </button>
          <form
            role="search"
            onSubmit={(event) => event.preventDefault()}
            className="flex min-h-12 flex-1 items-center gap-2 rounded-pill border border-outline bg-surface-container-low pl-4 pr-2 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus-ring"
          >
            <SearchIcon aria-hidden="true" className="size-5 shrink-0 text-on-surface-variant" />
            <label htmlFor={inputId} className="sr-only">
              Maghanap ng lugar
            </label>
            <input
              id={inputId}
              type="search"
              autoFocus
              autoComplete="off"
              enterKeyHint="search"
              placeholder="Saan ka pupunta?"
              value={term}
              onChange={(event) => setTerm(event.currentTarget.value)}
              aria-describedby={statusId}
              className="min-h-12 w-full bg-transparent py-2 text-base text-on-surface placeholder:text-on-surface-variant focus:outline-none"
            />
            {term.length > 0 && (
              <button
                type="button"
                aria-label="Burahin ang search"
                onClick={() => setTerm('')}
                className="flex size-10 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition hover:bg-surface-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              >
                <X aria-hidden="true" className="size-5" />
              </button>
            )}
          </form>
        </div>
        <h1 className="sr-only">Saan papunta?</h1>
      </header>

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-4">
        <p
          id={statusId}
          role="status"
          aria-live="polite"
          className="px-1 text-sm text-on-surface-variant"
        >
          {statusMessage(search)}
        </p>

        {search.status === 'success' && search.partial && (
          <p className="rounded-card bg-tertiary-container px-3 py-2 text-sm text-on-tertiary-container">
            Maaaring hindi kumpleto — results may be incomplete.
          </p>
        )}

        {search.status === 'error' && (
          <button
            type="button"
            onClick={search.retry}
            className="flex min-h-12 w-full items-center justify-center rounded-pill bg-primary px-6 text-base font-medium text-on-primary transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring active:opacity-80"
          >
            Subukan ulit
          </button>
        )}

        {search.status === 'idle' && search.recents.length > 0 && (
          <section aria-labelledby="recents-heading">
            <h2
              id="recents-heading"
              className="px-1 pb-2 text-sm font-semibold uppercase tracking-wide text-on-surface-variant"
            >
              Mga kamakailang hanap
            </h2>
            <ul className="flex flex-wrap gap-2">
              {search.recents.map((recent) => (
                <li key={recent}>
                  <button
                    type="button"
                    onClick={() => setTerm(recent)}
                    className="min-h-12 rounded-pill border border-outline-variant bg-surface-container-low px-4 text-sm text-on-surface transition hover:bg-surface-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                  >
                    {recent}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {showResults && <SearchResults groups={groups} onSelect={handleSelect} />}

        {(search.status === 'idle' || search.status === 'offline') &&
          search.savedPlaces.length === 0 && (
            <p className="px-1 text-sm text-on-surface-variant">
              Wala pang naka-save na lugar. I-tap ang “Saved places” para mag-imbak.
            </p>
          )}

        {(search.status === 'idle' || search.status === 'offline') && (
          <button
            type="button"
            onClick={() => navigate('/saved')}
            className="flex min-h-12 items-center gap-3 rounded-card border border-outline-variant bg-surface-container-lowest px-4 text-left text-base font-medium text-on-surface transition hover:bg-surface-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            <span className="flex size-10 items-center justify-center rounded-full bg-surface-container text-on-surface-variant">
              <SearchIcon aria-hidden="true" className="size-5" />
            </span>
            Saved places
          </button>
        )}
      </div>
    </main>
  );
}

function statusMessage(search: SearchOutcome): string {
  switch (search.status) {
    case 'loading':
      return 'Naghahanap…';
    case 'success':
      return search.count === 0
        ? `Walang resulta para sa “${search.query}”.`
        : `${search.count} resulta`;
    case 'offline':
      return 'Walang signal — showing saved places';
    case 'error':
      return 'Hindi ma-load ang search. Subukan ulit.';
    case 'idle':
    default:
      return 'Mag-type para maghanap ng stops, landmarks, at ruta.';
  }
}
