# Recorded MOTIS fixtures

Every JSON file here is a verbatim response body captured from the live NCR
MOTIS build running in the `biyahey-routing-1` container
(`http://localhost:8080`) on 2026-11-01, with the real merged GTFS
(486 routes / 159,408 trips / 4,576 stops). They are recorded data, not
hand-edited examples; unit tests run offline against them through the
`motisFetch` slot that `buildApp({ motisFetch })` injects.

| File | Request | Captured |
| --- | --- | --- |
| `motis-plan-cubao-ayala.json` | `GET /api/v6/plan?fromPlace=14.619,121.053&toPlace=14.554,121.024&time=2026-11-02T08:00:00+08:00` | 2026-11-01 |
| `motis-plan-walk-only.json` | `GET /api/v6/plan?fromPlace=14.619,121.053&toPlace=14.6180,121.0540&time=2026-11-02T08:00:00+08:00` | 2026-11-01 |
| `motis-geocode-cubao.json` | `GET /api/v1/geocode?text=Cubao` | 2026-11-01 |
| `motis-geocode-quezon-city.json` | `GET /api/v1/geocode?text=Quezon%20City` | 2026-11-01 |

Recorded with:

```powershell
curl.exe -s -o services/api/test/fixtures/motis-plan-cubao-ayala.json `
  'http://localhost:8080/api/v6/plan?fromPlace=14.619%2C121.053&toPlace=14.554%2C121.024&time=2026-11-02T08%3A00%3A00%2B08%3A00'
curl.exe -s -o services/api/test/fixtures/motis-plan-walk-only.json `
  'http://localhost:8080/api/v6/plan?fromPlace=14.619%2C121.053&toPlace=14.6180%2C121.0540&time=2026-11-02T08%3A00%3A00%2B08%3A00'
curl.exe -s -o services/api/test/fixtures/motis-geocode-cubao.json `
  'http://localhost:8080/api/v1/geocode?text=Cubao'
curl.exe -s -o services/api/test/fixtures/motis-geocode-quezon-city.json `
  'http://localhost:8080/api/v1/geocode?text=Quezon%20City'
```

Notes:

- The short Cubao trip comes back in MOTIS's top-level `direct` array with an
  empty `itineraries` array; the mapper includes all-walk direct options so a
  walkable trip still produces an itinerary.
- MOTIS geometry carries `precision: 6` (metres moved are encoded at 1e-6
  degrees), so the polyline decoder must use that field rather than assuming
  Google's default 5.
- `numItineraries` was probed against this build on 2026-11-01: the parameter
  is ignored (default and `numItineraries=1`/`5` all returned the same 10
  itineraries), and no OpenAPI document is served (`/openapi.yaml`,
  `/api/openapi.yaml`, `/openapi.json` and `/docs` all return 404). The adapter
  therefore never sends `numItineraries`; it widens the search with extra plan
  calls instead.
