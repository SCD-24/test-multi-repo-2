/**
 * Fleet-wide KPI rollup over everything currently retained in the Ring Buffer.
 *
 * Pure over its inputs so the same function serves both GET /api/kpis and the
 * `update` frame, with no hidden dependency on the store or the clock.
 */
import type { Metric, Reading } from '../domain/reading.js';
import { METRICS } from '../domain/reading.js';
import type { DeviceHealth, Kpis, MetricSummary } from '../domain/types.js';
import { avg, max, min, p95 } from './stats.js';
import { countActive } from './deviceHealth.js';

/** Round to 4 decimals so floating-point noise never reaches the wire. */
function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/** Summarise one metric across every retained reading for it. */
function summariseMetric(metric: Metric, values: number[]): MetricSummary {
  return {
    metric,
    avg: round(avg(values)),
    min: round(min(values)),
    max: round(max(values)),
    p95: round(p95(values)),
    count: values.length,
  };
}

/** Bucket raw values by metric in one pass over the readings. */
function valuesByMetric(readings: readonly Reading[]): Map<Metric, number[]> {
  const grouped = new Map<Metric, number[]>(METRICS.map((metric) => [metric, [] as number[]]));
  for (const reading of readings) {
    grouped.get(reading.metric)?.push(reading.value);
  }
  return grouped;
}

export interface KpiInput {
  readings: readonly Reading[];
  devices: readonly DeviceHealth[];
  anomalyCount: number;
  windowMs: number;
}

/**
 * Build the headline numbers.
 *
 * Every declared metric appears in `byMetric` even when it has no readings, so
 * the Dashboard renders a stable set of tiles instead of ones that pop in and
 * out as data arrives.
 */
export function buildKpis(input: KpiInput): Kpis {
  const grouped = valuesByMetric(input.readings);
  return {
    windowMs: input.windowMs,
    totalReadings: input.readings.length,
    deviceCount: input.devices.length,
    activeDevices: countActive(input.devices),
    anomalyCount: input.anomalyCount,
    byMetric: METRICS.map((metric) => summariseMetric(metric, grouped.get(metric) ?? [])),
  };
}
