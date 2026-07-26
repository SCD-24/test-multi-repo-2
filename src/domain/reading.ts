/**
 * The Reading — the one shape this service ingests.
 *
 * The Telemetry Generator owns the source of truth for a Reading; this module
 * mirrors it and, critically, VALIDATES it. Frames arrive over the network from
 * a process we do not control, so nothing is trusted into the ring buffer until
 * it has passed {@link isReading}.
 */

/** The three metrics the fleet reports. */
export const METRICS = ['temperature', 'humidity', 'power_draw'] as const;

export type Metric = (typeof METRICS)[number];

/** Canonical unit per metric, per the glossary. */
export const METRIC_UNITS: Record<Metric, string> = {
  temperature: 'C',
  humidity: '%',
  power_draw: 'W',
};

/** A single sensor measurement emitted by a device. */
export interface Reading {
  id: string;
  deviceId: string;
  siteId: string;
  metric: Metric;
  value: number;
  unit: string;
  ts: number;
}

/** Narrow an unknown value to a known {@link Metric}. */
export function isMetric(value: unknown): value is Metric {
  return typeof value === 'string' && (METRICS as readonly string[]).includes(value);
}

function isNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Identity fields must all be present and non-blank to be addressable. */
function hasValidIdentity(candidate: Record<string, unknown>): boolean {
  return (
    isNonEmptyString(candidate['id']) &&
    isNonEmptyString(candidate['deviceId']) &&
    isNonEmptyString(candidate['siteId'])
  );
}

/**
 * The measurement must be finite (NaN/Infinity would poison every rolling mean
 * and z-score downstream) and carry the unit the glossary defines for its metric.
 */
function hasValidMeasurement(candidate: Record<string, unknown>): boolean {
  const metric = candidate['metric'];
  if (!isMetric(metric)) return false;
  const value = candidate['value'];
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  return candidate['unit'] === METRIC_UNITS[metric];
}

/** Timestamps drive eviction and health; a non-finite one would break both. */
function hasValidTimestamp(candidate: Record<string, unknown>): boolean {
  const ts = candidate['ts'];
  return typeof ts === 'number' && Number.isFinite(ts) && ts > 0;
}

/** Type guard rejecting any inbound frame that is not a well-formed Reading. */
export function isReading(candidate: unknown): candidate is Reading {
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    return false;
  }
  const record = candidate as Record<string, unknown>;
  return hasValidIdentity(record) && hasValidMeasurement(record) && hasValidTimestamp(record);
}
