import { describe, expect, it } from 'vitest';
import {
  avg,
  count,
  max,
  mean,
  min,
  p95,
  percentile,
  stddev,
  sum,
  variance,
} from '../../src/analytics/stats.js';

describe('stats on empty input', () => {
  it.each([
    ['count', count],
    ['sum', sum],
    ['mean', mean],
    ['avg', avg],
    ['min', min],
    ['max', max],
    ['p95', p95],
    ['variance', variance],
    ['stddev', stddev],
  ])('%s returns 0 rather than NaN', (_name, fn) => {
    expect(fn([])).toBe(0);
  });
});

describe('stats on a single sample', () => {
  const one = [7];

  it('reports that sample for every positional statistic', () => {
    expect(min(one)).toBe(7);
    expect(max(one)).toBe(7);
    expect(mean(one)).toBe(7);
    expect(p95(one)).toBe(7);
  });

  it('has zero spread', () => {
    expect(variance(one)).toBe(0);
    expect(stddev(one)).toBe(0);
  });
});

describe('stats on known fixtures', () => {
  const values = [2, 4, 4, 4, 5, 5, 7, 9];

  it('computes count and sum', () => {
    expect(count(values)).toBe(8);
    expect(sum(values)).toBe(40);
  });

  it('computes mean and its avg alias identically', () => {
    expect(mean(values)).toBe(5);
    expect(avg(values)).toBe(mean(values));
  });

  it('computes min and max', () => {
    expect(min(values)).toBe(2);
    expect(max(values)).toBe(9);
  });

  it('computes population variance and stddev', () => {
    expect(variance(values)).toBe(4);
    expect(stddev(values)).toBe(2);
  });

  it('handles negative samples', () => {
    expect(min([-5, 3])).toBe(-5);
    expect(max([-5, -9])).toBe(-5);
    expect(mean([-4, 4])).toBe(0);
  });

  it('does not mutate its input while sorting', () => {
    const unsorted = [9, 1, 5];
    p95(unsorted);
    expect(unsorted).toEqual([9, 1, 5]);
  });
});

describe('percentile (nearest-rank)', () => {
  const oneToTen = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  it('returns an observed value, never an interpolation', () => {
    expect(oneToTen).toContain(percentile(oneToTen, 0.5));
    expect(p95(oneToTen)).toBe(10);
  });

  it('uses ceil(fraction * n) as the rank', () => {
    expect(percentile(oneToTen, 0.5)).toBe(5);
    expect(percentile(oneToTen, 0.55)).toBe(6);
  });

  it('returns the minimum at the 0th percentile and the maximum at the 100th', () => {
    expect(percentile(oneToTen, 0)).toBe(1);
    expect(percentile(oneToTen, 1)).toBe(10);
  });

  it('clamps fractions outside 0..1', () => {
    expect(percentile(oneToTen, -1)).toBe(1);
    expect(percentile(oneToTen, 5)).toBe(10);
  });

  it('sorts before ranking, so input order is irrelevant', () => {
    expect(p95([10, 1, 5, 3, 8])).toBe(p95([1, 3, 5, 8, 10]));
  });

  it('picks the top sample of a 20-element series at p95', () => {
    const twenty = Array.from({ length: 20 }, (_unused, index) => index + 1);
    expect(p95(twenty)).toBe(19);
  });
});
