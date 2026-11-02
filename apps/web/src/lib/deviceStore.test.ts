import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEVICE_SCHEMA_VERSION,
  deviceKey,
  dropDeviceRecord,
  readDeviceRecord,
  writeDeviceRecord,
} from './deviceStore';

/** Tiny normalizer standing in for a feature's row validator. */
function strings(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
    ? value
    : undefined;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('deviceStore', () => {
  it('namespaces every key under biyahey:v1', () => {
    expect(deviceKey('saved-trips')).toBe('biyahey:v1:saved-trips');
    expect(deviceKey('recent-trips')).toBe('biyahey:v1:recent-trips');
  });

  it('writes a versioned envelope and reads it back', () => {
    expect(writeDeviceRecord('demo', ['a', 'b'])).toBe(true);

    expect(JSON.parse(localStorage.getItem(deviceKey('demo')) ?? 'null')).toEqual({
      v: DEVICE_SCHEMA_VERSION,
      data: ['a', 'b'],
    });
    expect(readDeviceRecord('demo', strings)).toEqual(['a', 'b']);
  });

  it('migrates a legacy bare payload into the envelope', () => {
    // Task 6 wrote a bare JSON array under biyahey:v1:saved-trips.
    localStorage.setItem(deviceKey('demo'), JSON.stringify(['legacy']));

    expect(readDeviceRecord('demo', strings)).toEqual(['legacy']);
    expect(JSON.parse(localStorage.getItem(deviceKey('demo')) ?? 'null')).toEqual({
      v: DEVICE_SCHEMA_VERSION,
      data: ['legacy'],
    });
  });

  it('refuses a newer schema version without destroying it', () => {
    const newer = JSON.stringify({ v: 99, data: ['from-the-future'] });
    localStorage.setItem(deviceKey('demo'), newer);

    expect(readDeviceRecord('demo', strings)).toBeUndefined();
    // The next build may understand this payload; an old build must not erase it.
    expect(localStorage.getItem(deviceKey('demo'))).toBe(newer);
  });

  it('refuses to overwrite a newer schema from an old build (I2)', () => {
    const newer = JSON.stringify({ v: 99, data: ['from-the-future'] });
    localStorage.setItem(deviceKey('demo'), newer);

    expect(writeDeviceRecord('demo', ['from-the-past'])).toBe(false);
    expect(localStorage.getItem(deviceKey('demo'))).toBe(newer);
  });

  it('drops corrupt JSON so it cannot be re-read forever', () => {
    localStorage.setItem(deviceKey('demo'), '{not-json');

    expect(readDeviceRecord('demo', strings)).toBeUndefined();
    expect(localStorage.getItem(deviceKey('demo'))).toBeNull();
  });

  it('drops a payload its normalizer rejects', () => {
    localStorage.setItem(deviceKey('demo'), JSON.stringify({ v: 1, data: [42] }));

    expect(readDeviceRecord('demo', strings)).toBeUndefined();
    expect(localStorage.getItem(deviceKey('demo'))).toBeNull();
  });

  it('reports a failed write and keeps the previous value', () => {
    expect(writeDeviceRecord('demo', ['before'])).toBe(true);
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });

    expect(writeDeviceRecord('demo', ['after'])).toBe(false);

    setItem.mockRestore();
    expect(readDeviceRecord('demo', strings)).toEqual(['before']);
  });

  it('drops one record without touching the others', () => {
    writeDeviceRecord('demo', ['a']);
    writeDeviceRecord('other', ['b']);

    expect(dropDeviceRecord('demo')).toBe(true);
    expect(readDeviceRecord('demo', strings)).toBeUndefined();
    expect(readDeviceRecord('other', strings)).toEqual(['b']);
  });
});
