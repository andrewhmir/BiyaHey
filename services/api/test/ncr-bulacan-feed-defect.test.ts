import { describe, expect, it } from 'vitest';
import type { ItineraryDto } from '@biyahey/shared';
import {
  MAX_TRANSIT_SPEED_KMH,
  implausibleTransitLegs,
  isPlausibleItinerary,
  mapPlanItineraries,
  type MapContext,
} from '../src/routing/map-itinerary.js';

/**
 * Task 6B evidence: the NCR -> Bulacan BFF-side zero is a FEED defect.
 *
 * Every number and polyline below is copied from a real MOTIS 2.11.4
 * `GET /api/v6/plan` payload for Cubao (14.6194, 121.0531) -> Meycauayan,
 * Bulacan (14.7360, 120.9600), captured 2026-11-04 against the NCR graph built
 * from `data/build/gtfs/gtfs.zip`. The payload is not committed (888 KB); the
 * legs that decide the ruling are embedded here.
 *
 * The guard is right in both cases, so it must not be relaxed:
 *  - `rail-1`'s shape starts 3,016 m from its first stop, so MOTIS's leg
 *    geometry prepends that jump: 8,553 m in 180 s = 171 km/h.
 *  - `jeep-t165` has a two-vertex straight-line shape and a 2-minute
 *    synthesized timetable: 8,194 m in 120 s = 246 km/h.
 * The feed fix (Lane A) is to trim/repair the rail shapes and to stop
 * scheduling every consecutive stop pair two minutes apart. With the rail shape
 * trimmed to the real track (the last assertion below), the same 3-minute leg
 * is 2,424 m = 48 km/h and the itinerary passes untouched.
 */
const context: MapContext = {
  freeRideRouteIds: new Set<string>(),
  curatedLandmarks: new Map<string, readonly string[]>(),
  curatedRouteIds: new Set<string>(),
};

/** Real leg geometry, precision 6: Balintawak -> Yamaha Monumento (8,553 m). */
const LRT1_CORRUPT_SHAPE = "{wr}Zy~mxeFroEsiu@uv@zb@aFpCeKpGwF`DqDvBwCpBqBxBwBrCyBnEkAtCeAhDoAtEm@hDaT~{AcKdnBkDtXqa@hxC}AxKyObhAaDxXcAxKmGjz@G~@gAdPKjFQ~Q|DlyKLzUJb_@vBxaF|AtiDXls@t@foB@fA`BpqHhFlyNnDhhId@tKb@hEt@rFnBxIlBjFzCxFjDzElCvBjChBjB`ArErBpErAzEjAbJfAvo@PpKBfGBzAJxBb@dCPh~@jA";
/** Same trip, shape sliced from the Balintawak stop instead of the 3,016 m spur. */
const LRT1_CORRECTED_SHAPE = "{wr}Zy~mxeF@fA`BpqHhFlyNnDhhId@tKb@hEt@rFnBxIlBjFzCxFjDzElCvBjChBjB`ArErBpErAzEjAbJfAvo@PpKBfGBzAJxBb@dCPh~@jA";
/** Real leg geometry: Malinta -> Meycauayan Poblacion (5,177 m, 226 vertices). */
const BUS_35_SHAPE = "mqw_[_ndveFqBeAvB|MlCnQfBhJvCvNBjDIzFYfEm@lBoAzDsBfEcAbA{A~AgF|EkAbAiAv@wInDaHvAcGf@aIEcb@cBkDoC}Lc@mCGyBKwFUsT_A}ScAgAC{CMkFAmCLaDN_LrB_D|@kCr@sDx@wq@vO}A^_Cf@q[~GgNvCqCr@aPtDkLnC_Dn@{Bb@qB`@wTdFkDv@}_@lI_T|E{Bb@qATcCh@oPvDoJvB{Bb@wBb@qKzBaJrBgEx@]HiJnB_@H}RpEgb@rJkCl@oMpC}dBh_@kCn@qTvE}j@dMqUhFyf@pK}JrBuHfBkN|CqIlBgObD_IfBiSnEyInBc@JsK`CgCl@uZ|GeDt@qOhDwEdA_IfB_Cd@ODuAXgCh@eH~AaK|B_t@fOiJtBeCn@oNrCkCh@kFhAcu@zOc_@rIyJ|BeE`AoB^wA^{Ch@}GtAkMlC}@PaJpBcFbA}]vHwEhAgM|C_UnF}K`DaHpAkHzAyFlAmDx@aE~@sJxB_IjBqLlCeATSFgYfG_IfB}QdEiB`@WDsBViKfBmCXiD\\wEReA?_CQ{E_@cFm@sEi@aHqA}K_Du@WaCy@yHoDgCiAoI_EyJkEkLeFsCoAqCmAoB}@qXyMyHgD}A{@eDNiEiBcD}AkD{DsIeE_CgAoAs@kDeBgBeA{T_MuU{JaDwAmCaAsLwDkQwEuDaAwS{FkC{@aAYkUoGwRkFwa@_L}IcCyc@{LeJeCaD{@cBe@uJmCmBi@}EqAuMqDyCy@aL}CaD{@{CiAeFqAsU}GcTaGcJqAuB[mLi@gEOqCGyACqLOux@_@gQQwTSgb@KsoAy@ao@w@{h@g@g\\_@wQAqLEsLMiIUeCH{LQuXAmCHoBXaKlA_Fj@KjD";
/** The whole `jeep-t165` shape as published: two vertices, 8,194 m apart. */
const JEEP_T165_SHAPE = "{wr}Zy~mxeFa`}B_zfA";

interface RawLegSpec {
  routeId: string;
  motisMode: 'SUBWAY' | 'BUS';
  from: { name: string; stopId: string; lat: number; lon: number };
  to: { name: string; stopId: string; lat: number; lon: number };
  startTime: string;
  endTime: string;
  durationSeconds: number;
  geometry: string;
}

function rawLeg(spec: RawLegSpec): Record<string, unknown> {
  // MOTIS emits no `distance` for transit legs (verified on all 9 flagged leg
  // variants), so the geometry is the only distance source the mapper has.
  return {
    mode: spec.motisMode,
    routeId: spec.routeId,
    from: spec.from,
    to: spec.to,
    startTime: spec.startTime,
    endTime: spec.endTime,
    duration: spec.durationSeconds,
    legGeometry: { points: spec.geometry, precision: 6 },
  };
}

function mapOne(spec: RawLegSpec): ItineraryDto | undefined {
  const startTime = spec.startTime;
  const endTime = spec.endTime;
  return mapPlanItineraries(
    { itineraries: [{ duration: spec.durationSeconds, startTime, endTime, legs: [rawLeg(spec)] }] },
    context,
  )[0];
}

const BALINTAWAK = { name: 'Balintawak', stopId: 'gtfs_rail-1:node:5191404470', lat: 14.657422, lon: 121.003517 };
const MONUMENTO = { name: 'Yamaha Monumento', stopId: 'gtfs_rail-1:node:5191404471', lat: 14.653834, lon: 120.983848 };
const MALINTA = { name: 'Malinta', stopId: 'gtfs_bus-35:node:10153272521', lat: 14.692647, lon: 120.965872 };
const MEYCAUAYAN = { name: 'Meycauayan Poblacion', stopId: 'gtfs_bus-35:node:13232617183', lat: 14.735402, lon: 120.961266 };

describe('NCR -> Bulacan feed-defect evidence (Task 6B)', () => {
  it('drops the captured LRT-1 leg whose shape starts 3,016 m before Balintawak', () => {
    const itinerary = mapOne({
      routeId: 'gtfs_rail-1',
      motisMode: 'SUBWAY',
      from: BALINTAWAK,
      to: MONUMENTO,
      startTime: '2026-11-05T00:48:00Z',
      endTime: '2026-11-05T00:51:00Z',
      durationSeconds: 180,
      geometry: LRT1_CORRUPT_SHAPE,
    });
    expect(itinerary).toBeDefined();
    // The mapper has no declared distance to fall back to: MOTIS sends none for
    // transit legs, so the shape is the only source and the shape is corrupt.
    expect(itinerary!.legs[0]!.distanceM).toBe(8_553);
    expect(itinerary!.legs[0]!.durationMin).toBe(3);
    const flagged = implausibleTransitLegs(itinerary!);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]!.mode).toBe('lrt1');
    expect(flagged[0]!.impliedSpeedKmh).toBe(171);
    expect(isPlausibleItinerary(itinerary!)).toBe(false);
  });

  it('keeps the same corridor when the shape starts at the boarding stop (2,424 m in 3 min)', () => {
    const itinerary = mapOne({
      routeId: 'gtfs_rail-1',
      motisMode: 'SUBWAY',
      from: BALINTAWAK,
      to: MONUMENTO,
      startTime: '2026-11-05T00:48:00Z',
      endTime: '2026-11-05T00:51:00Z',
      durationSeconds: 180,
      geometry: LRT1_CORRECTED_SHAPE,
    });
    expect(itinerary).toBeDefined();
    expect(itinerary!.legs[0]!.distanceM).toBe(2_424);
    expect(implausibleTransitLegs(itinerary!)).toHaveLength(0);
    expect(isPlausibleItinerary(itinerary!)).toBe(true);
  });

  it('keeps the captured bus-35 Malinta -> Meycauayan last mile (5,177 m in 10 min)', () => {
    const itinerary = mapOne({
      routeId: 'gtfs_bus-35',
      motisMode: 'BUS',
      from: MALINTA,
      to: MEYCAUAYAN,
      startTime: '2026-11-05T00:44:00Z',
      endTime: '2026-11-05T00:54:00Z',
      durationSeconds: 600,
      geometry: BUS_35_SHAPE,
    });
    expect(itinerary).toBeDefined();
    expect(itinerary!.legs[0]!.distanceM).toBe(5_177);
    expect(itinerary!.legs[0]!.durationMin).toBe(10);
    expect(implausibleTransitLegs(itinerary!)).toHaveLength(0);
    expect(isPlausibleItinerary(itinerary!)).toBe(true);
  });

  it('drops the captured two-vertex jeep-t165 leg (8,194 m in 2 min)', () => {
    const itinerary = mapOne({
      routeId: 'gtfs_jeep-t165',
      motisMode: 'BUS',
      from: { name: 'Balintawak Cloverleaf', stopId: 'gtfs_jeep-t165:landmark:0', lat: 14.657422, lon: 121.003517 },
      to: { name: 'Novaliches', stopId: 'gtfs_jeep-t165:landmark:1', lat: 14.721951, lon: 121.040301 },
      startTime: '2026-11-05T00:48:00Z',
      endTime: '2026-11-05T00:50:00Z',
      durationSeconds: 120,
      geometry: JEEP_T165_SHAPE,
    });
    expect(itinerary).toBeDefined();
    expect(itinerary!.legs[0]!.distanceM).toBe(8_194);
    const flagged = implausibleTransitLegs(itinerary!);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]!.impliedSpeedKmh).toBe(246);
    expect(isPlausibleItinerary(itinerary!)).toBe(false);
  });

  it('leaves the 120 km/h gross-defect net untouched', () => {
    expect(MAX_TRANSIT_SPEED_KMH).toBe(120);
  });
});
