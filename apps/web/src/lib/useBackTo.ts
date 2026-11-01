import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Back follows the app's own history when there is one. A PWA deep link into a
 * screen is the first history entry, so `navigate(-1)` would leave the app;
 * that case falls back to `fallback` instead.
 *
 * Shared by the route wrappers and the lazy `/plan` and `/trip` pages so their
 * back behaviour cannot drift.
 */
export function useBackTo(fallback: string): () => void {
  const navigate = useNavigate();
  return useCallback(() => {
    const state: unknown = window.history.state;
    const idx =
      typeof state === 'object' && state !== null ? (state as { idx?: unknown }).idx : undefined;
    if (typeof idx === 'number' && idx > 0) {
      navigate(-1);
    } else {
      navigate(fallback);
    }
  }, [fallback, navigate]);
}
