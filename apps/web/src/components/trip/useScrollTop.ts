import { useEffect, useRef, type RefObject } from 'react';

/**
 * Start a screen scrolled to its top.
 *
 * The Panel keeps one scroll container across route changes, so without this a
 * screen opened from far down a list would land mid-content.
 */
export function useScrollTopOnMount(key: unknown): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'start' });
  }, [key]);

  return ref;
}
