<!-- generated:start cap:glossary-intro -->
# System Intent & Glossary

The overall outcome this system exists to achieve, the canonical component names projected from the architecture canvas, and the authoritative business vocabulary. Treat these terms as carrying their defined meaning throughout the project.
<!-- generated:end cap:glossary-intro -->



<!-- generated:start cap:components-heading -->
## Components

Canonical component names projected from the architecture canvas.
<!-- generated:end cap:components-heading -->

<!-- generated:start comp:analytics-api -->
- **Analytics API** (`analytics-api`) — backend component. Ingests Readings from the Telemetry Generator into an in-memory Ring Buffer holding the last 60 minutes (no persistence beyond this window). Computes live analytics — KPIs, time-series Buckets (10s/1m/5m: avg/min/max/p95/count by metric, optionally by device or site), Device Health (online<5s / stale<30s / offline), and Anomaly detection (readings beyond k standard deviations, default k=3, of a rolling per-device+metric window). Serves the Dashboard over REST plus an SSE live stream. Degrades gracefully: when the generator connection is down it keeps serving whatever the ring buffer holds and sets stale:true on all responses.
<!-- generated:end comp:analytics-api -->

<!-- generated:start comp:test-object -->
- **Test Object** (`test-object`) — backend component.
<!-- generated:end comp:test-object -->
