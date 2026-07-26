/**
 * Bucketizer — turns raw Readings into the time-series rows the Dashboard plots.
 *
 * Windows are aligned to the epoch rather than to the first reading seen, so the
 * same wall-clock instant always lands in the same bucket regardless of when the
 * service started or which subset of readings is being aggregated.
 */
import type { Metric, Reading } from '../domain/reading.js';
import { BUCKET_DURATIONS_MS, type Bucket, type BucketSize, type GroupBy } from '../domain/types.js';
import { avg, max, min, p95 } from './stats.js';

export interface BucketizeOptions {
  bucket: BucketSize;
  /** Split rows per device, per site, or not at all. Defaults to `none`. */
  groupBy?: GroupBy;
}

/** Accumulator for one (window, metric, group) cell before it becomes a Bucket. */
interface Cell {
  windowStart: number;
  metric: Metric;
  deviceId?: string;
  siteId?: string;
  values: number[];
}

/** Round to 4 decimals so floating-point noise never reaches the wire. */
function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/** Start of the epoch-aligned window containing `ts`. */
export function alignToBucket(ts: number, durationMs: number): number {
  return Math.floor(ts / durationMs) * durationMs;
}

/** The grouping dimension's value for a reading, or undefined when ungrouped. */
function groupValue(reading: Reading, groupBy: GroupBy): string | undefined {
  if (groupBy === 'device') return reading.deviceId;
  if (groupBy === 'site') return reading.siteId;
  return undefined;
}

/** Build the accumulator for a reading's cell, carrying only the grouping key. */
function newCell(reading: Reading, windowStart: number, groupBy: GroupBy): Cell {
  const cell: Cell = { windowStart, metric: reading.metric, values: [] };
  if (groupBy === 'device') cell.deviceId = reading.deviceId;
  if (groupBy === 'site') cell.siteId = reading.siteId;
  return cell;
}

/** Collapse an accumulator into the declared bucket row shape. */
function toBucket(cell: Cell): Bucket {
  const bucket: Bucket = {
    windowStart: cell.windowStart,
    metric: cell.metric,
    avg: round(avg(cell.values)),
    min: round(min(cell.values)),
    max: round(max(cell.values)),
    p95: round(p95(cell.values)),
    count: cell.values.length,
  };
  if (cell.deviceId !== undefined) bucket.deviceId = cell.deviceId;
  if (cell.siteId !== undefined) bucket.siteId = cell.siteId;
  return bucket;
}

/** Stable ordering: oldest window first, then metric, then grouping key. */
function compareBuckets(a: Bucket, b: Bucket): number {
  if (a.windowStart !== b.windowStart) return a.windowStart - b.windowStart;
  if (a.metric !== b.metric) return a.metric.localeCompare(b.metric);
  const keyA = a.deviceId ?? a.siteId ?? '';
  const keyB = b.deviceId ?? b.siteId ?? '';
  return keyA.localeCompare(keyB);
}

/**
 * Aggregate readings into buckets.
 *
 * Only windows that actually contain readings produce rows — gaps stay absent
 * rather than becoming zero-count buckets, so a device dropout reads as missing
 * data on the chart instead of a spike down to zero.
 */
export function bucketize(readings: readonly Reading[], options: BucketizeOptions): Bucket[] {
  const durationMs = BUCKET_DURATIONS_MS[options.bucket];
  const groupBy = options.groupBy ?? 'none';
  const cells = new Map<string, Cell>();
  for (const reading of readings) {
    const windowStart = alignToBucket(reading.ts, durationMs);
    const key = `${windowStart}|${reading.metric}|${groupValue(reading, groupBy) ?? ''}`;
    const cell = cells.get(key) ?? newCell(reading, windowStart, groupBy);
    cell.values.push(reading.value);
    cells.set(key, cell);
  }
  return [...cells.values()].map(toBucket).sort(compareBuckets);
}

/**
 * The newest bucket for each metric — what an `update` frame carries so the
 * Dashboard can append one point per metric per tick.
 */
export function latestBucketPerMetric(buckets: readonly Bucket[]): Bucket[] {
  const newest = new Map<Metric, Bucket>();
  for (const bucket of buckets) {
    const current = newest.get(bucket.metric);
    if (!current || bucket.windowStart > current.windowStart) newest.set(bucket.metric, bucket);
  }
  return [...newest.values()].sort((a, b) => a.metric.localeCompare(b.metric));
}
