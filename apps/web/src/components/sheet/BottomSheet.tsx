import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

/**
 * Non-modal bottom sheet, dependency-free.
 *
 * Detents are named positionally: the first is `peek`, the last `expanded`, and
 * anything in between is `half`. Numeric detents are pixel heights; named ones
 * resolve against the viewport (`half` = 50 vh, `expanded` = viewport minus one
 * 48 dp target so a strip of map stays visible). There is no scrim, no focus
 * trap and no `aria-modal`: the map behind the sheet stays usable.
 *
 * Dragging and the keyboard/button alternative share one control (the drag
 * handle is a button): activating it expands from peek or collapses one detent,
 * ArrowUp/ArrowDown step through detents, and Escape collapses one detent.
 */

export type SheetDetentName = 'peek' | 'half' | 'expanded';
export type SheetDetent = number | SheetDetentName;

export interface SheetMapPadding {
  /** Detent the sheet is snapped to. */
  detent: SheetDetentName;
  /** Sheet height in CSS pixels. */
  height: number;
  /** Space map controls should keep clear at the bottom, in CSS pixels. */
  bottom: number;
}

export interface BottomSheetProps {
  detents: readonly SheetDetent[];
  initial?: SheetDetentName;
  onDetentChange?: (detent: SheetDetentName) => void;
  /** Map-padding callback for siblings (e.g. the map slot) outside this context. */
  onMapPaddingChange?: (padding: SheetMapPadding) => void;
  label?: string;
  className?: string;
  children: ReactNode;
}

const DEFAULT_DETENTS: readonly SheetDetent[] = [96, 'half', 'expanded'];
const DEFAULT_PEEK_HEIGHT = 96;
/** One 48 dp target of map stays tappable when the sheet is fully expanded. */
const EXPANDED_TOP_GAP = 48;
const DRAG_THRESHOLD = 4;
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

const SheetMapPaddingContext = createContext<SheetMapPadding | null>(null);

/** Map padding for controls rendered inside the sheet; `null` outside a sheet. */
export function useSheetMapPadding(): SheetMapPadding | null {
  return useContext(SheetMapPaddingContext);
}

function namesFor(detents: readonly SheetDetent[]): SheetDetentName[] {
  return detents.map((detent, index) => {
    if (typeof detent === 'string') return detent;
    if (index === detents.length - 1) return 'expanded';
    return index === 0 ? 'peek' : 'half';
  });
}

function peekHeightFor(detents: readonly SheetDetent[]): number {
  const firstNumeric = detents.find((detent): detent is number => typeof detent === 'number');
  return firstNumeric ?? DEFAULT_PEEK_HEIGHT;
}

function resolveHeight(detent: SheetDetent, viewportHeight: number, peekHeight: number): number {
  if (typeof detent === 'number') return Math.max(0, detent);
  if (detent === 'peek') return peekHeight;
  if (detent === 'half') return Math.round(viewportHeight / 2);
  return Math.max(peekHeight, viewportHeight - EXPANDED_TOP_GAP);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function useViewportHeight(): number {
  const [height, setHeight] = useState(() =>
    typeof window === 'undefined' ? 768 : window.innerHeight,
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setHeight(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return height;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(REDUCED_MOTION_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(REDUCED_MOTION_QUERY);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

export function BottomSheet({
  detents,
  initial = 'peek',
  onDetentChange,
  onMapPaddingChange,
  label = 'Trip details',
  className,
  children,
}: BottomSheetProps) {
  const resolvedDetents = detents.length > 0 ? detents : DEFAULT_DETENTS;
  const names = useMemo(() => namesFor(resolvedDetents), [resolvedDetents]);
  const peekHeight = useMemo(() => peekHeightFor(resolvedDetents), [resolvedDetents]);
  const viewportHeight = useViewportHeight();
  const reducedMotion = useReducedMotion();
  const bodyId = useId();

  const [index, setIndex] = useState(() => Math.max(0, names.indexOf(initial)));
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{
    pointerId: number;
    startY: number;
    startHeight: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);
  /** Set while a pushed history entry is guarding "back collapses the sheet". */
  const historyGuardRef = useRef(false);

  const detentName = names[index] ?? 'peek';
  const detentHeight = resolveHeight(resolvedDetents[index] ?? 'peek', viewportHeight, peekHeight);
  const renderedHeight = dragHeight ?? detentHeight;
  const atPeek = index === 0;

  const commitDetent = (nextIndex: number) => {
    const clamped = clamp(nextIndex, 0, names.length - 1);
    if (clamped === index) return;
    setIndex(clamped);
    onDetentChange?.(names[clamped]);
  };

  // Map padding is snapped, not live during a drag, so consumers do not thrash.
  const mapPadding = useMemo<SheetMapPadding>(
    () => ({ detent: detentName, height: detentHeight, bottom: detentHeight }),
    [detentName, detentHeight],
  );

  useEffect(() => {
    onMapPaddingChange?.(mapPadding);
  }, [mapPadding, onMapPaddingChange]);

  // Escape collapses one detent. The listener lives on the document because the
  // sheet is non-modal: focus may be on the map or the search pill.
  useEffect(() => {
    if (index === 0) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      commitDetent(index - 1);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
    // `commitDetent` is recreated per render and reads the current index.
  }, [index]);

  // Android back / browser back collapses one detent before the route pops: a
  // guard entry is pushed while the sheet is above peek, and re-armed after
  // each collapse that is still above peek.
  useEffect(() => {
    if (index === 0 || historyGuardRef.current) return;
    const currentState =
      typeof window.history.state === 'object' && window.history.state !== null
        ? (window.history.state as Record<string, unknown>)
        : {};
    window.history.pushState({ ...currentState, biyaheySheet: true }, '');
    historyGuardRef.current = true;
  }, [index]);

  useEffect(() => {
    if (index === 0) return;
    const onPopState = () => {
      if (!historyGuardRef.current) return;
      historyGuardRef.current = false;
      commitDetent(index - 1);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [index]);

  // Collapsing to peek from the UI retires the unused guard entry, so the next
  // back press navigates instead of being swallowed by a stale entry.
  useEffect(() => {
    if (index !== 0 || !historyGuardRef.current) return;
    historyGuardRef.current = false;
    window.history.back();
  }, [index]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    suppressClickRef.current = false;
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: detentHeight,
      moved: false,
    };
    setDragging(true);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is unavailable in jsdom and older WebViews; the drag
      // still tracks while the pointer is over the handle.
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const delta = drag.startY - event.clientY;
    if (Math.abs(delta) >= DRAG_THRESHOLD) drag.moved = true;
    const maxHeight = resolveHeight('expanded', viewportHeight, peekHeight);
    setDragHeight(clamp(drag.startHeight + delta, peekHeight, maxHeight));
  };

  const finishDrag = (event: ReactPointerEvent<HTMLButtonElement>, cancelled: boolean) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    const droppedHeight = dragHeight ?? detentHeight;
    setDragHeight(null);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // No capture to release (jsdom / unsupported WebView).
    }
    if (!drag.moved || cancelled) return;

    // A real pointerup after a drag is followed by a click; swallow that click
    // so the drag does not also toggle a detent.
    suppressClickRef.current = true;

    const heights = resolvedDetents.map((detent) =>
      resolveHeight(detent, viewportHeight, peekHeight),
    );
    let nearest = 0;
    heights.forEach((height, detentIndex) => {
      if (Math.abs(height - droppedHeight) < Math.abs(heights[nearest] - droppedHeight)) {
        nearest = detentIndex;
      }
    });
    commitDetent(nearest);
  };

  const handleClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    commitDetent(atPeek ? index + 1 : index - 1);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      commitDetent(index + 1);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      commitDetent(index - 1);
    }
  };

  const motionClass =
    reducedMotion || dragging
      ? 'transition-none'
      : 'transition-[height] duration-300 ease-[cubic-bezier(0.2,0,0,1)]';

  return (
    <section
      data-testid="sheet"
      data-detent={detentName}
      data-motion={reducedMotion ? 'reduced' : 'full'}
      data-dragging={dragging ? 'true' : undefined}
      aria-label={label}
      className={[
        'pointer-events-auto absolute inset-x-0 bottom-0 z-10 mx-auto flex max-w-2xl flex-col overflow-hidden rounded-t-sheet bg-surface-container text-on-surface shadow-elevation-3',
        motionClass,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ height: renderedHeight }}
    >
      <button
        type="button"
        aria-label={atPeek ? 'Expand sheet' : 'Collapse sheet'}
        aria-expanded={!atPeek}
        aria-controls={bodyId}
        aria-keyshortcuts="ArrowUp ArrowDown"
        className="group flex h-12 w-full shrink-0 touch-none items-center justify-center rounded-t-sheet focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus-ring"
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => finishDrag(event, false)}
        onPointerCancel={(event) => finishDrag(event, true)}
      >
        <span
          aria-hidden="true"
          className="h-1 w-10 rounded-pill bg-outline-variant transition-colors group-hover:bg-outline"
        />
      </button>
      <div
        id={bodyId}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        <SheetMapPaddingContext.Provider value={mapPadding}>
          {children}
        </SheetMapPaddingContext.Provider>
      </div>
    </section>
  );
}
