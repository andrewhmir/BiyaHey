/**
 * Device store — the one place the PWA reads, writes or drops localStorage.
 *
 * Every key lives in the `biyahey:v1:*` namespace and every payload is wrapped
 * in a versioned envelope (`{ v: 1, data }`). That fixes three problems the
 * Task 4/6 code had to solve ad hoc:
 *
 * - **Schema drift.** A stored payload carries the schema version it was
 *   written with. The migration guard only reads envelopes this build
 *   understands (`v: 1`); a payload from a newer build is left untouched rather
 *   than mis-parsed, and a payload from an older, unversioned build is handed
 *   to the caller's normalizer and re-written as `v: 1` on the way out. The
 *   Task 6 saved-trips store was a bare JSON array under
 *   `biyahey:v1:saved-trips`, so existing installs keep their saved trips.
 * - **Quota/private mode.** Every `getItem`/`setItem`/`removeItem` call is
 *   wrapped. A failed write returns `false`; it never throws at the rider. A
 *   corrupt payload is dropped instead of being re-read on every render.
 * - **One writer.** Feature modules never touch `window.localStorage`
 *   directly; they call {@link readDeviceRecord} / {@link writeDeviceRecord}.
 *   The saved-trips store in `lib/savedTripsStore.ts` is the only writer for
 *   the saved/recent lists (R63/R66).
 */

/** Namespace shared by search cache, saved trips and future device data. */
export const DEVICE_KEY_PREFIX = 'biyahey:v1';

/** Schema version this build reads and writes. */
export const DEVICE_SCHEMA_VERSION = 1;

/** The envelope written under every `biyahey:v1:*` key. */
export interface DeviceEnvelope {
  v: number;
  data: unknown;
}

/** Turns an unknown stored payload into `T`, or `undefined` when unusable. */
export type DeviceRecordNormalizer<T> = (payload: unknown) => T | undefined;

/** `biyahey:v1:<name>` — the only key shape this module produces. */
export function deviceKey(name: string): string {
  return `${DEVICE_KEY_PREFIX}:${name}`;
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read and normalize one record.
 *
 * - Missing storage/key → `undefined`.
 * - Corrupt JSON, or a payload the normalizer rejects → the key is dropped and
 *   `undefined` is returned (a bad row must never survive to crash a renderer).
 * - `v: 1` envelope → the normalizer sees `data`.
 * - Another numeric version → refused and left on disk: that payload may
 *   belong to a newer build, and an old build must not destroy it.
 * - No envelope (legacy Task 6 bare array) → normalized, then re-written as a
 *   `v: 1` envelope. If that migration write fails (quota), the legacy payload
 *   stays readable on the next launch.
 */
export function readDeviceRecord<T>(
  name: string,
  normalize: DeviceRecordNormalizer<T>,
): T | undefined {
  const store = storage();
  if (store === null) {
    return undefined;
  }
  let raw: string | null;
  try {
    raw = store.getItem(deviceKey(name));
  } catch {
    return undefined;
  }
  if (raw === null) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    dropDeviceRecord(name);
    return undefined;
  }

  if (isRecord(parsed) && typeof parsed.v === 'number') {
    if (parsed.v !== DEVICE_SCHEMA_VERSION || !('data' in parsed)) {
      // Migration guard: do not touch a schema this build cannot read.
      return undefined;
    }
    const value = normalize(parsed.data);
    if (value === undefined) {
      dropDeviceRecord(name);
    }
    return value;
  }

  const legacy = normalize(parsed);
  if (legacy === undefined) {
    dropDeviceRecord(name);
    return undefined;
  }
  // Migrate in place; a failed write leaves the (readable) legacy payload.
  writeDeviceRecord(name, legacy);
  return legacy;
}

/** Write one record. Returns whether it persisted; never throws. */
export function writeDeviceRecord<T>(name: string, data: T): boolean {
  const store = storage();
  if (store === null) {
    return false;
  }
  try {
    const envelope: DeviceEnvelope = { v: DEVICE_SCHEMA_VERSION, data };
    store.setItem(deviceKey(name), JSON.stringify(envelope));
    return true;
  } catch {
    // Quota exceeded or private mode: the caller decides how to report it.
    return false;
  }
}

/** Drop one record. Returns whether a key was removed; never throws. */
export function dropDeviceRecord(name: string): boolean {
  const store = storage();
  if (store === null) {
    return false;
  }
  try {
    store.removeItem(deviceKey(name));
    return true;
  } catch {
    return false;
  }
}
