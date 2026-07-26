/**
 * Query-parameter validation for the REST routes.
 *
 * Every parser rejects with a message naming the parameter and the accepted
 * values, because the Dashboard is not the only possible caller and a silent
 * fallback to a default would hide a genuine client bug behind plausible data.
 */
import { METRICS, isMetric, type Metric } from '../domain/reading.js';
import { BUCKET_SIZES, GROUP_BY_OPTIONS, type BucketSize, type GroupBy } from '../domain/types.js';

/** Signals a 400: the caller sent something we will not guess the meaning of. */
export class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadRequestError';
  }
}

/** Express gives string | string[] | object; only a lone string is usable. */
function scalar(raw: unknown, name: string): string | undefined {
  if (raw === undefined) return undefined;
  if (Array.isArray(raw)) {
    throw new BadRequestError(`${name} must be given at most once`);
  }
  if (typeof raw !== 'string') {
    throw new BadRequestError(`${name} must be a string`);
  }
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

export function optionalMetric(raw: unknown, name = 'metric'): Metric | undefined {
  const value = scalar(raw, name);
  if (value === undefined) return undefined;
  if (!isMetric(value)) {
    throw new BadRequestError(`${name} must be one of ${METRICS.join(', ')}`);
  }
  return value;
}

export function requireMetric(raw: unknown, name = 'metric'): Metric {
  const value = optionalMetric(raw, name);
  if (value === undefined) throw new BadRequestError(`${name} is required`);
  return value;
}

export function requireBucket(raw: unknown, name = 'bucket'): BucketSize {
  const value = scalar(raw, name);
  if (value === undefined) throw new BadRequestError(`${name} is required`);
  if (!(BUCKET_SIZES as readonly string[]).includes(value)) {
    throw new BadRequestError(`${name} must be one of ${BUCKET_SIZES.join(', ')}`);
  }
  return value as BucketSize;
}

export function optionalGroupBy(raw: unknown, name = 'groupBy'): GroupBy {
  const value = scalar(raw, name);
  if (value === undefined) return 'none';
  if (!(GROUP_BY_OPTIONS as readonly string[]).includes(value)) {
    throw new BadRequestError(`${name} must be one of ${GROUP_BY_OPTIONS.join(', ')}`);
  }
  return value as GroupBy;
}

/** Epoch-millisecond bound. */
export function optionalTimestamp(raw: unknown, name: string): number | undefined {
  const value = scalar(raw, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    throw new BadRequestError(`${name} must be an epoch timestamp in milliseconds`);
  }
  return parsed;
}

export function optionalId(raw: unknown, name: string): string | undefined {
  return scalar(raw, name);
}

/** Positive row cap, bounded so one caller cannot ask for unbounded work. */
export function optionalLimit(raw: unknown, name = 'limit', max = 1_000): number | undefined {
  const value = scalar(raw, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new BadRequestError(`${name} must be an integer between 1 and ${max}`);
  }
  return parsed;
}

/** Reject a range that can never match, rather than silently returning none. */
export function assertRange(from: number | undefined, to: number | undefined): void {
  if (from !== undefined && to !== undefined && from > to) {
    throw new BadRequestError('from must be less than or equal to to');
  }
}
