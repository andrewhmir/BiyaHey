#!/usr/bin/env node
/**
 * MOTIS routing smoke test for BiyaHey!.
 *
 * Exits non-zero unless:
 *   1. GET /api/v1/geocode?text=Cubao returns at least one result, and
 *   2. GET /api/v6/plan Cubao (14.619,121.053) -> Ayala (14.554,121.024) at a
 *      fixed 2026-11-02T08:00:00+08:00 returns at least one itinerary with a
 *      non-WALK leg.
 *
 * Override the endpoint with MOTIS_URL (default http://localhost:8080).
 */

const base = (process.env.MOTIS_URL ?? 'http://localhost:8080').replace(/\/+$/, '');
const GEOCODE_TEXT = 'Cubao';
const FROM_PLACE = '14.619,121.053';
const TO_PLACE = '14.554,121.024';
const DEPARTURE = '2026-11-02T08:00:00+08:00';
const REQUEST_TIMEOUT_MS = Number(process.env.MOTIS_TIMEOUT_MS ?? 30_000);

/**
 * Fetch JSON from a MOTIS endpoint, turning transport/HTTP/parse failures into
 * errors that say which request failed and where.
 */
async function getJson(path, label) {
  const url = `${base}${path}`;
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    const reason = error?.cause?.code ?? error?.message ?? String(error);
    throw new Error(`${label}: cannot reach ${url} (${reason}) — is the routing service up?`);
  }
  if (!response.ok) {
    const body = (await response.text()).slice(0, 300);
    throw new Error(`${label}: HTTP ${response.status} from ${url}: ${body}`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error(`${label}: ${url} did not return JSON`);
  }
}

try {
  const geo = await getJson(
    `/api/v1/geocode?text=${encodeURIComponent(GEOCODE_TEXT)}`,
    'geocode',
  );
  if (!Array.isArray(geo) || geo.length === 0) {
    throw new Error(`geocode returned no results for "${GEOCODE_TEXT}"`);
  }

  const plan = await getJson(
    `/api/v6/plan?fromPlace=${encodeURIComponent(FROM_PLACE)}` +
      `&toPlace=${encodeURIComponent(TO_PLACE)}` +
      `&time=${encodeURIComponent(DEPARTURE)}`,
    'plan',
  );
  const itineraries = Array.isArray(plan?.itineraries) ? plan.itineraries : [];
  const transit = itineraries.filter(
    (itinerary) =>
      Array.isArray(itinerary.legs) && itinerary.legs.some((leg) => leg.mode !== 'WALK'),
  );
  if (transit.length === 0) {
    throw new Error(
      `plan returned ${itineraries.length} itineraries but none with a non-WALK leg ` +
        `(${FROM_PLACE} -> ${TO_PLACE} at ${DEPARTURE})`,
    );
  }

  console.log(`geocode: ${geo.length} result(s) for "${GEOCODE_TEXT}"`);
  console.log(
    `plan: ${itineraries.length} itinerary/itineraries, ${transit.length} with a transit leg ` +
      `(${FROM_PLACE} -> ${TO_PLACE} at ${DEPARTURE})`,
  );
  console.log(`ok: ${geo.length} geocode hits, ${transit.length} transit itineraries`);
} catch (error) {
  console.error(`motis-smoke: FAIL: ${error.message}`);
  process.exitCode = 1;
}
