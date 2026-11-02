import { useEffect, useState } from 'react';

/**
 * Online/offline listeners (the Task 4 deferred item).
 *
 * `navigator.onLine` alone is a snapshot: a screen that only reads it once
 * keeps claiming "offline" after the connection returns (or the reverse). This
 * module subscribes to the window's `online`/`offline` events and unsubscribes
 * on unmount, so the saved screen's badge and the fare-matrix check follow the
 * device honestly.
 */

export type OnlineChangeListener = (online: boolean) => void;

/** The slice of `Window` the subscription needs; a fake target is testable. */
export interface OnlineEventTarget {
  addEventListener(type: 'online' | 'offline', listener: () => void): void;
  removeEventListener(type: 'online' | 'offline', listener: () => void): void;
}

/** Current device connectivity, defaulting to online where `navigator` is absent. */
export function isOnline(): boolean {
  if (typeof navigator === 'undefined') {
    return true;
  }
  return navigator.onLine;
}

/**
 * Subscribe to connectivity changes and return the unsubscribe function.
 * The listener is never called immediately; callers seed their own state.
 */
export function subscribeOnlineStatus(
  onChange: OnlineChangeListener,
  target: OnlineEventTarget | undefined = typeof window === 'undefined' ? undefined : window,
): () => void {
  if (target === undefined) {
    return () => {
      // No window (SSR/test pre-render): nothing was subscribed.
    };
  }
  const handleOnline = () => onChange(true);
  const handleOffline = () => onChange(false);
  target.addEventListener('online', handleOnline);
  target.addEventListener('offline', handleOffline);
  return () => {
    target.removeEventListener('online', handleOnline);
    target.removeEventListener('offline', handleOffline);
  };
}

/** React binding used by the saved screen and the fare-matrix check. */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(isOnline);

  useEffect(() => {
    // Re-sync in case the OS changed state between render and subscribe.
    setOnline(isOnline());
    return subscribeOnlineStatus(setOnline);
  }, []);

  return online;
}
