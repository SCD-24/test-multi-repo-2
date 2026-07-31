# new-test2

**The Analytics API has moved.** Its source, tests, tsconfig, vitest config and `.env.example`
were migrated to the **`new-test3`** repo, where the service lives under `server/` alongside the
Dashboard. Nothing runnable remains here.

| Looking for | Now at |
| --- | --- |
| `src/**`, `test/**` | `new-test3` → `server/src/**`, `server/test/**` |
| `GENERATOR_URL`, `PORT`, `RING_WINDOW_MS`, `ANOMALY_K`, `CORS_ORIGIN` | `new-test3` → `.env.example` |
| `npm run dev` (API on :4002) | `new-test3` → `npm run dev:server` |
| `npm test` for the API | `new-test3` → `npm test` (runs the `analytics-api` vitest project) |

The pipeline is unchanged in behaviour — Telemetry Generator (`new-test1`, :4001) → Analytics API
(`new-test3` `server/`, :4002) → Dashboard (`new-test3`, :5173). The API and the Dashboard are
still two separate processes talking cross-origin; sharing a repo did not merge them.

The only component still declared on this repo's canvas is the `test-object` stub, which has no
source.
