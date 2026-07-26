import { describe, expect, it } from 'vitest';
import { METRIC_UNITS, METRICS, isMetric, isReading, type Reading } from '../../src/domain/reading.js';

const valid: Reading = {
  id: 'r-1',
  deviceId: 'dev-01',
  siteId: 'site-north',
  metric: 'temperature',
  value: 21.4,
  unit: 'C',
  ts: 1_700_000_000_000,
};

describe('isMetric', () => {
  it('accepts every declared metric', () => {
    for (const metric of METRICS) expect(isMetric(metric)).toBe(true);
  });

  it.each([['pressure'], [''], [null], [undefined], [3], [{}]])('rejects %s', (candidate) => {
    expect(isMetric(candidate)).toBe(false);
  });
});

describe('isReading', () => {
  it('accepts a well-formed reading for each metric', () => {
    for (const metric of METRICS) {
      expect(isReading({ ...valid, metric, unit: METRIC_UNITS[metric] })).toBe(true);
    }
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'reading'],
    ['a number', 42],
    ['an array', [valid]],
    ['an empty object', {}],
  ])('rejects %s', (_label, candidate) => {
    expect(isReading(candidate)).toBe(false);
  });

  it.each([
    ['missing id', { ...valid, id: undefined }],
    ['blank id', { ...valid, id: '   ' }],
    ['numeric deviceId', { ...valid, deviceId: 7 }],
    ['blank siteId', { ...valid, siteId: '' }],
    ['unknown metric', { ...valid, metric: 'pressure' }],
    ['string value', { ...valid, value: '21.4' }],
    ['NaN value', { ...valid, value: Number.NaN }],
    ['Infinity value', { ...valid, value: Number.POSITIVE_INFINITY }],
    ['mismatched unit', { ...valid, metric: 'humidity', unit: 'C' }],
    ['missing ts', { ...valid, ts: undefined }],
    ['zero ts', { ...valid, ts: 0 }],
    ['NaN ts', { ...valid, ts: Number.NaN }],
    ['string ts', { ...valid, ts: '1700000000000' }],
  ])('rejects a reading with %s', (_label, candidate) => {
    expect(isReading(candidate)).toBe(false);
  });

  it('tolerates extra fields the generator may add later', () => {
    expect(isReading({ ...valid, firmware: '1.2.3' })).toBe(true);
  });
});
