import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isOnline, subscribeOnlineStatus, useOnlineStatus } from './online';

interface FakeTarget {
  addEventListener(type: 'online' | 'offline', listener: () => void): void;
  removeEventListener(type: 'online' | 'offline', listener: () => void): void;
  dispatch(type: 'online' | 'offline'): void;
  count(type: 'online' | 'offline'): number;
}

function fakeTarget(): FakeTarget {
  const listeners = new Map<'online' | 'offline', Set<() => void>>([
    ['online', new Set()],
    ['offline', new Set()],
  ]);
  return {
    addEventListener(type, listener) {
      listeners.get(type)?.add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type) {
      for (const listener of listeners.get(type) ?? []) {
        listener();
      }
    },
    count(type) {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

function setOnline(value: boolean): void {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true });
}

beforeEach(() => setOnline(true));
afterEach(() => {
  setOnline(true);
  vi.restoreAllMocks();
});

describe('subscribeOnlineStatus', () => {
  it('subscribes to both events and unsubscribes cleanly', () => {
    const target = fakeTarget();
    const seen: boolean[] = [];

    const unsubscribe = subscribeOnlineStatus((online) => seen.push(online), target);
    expect(target.count('online')).toBe(1);
    expect(target.count('offline')).toBe(1);

    target.dispatch('offline');
    target.dispatch('online');
    expect(seen).toEqual([false, true]);

    unsubscribe();
    expect(target.count('online')).toBe(0);
    expect(target.count('offline')).toBe(0);
    target.dispatch('offline');
    expect(seen).toEqual([false, true]);
  });

  it('reads connectivity, defaulting to online without navigator', () => {
    setOnline(false);
    expect(isOnline()).toBe(false);
    setOnline(true);
    expect(isOnline()).toBe(true);
  });
});

describe('useOnlineStatus', () => {
  it('follows fake window events and removes both listeners on unmount', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { result, unmount } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);

    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(result.current).toBe(false);

    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(result.current).toBe(true);

    unmount();
    expect(removeSpy).toHaveBeenCalledWith('online', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('offline', expect.any(Function));
  });
});
