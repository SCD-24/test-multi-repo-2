import { describe, expect, it } from 'vitest';
import { alignToBucket, bucketize, latestBucketPerMetric } from '../../src/analytics/buckets.js';
import { METRIC_UNITS, type Metric, type Reading } from '../../src/domain/reading.js';

/**
 * An exact 5-minute boundary (1700000100000 = 5666667 * 300000), and therefore
 * also an exact 1-minute and 10-second boundary. Window alignment is only
 * unambiguous in assertions if the fixture epoch divides every bucket width.
 */
const T0 = 1_700_000_100_000;

let seq = 0;

function reading(ts: number, value: number, overrides: Partial<Reading> = {}): Reading {
  const metric: Metric = overrides.metric ?? 'temperature';
  return {
    id: `r-${++seq}`,
    deviceId: 'dev-01',
    siteId: 'site-north',
    metric,
    value,
    unit: METRIC_UNITS[metric],
    ts,
    ...overrides,
  };
}

describe('alignToBucket', () => {
  it('floors a timestamp to its window start', () => {
    expect(alignToBucket(T0 + 7_999, 10_000)).toBe(T0);
    expect(alignToBucket(T0 + 10_001, 10_000)).toBe(T0 + 10_000);
  });

  it('leaves an exact boundary untouched', () => {
    expect(alignToBucket(T0, 10_000)).toBe(T0);
  });

  it('aligns to the epoch, not to the first sample', () => {
    expect(alignToBucket(60_123, 60_000)).toBe(60_000);
    expect(alignToBucket(300_001, 300_000)).toBe(300_000);
  });
});

describe('bucketize', () => {
  it('returns no rows for no readings', () => {
    expect(bucketize([], { bucket: '10s' })).toEqual([]);
  });

  it('aggregates one window into one row with the declared shape', () => {
    const rows = bucketize([reading(T0, 10), reading(T0 + 1_000, 20)], { bucket: '10s' });
    expect(rows).toEqual([
      { windowStart: T0, metric: 'temperature', avg: 15, min: 10, max: 20, p95: 20, count: 2 },
    ]);
  });

  it('splits readings across adjacent windows', () => {
    const rows = bucketize([reading(T0 + 9_999, 1), reading(T0 + 10_000, 2)], { bucket: '10s' });
    expect(rows.map((r) => r.windowStart)).toEqual([T0, T0 + 10_000]);
    expect(rows.map((r) => r.count)).toEqual([1, 1]);
  });

  it('places a reading exactly on a boundary in the later window', () => {
    const rows = bucketize([reading(T0 + 60_000, 5)], { bucket: '1m' });
    expect(rows[0]?.windowStart).toBe(T0 + 60_000);
  });

  it('honours each bucket width', () => {
    const readings = [reading(T0, 1), reading(T0 + 70_000, 2), reading(T0 + 140_000, 3)];
    expect(bucketize(readings, { bucket: '10s' })).toHaveLength(3);
    expect(bucketize(readings, { bucket: '1m' })).toHaveLength(3);
    expect(bucketize(readings, { bucket: '5m' })).toHaveLength(1);
  });

  it('emits no rows for windows that contain no readings', () => {
    const rows = bucketize([reading(T0, 1), reading(T0 + 50_000, 2)], { bucket: '10s' });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.windowStart)).toEqual([T0, T0 + 50_000]);
  });

  it('keeps metrics in separate rows within the same window', () => {
    const rows = bucketize(
      [reading(T0, 20), reading(T0 + 1, 55, { metric: 'humidity' })],
      { bucket: '10s' },
    );
    expect(rows.map((r) => r.metric)).toEqual(['humidity', 'temperature']);
  });

  it('rounds floating-point noise out of the average', () => {
    const rows = bucketize([reading(T0, 0.1), reading(T0 + 1, 0.2)], { bucket: '10s' });
    expect(rows[0]?.avg).toBe(0.15);
  });

  it('sorts rows oldest window first', () => {
    const rows = bucketize([reading(T0 + 20_000, 3), reading(T0, 1)], { bucket: '10s' });
    expect(rows.map((r) => r.windowStart)).toEqual([T0, T0 + 20_000]);
  });

  describe('groupBy', () => {
    const readings = [
      reading(T0, 10, { deviceId: 'dev-01', siteId: 'site-north' }),
      reading(T0 + 1, 20, { deviceId: 'dev-02', siteId: 'site-north' }),
      reading(T0 + 2, 30, { deviceId: 'dev-03', siteId: 'site-south' }),
    ];

    it('none merges every device into one row and carries no key', () => {
      const rows = bucketize(readings, { bucket: '10s', groupBy: 'none' });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.count).toBe(3);
      expect(rows[0]?.deviceId).toBeUndefined();
      expect(rows[0]?.siteId).toBeUndefined();
    });

    it('defaults to none', () => {
      expect(bucketize(readings, { bucket: '10s' })).toHaveLength(1);
    });

    it('device produces one row per device, keyed by deviceId', () => {
      const rows = bucketize(readings, { bucket: '10s', groupBy: 'device' });
      expect(rows.map((r) => r.deviceId)).toEqual(['dev-01', 'dev-02', 'dev-03']);
      expect(rows.every((r) => r.count === 1)).toBe(true);
      expect(rows[0]?.siteId).toBeUndefined();
    });

    it('site produces one row per site, keyed by siteId', () => {
      const rows = bucketize(readings, { bucket: '10s', groupBy: 'site' });
      expect(rows.map((r) => r.siteId)).toEqual(['site-north', 'site-south']);
      expect(rows.map((r) => r.count)).toEqual([2, 1]);
      expect(rows[0]?.avg).toBe(15);
    });
  });
});

describe('latestBucketPerMetric', () => {
  it('returns nothing for no buckets', () => {
    expect(latestBucketPerMetric([])).toEqual([]);
  });

  it('keeps only the newest window per metric, sorted by metric', () => {
    const buckets = bucketize(
      [
        reading(T0, 1),
        reading(T0 + 20_000, 2),
        reading(T0, 50, { metric: 'humidity' }),
        reading(T0 + 10_000, 60, { metric: 'humidity' }),
      ],
      { bucket: '10s' },
    );
    const latest = latestBucketPerMetric(buckets);
    expect(latest.map((b) => b.metric)).toEqual(['humidity', 'temperature']);
    expect(latest.map((b) => b.windowStart)).toEqual([T0 + 10_000, T0 + 20_000]);
  });
});
