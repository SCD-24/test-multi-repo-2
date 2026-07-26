# Analytics API

Consumes the Telemetry Generator's SSE feed, keeps a rolling in-memory window of Readings, and
serves aggregates to the Dashboard over REST plus a live SSE stream. It is the middle of the
pipeline: stateful but not durable — **restarting it discards all history**, and it backfills
nothing on reconnect.

- `GET /api/kpis`, `/api/timeseries`, `/api/devices`, `/api/anomalies` — REST reads, each wrapped
  in a `{ stale, data }` envelope.
- `GET /api/stream` — SSE feed of `update` snapshots for the Dashboard.
- `GET /healthz` — uptime, buffer size, subscriber count, generator connection state.

Configuration lives in [.env.example](.env.example). Architecture docs are under
[docs/architecture/overview.md](docs/architecture/overview.md).

## Local commands

```bash
npm run dev        # tsx watch src/index.ts
npm run build      # tsc -p tsconfig.json
npm start          # node dist/index.js (requires build)
npm test           # vitest run
npm run typecheck  # tsc --noEmit
```

## Running the full pipeline

The three services are separate repositories, started independently, each in its own terminal.

| Order | Service | Repo | Port | Depends on |
| --- | --- | --- | --- | --- |
| 1 | Telemetry Generator | `new-test1` | `4001` | — |
| 2 | Analytics API | `new-test2` | `4002` | generator on `4001` |
| 3 | Dashboard | `new-test3` | `5173` | Analytics API on `4002` |

```bash
# terminal 1 — new-test1
npm run dev                       # serves http://localhost:4001/stream

# terminal 2 — this repo
npm run dev                       # GENERATOR_URL defaults to http://localhost:4001/stream

# terminal 3 — new-test3
npm run dev                       # VITE_ANALYTICS_API_URL defaults to http://localhost:4002
```

### Cross-origin access

The Dashboard is a browser app on `http://localhost:5173` calling this API **directly** — there
is no proxy in front of either service. `CORS_ORIGIN` must therefore name the Dashboard's exact
origin (its default already does). Two notes:

- The origin is compared byte for byte by the browser. A trailing slash or a path makes every
  request fail, so `loadConfig` rejects such values at boot instead of letting them through.
- The allow-origin header is applied both by the REST middleware and by the SSE hub, which writes
  its own response head. If you add a new streaming endpoint, it needs the same treatment.

### Start order and failure modes

Order is a convenience, not a requirement. This service retries the generator forever with
exponential backoff (250 ms → 5 s), so starting it first is fine — it simply reports
`stale: true` until the generator appears.

Two "not live" states are distinct and can occur together:

| Symptom | Meaning |
| --- | --- |
| `stale: true` in a REST/SSE payload | *This service* has lost the generator feed. |
| Dashboard disconnected banner | *The browser* has lost this service. |

### Verifying each hop by hand

```bash
curl -N http://localhost:4001/stream | head -20        # generator frames
curl -s http://localhost:4002/healthz                  # "generatorConnected": true once ingesting
curl -s http://localhost:4002/api/kpis                 # "stale": false with live data
curl -si -H 'Origin: http://localhost:5173' \
     http://localhost:4002/api/kpis | grep -i access-control   # CORS reachable
```
