<!-- generated:start cap:overview-intro -->
> These architecture docs are **not verified at the current commit** (no full drift sweep has run yet). Treat them as a snapshot and verify against source before relying on them.

# Architecture Overview

1 component(s) declared on the architecture canvas. Topology: [system-map.md](system-map.md).
<!-- generated:end cap:overview-intro -->

<!-- generated:start comp:telemetry-generator -->
> **Not verified at the current commit** — source has changed since the last full sweep, or none has run. Treat this section as a snapshot and verify against source before relying on it.
## Telemetry Generator (`telemetry-generator`, BACKEND)

Synthesizes IoT sensor telemetry for a fixed fleet of 12 Devices across 3 sites (site-north, site-central, site-south), each emitting temperature (C), humidity (%), and power_draw (W) Readings. Deliberately injects Anomaly spikes (out-of-band values) so the backend has something to detect, and injects Device dropouts so devices transition online → stale → offline. Exposes a streaming endpoint the Analytics API consumes. Owns the source of truth for what a Reading looks like; has no inbound dependencies.

**Tech:** ["Node.js", "TypeScript", "Express (HTTP + SSE)", "Vitest"]
<!-- generated:end comp:telemetry-generator -->
