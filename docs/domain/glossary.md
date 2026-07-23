<!-- generated:start cap:glossary-intro -->
# System Intent & Glossary

The overall outcome this system exists to achieve, the canonical component names projected from the architecture canvas, and the authoritative business vocabulary. Treat these terms as carrying their defined meaning throughout the project.
<!-- generated:end cap:glossary-intro -->

<!-- generated:start cap:system-intent -->
## System Intent

Provide a live analytics dashboard for IoT sensor telemetry: synthesize device readings, ingest and aggregate them in real time (KPIs, time-series, device health, anomalies), and render them to operators — staying live over streaming connections and degrading gracefully when a dependency is unreachable.
<!-- generated:end cap:system-intent -->

<!-- generated:start cap:definitions -->
## Definitions

Authoritative business terms for this system.

### Anomaly

A reading that lies beyond k standard deviations (default k=3) of a rolling window for its device+metric. Deliberately injected as spikes by the generator so the backend has something to detect.

### Bucket

A time window (10s / 1m / 5m) into which readings are grouped for per-bucket statistics (avg, min, max, p95, count) by metric and optionally by device or site.

### Device

A simulated IoT sensor unit belonging to a site. The fleet is 12 devices across 3 sites (site-north, site-central, site-south), each emitting temperature, humidity, and power_draw metrics.

### Device Health

A device's liveness derived from last-seen age: online (< 5s), stale (< 30s), offline (otherwise). Dropouts injected by the generator drive devices stale then offline.

### Reading

A single sensor measurement emitted by a device: { id, deviceId, siteId, metric, value, unit, ts }. Metric is one of temperature (C), humidity (%), or power_draw (W).

### Ring Buffer

The backend's in-memory store holding the last 60 minutes of readings; evicts anything past that horizon. No persistence beyond this window.

### Stale

A response flag (stale: true) the backend sets on all responses when its connection to the generator is down; it keeps serving whatever the ring buffer holds. Distinct from the dashboard's own SSE-disconnected state.
<!-- generated:end cap:definitions -->

<!-- generated:start cap:components-heading -->
## Components

Canonical component names projected from the architecture canvas.
<!-- generated:end cap:components-heading -->

<!-- generated:start comp:telemetry-generator -->
- **Telemetry Generator** (`telemetry-generator`) — backend component. Synthesizes IoT sensor telemetry for a fixed fleet of 12 Devices across 3 sites (site-north, site-central, site-south), each emitting temperature (C), humidity (%), and power_draw (W) Readings. Deliberately injects Anomaly spikes (out-of-band values) so the backend has something to detect, and injects Device dropouts so devices transition online → stale → offline. Exposes a streaming endpoint the Analytics API consumes. Owns the source of truth for what a Reading looks like; has no inbound dependencies.
<!-- generated:end comp:telemetry-generator -->
