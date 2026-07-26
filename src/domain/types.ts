/**
 * Analytics shapes served to the Dashboard.
 *
 * These mirror the `schema` widget declared for this component on the
 * architecture canvas: bucket rows, device health rows, and anomaly rows.
 */
import type { Metric, Reading } from './reading.js';

/** Bucket widths the API supports, per the glossary. */
export const BUCKET_SIZES = ['10s', '1m', '5m'] as const;

export type BucketSize = (typeof BUCKET_SIZES)[number];

/** Bucket width in milliseconds — buckets are aligned to the epoch. */
export const BUCKET_DURATIONS_MS: Record<BucketSize, number> = {
  '10s': 10_000,
  '1m': 60_000,
  '5m': 300_000,
};

/** How time-series rows are split apart. */
export const GROUP_BY_OPTIONS = ['none', 'device', 'site'] as const;

export type GroupBy = (typeof GROUP_BY_OPTIONS)[number];

/** Liveness of a device, derived from how long ago it was last seen. */
export type DeviceStatus = 'online' | 'stale' | 'offline';

/** Per-bucket statistics for one metric, optionally narrowed to a device or site. */
export interface Bucket {
  windowStart: number;
  metric: Metric;
  avg: number;
  min: number;
  max: number;
  p95: number;
  count: number;
  deviceId?: string;
  siteId?: string;
}

/** A device's liveness at a point in time. */
export interface DeviceHealth {
  deviceId: string;
  siteId: string;
  status: DeviceStatus;
  lastSeenTs: number;
  ageMs: number;
}

/** A reading that fell outside k standard deviations of its rolling window. */
export interface AnomalyRecord {
  reading: Reading;
  zScore: number;
  detectedTs: number;
}

/** Summary statistics for one metric across the whole retained window. */
export interface MetricSummary {
  metric: Metric;
  avg: number;
  min: number;
  max: number;
  p95: number;
  count: number;
}

/** Fleet-wide headline numbers. */
export interface Kpis {
  windowMs: number;
  totalReadings: number;
  deviceCount: number;
  activeDevices: number;
  anomalyCount: number;
  byMetric: MetricSummary[];
}

/** The full payload carried by every `update` frame on GET /api/stream. */
export interface Snapshot {
  generatedTs: number;
  stale: boolean;
  kpis: Kpis;
  latestBuckets: Bucket[];
  devices: DeviceHealth[];
  anomalies: AnomalyRecord[];
}

/**
 * Every REST response is wrapped so the Dashboard can always tell whether the
 * data it just received is current or is being served from a buffer whose feed
 * has gone away.
 */
export interface StaleEnvelope<T> {
  stale: boolean;
  data: T;
}
