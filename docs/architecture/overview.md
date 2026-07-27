<!-- generated:start cap:overview-intro -->
> These architecture docs are **not verified at the current commit** (no full drift sweep has run yet). Treat them as a snapshot and verify against source before relying on them.

# Architecture Overview

2 component(s) declared on the architecture canvas. Topology: [system-map.md](system-map.md).
<!-- generated:end cap:overview-intro -->

<!-- generated:start comp:analytics-api -->
> **Not verified at the current commit** — source has changed since the last full sweep, or none has run. Treat this section as a snapshot and verify against source before relying on it.
## Analytics API (`analytics-api`, BACKEND)

Ingests Readings from the Telemetry Generator into an in-memory Ring Buffer holding the last 60 minutes (no persistence beyond this window). Computes live analytics — KPIs, time-series Buckets (10s/1m/5m: avg/min/max/p95/count by metric, optionally by device or site), Device Health (online<5s / stale<30s / offline), and Anomaly detection (readings beyond k standard deviations, default k=3, of a rolling per-device+metric window). Serves the Dashboard over REST plus an SSE live stream. Degrades gracefully: when the generator connection is down it keeps serving whatever the ring buffer holds and sets stale:true on all responses.

**Tech:** ["Node.js", "TypeScript", "Express (REST + SSE)", "Vitest"]
<!-- generated:end comp:analytics-api -->

<!-- generated:start comp:test-object -->
> **Not verified at the current commit** — source has changed since the last full sweep, or none has run. Treat this section as a snapshot and verify against source before relying on it.
## Test Object (`test-object`, BACKEND)
<!-- generated:end comp:test-object -->
