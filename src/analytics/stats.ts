/**
 * Pure statistical primitives over plain number arrays.
 *
 * Deliberately knows nothing about Readings or buckets so it can be tested in
 * isolation and reused by the bucketizer, the KPI rollup, and the detector.
 *
 * Empty input yields 0 rather than NaN or null, so every JSON payload stays
 * numeric and the Dashboard never has to guard a chart against NaN. Callers
 * distinguish "no data" from "genuinely zero" using {@link count}.
 */

/** Number of samples. */
export function count(values: readonly number[]): number {
  return values.length;
}

/** Sum of all samples; 0 when empty. */
export function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** Arithmetic mean; 0 when empty. */
export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return sum(values) / values.length;
}

/** Alias of {@link mean}, matching the `avg` field name in the bucket schema. */
export function avg(values: readonly number[]): number {
  return mean(values);
}

/** Smallest sample; 0 when empty. */
export function min(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((lowest, value) => (value < lowest ? value : lowest), values[0] as number);
}

/** Largest sample; 0 when empty. */
export function max(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((highest, value) => (value > highest ? value : highest), values[0] as number);
}

/**
 * Nearest-rank percentile: the smallest sample at or above the requested rank.
 * Chosen over interpolation because it always returns a value that was actually
 * observed, which is what an operator expects from a "95th percentile reading".
 *
 * @param fraction percentile in the range 0..1
 */
export function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const clamped = Math.min(Math.max(fraction, 0), 1);
  const rank = Math.max(1, Math.ceil(clamped * sorted.length));
  return sorted[rank - 1] as number;
}

/** 95th percentile, nearest-rank. */
export function p95(values: readonly number[]): number {
  return percentile(values, 0.95);
}

/** Population variance; 0 when empty. */
export function variance(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const average = mean(values);
  return mean(values.map((value) => (value - average) ** 2));
}

/**
 * Population standard deviation.
 *
 * Population rather than sample: the rolling window IS the population the
 * detector compares against, and it avoids a divide-by-zero at n = 1.
 */
export function stddev(values: readonly number[]): number {
  return Math.sqrt(variance(values));
}
