import { revalidateFaresStatus, revalidateSources } from './api';

/**
 * Warm the two small BFF payloads (`GET /sources`, `GET /fares/status`) after
 * the app has painted its first frame.
 *
 * These are cheap (~5 KB + ~100 B) but the app currently pays for them on
 * every screen mount. Fetching them once at idle means the second screen a
 * rider opens renders from cache instead of flashing a skeleton, while the
 * requests themselves stay off the first-paint critical path: the prefetch is
 * gated on `load`, on a first-contentful-paint entry and on
 * `requestIdleCallback`, with a `setTimeout` fallback for browsers without it.
 *
 * The requests share `lib/api.ts`'s dedupe and freshness rules, so they cannot
 * double-fetch against a screen mount, and a `Cache-Control`-fresh visit does
 * no network work at all. Best effort by design: failures are silent here, and
 * the screens keep their own honest error UI for a cold visit with no cache.
 */

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
};

/** Wait this long for an idle period after paint before warming anyway. */
const IDLE_TIMEOUT_MS = 2_500;

/** Browsers without requestIdleCallback (older Safari) warm after ~1.5 s. */
const FALLBACK_DELAY_MS = 1_500;

/** Never let a missing paint-timing entry suppress the warm-up entirely. */
const PAINT_WAIT_MS = 5_000;

function runPrefetch(): void {
  void revalidateSources().catch(() => undefined);
  void revalidateFaresStatus().catch(() => undefined);
}

function whenIdle(run: () => void): void {
  const requestIdleCallback = (window as IdleWindow).requestIdleCallback;
  if (requestIdleCallback !== undefined) {
    requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
    return;
  }
  window.setTimeout(run, FALLBACK_DELAY_MS);
}

/** Wait until the browser has painted content (FCP), not just a blank first frame. */
function afterFirstPaint(run: () => void): void {
  const hasFirstContentfulPaint = (): boolean =>
    performance
      .getEntriesByType('paint')
      .some((entry) => entry.name === 'first-contentful-paint');

  if (hasFirstContentfulPaint()) {
    whenIdle(run);
    return;
  }
  let observer: PerformanceObserver | undefined;
  let settled = false;
  const settle = (): void => {
    if (settled) return;
    settled = true;
    observer?.disconnect();
    whenIdle(run);
  };
  try {
    observer = new PerformanceObserver((list) => {
      if (list.getEntries().some((entry) => entry.name === 'first-contentful-paint')) settle();
    });
    observer.observe({ type: 'paint', buffered: true });
  } catch {
    // Paint timing unsupported: still warm, but on the idle fallback.
    settle();
    return;
  }
  window.setTimeout(settle, PAINT_WAIT_MS);
}

/** Called once from `main.tsx` after React mounts. */
export function startDataPrefetch(): void {
  if (typeof window === 'undefined') return;

  // Respect a rider's data-saving preference; the screens still fetch on demand.
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData === true) return;

  const start = (): void => afterFirstPaint(runPrefetch);
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}
