import { describe, expect, it } from 'vitest';
import { AnomalyDetector } from '../../src/analytics/anomalyDetector.js';
import { METRIC_UNITS, type Metric, type Reading } from '../../src/domain/reading.js';

const NOW = 1_700_000_100_000;

let seq = 0;

function reading(value: number, overrides: Partial<Reading> = {}): Reading {
  const metric: Metric = overrides.metric ?? 'temperature';
  return {
    id: `r-${++seq}`,
    deviceId: 'dev-01',
    siteId: 'site-north',
    metric,
    value,
    unit: METRIC_UNITS[metric],
    ts: NOW,
    ...overrides,
  };
}

/**
 * A baseline with real spread, alternating around 20. Constant baselines have a
 * standard deviation of zero, which the detector deliberately refuses to judge.
 */
function warmUp(detector: AnomalyDetector, samples = 20, overrides: Partial<Reading> = {}): void {
  for (let i = 0; i < samples; i += 1) {
    detector.inspect(reading(i % 2 === 0 ? 19.5 : 20.5, overrides));
  }
}

describe('cold start', () => {
  it('flags nothing before the minimum sample count is reached', () => {
    const detector = new AnomalyDetector({ minSamples: 10, now: () => NOW });
    for (let i = 0; i < 9; i += 1) {
      expect(detector.inspect(reading(i % 2 === 0 ? 19.5 : 20.5))).toBeUndefined();
    }
    expect(detector.inspect(reading(500))).toBeUndefined();
    expect(detector.count()).toBe(0);
  });

  it('begins detecting once the window is warm', () => {
    const detector = new AnomalyDetector({ minSamples: 10, now: () => NOW });
    warmUp(detector, 10);
    expect(detector.inspect(reading(500))).toBeDefined();
  });

  it('refuses to judge a window with no spread at all', () => {
    const detector = new AnomalyDetector({ minSamples: 5, now: () => NOW });
    for (let i = 0; i < 10; i += 1) detector.inspect(reading(20));
    expect(detector.inspect(reading(999))).toBeUndefined();
  });
});

describe('spike detection', () => {
  it('flags a reading far outside the rolling window', () => {
    const detector = new AnomalyDetector({ now: () => NOW });
    warmUp(detector);
    const anomaly = detector.inspect(reading(120));
    expect(anomaly?.reading.value).toBe(120);
    expect(Math.abs(anomaly?.zScore ?? 0)).toBeGreaterThan(3);
    expect(anomaly?.detectedTs).toBe(NOW);
  });

  it('flags a spike below the baseline as readily as one above', () => {
    const detector = new AnomalyDetector({ now: () => NOW });
    warmUp(detector);
    const anomaly = detector.inspect(reading(-80));
    expect(anomaly?.zScore).toBeLessThan(-3);
  });

  it('does not flag in-band noise', () => {
    const detector = new AnomalyDetector({ now: () => NOW });
    warmUp(detector);
    for (const value of [19.6, 20.4, 19.8, 20.2, 20]) {
      expect(detector.inspect(reading(value))).toBeUndefined();
    }
    expect(detector.count()).toBe(0);
  });

  it('keeps a spike out of the baseline so the next one is still detectable', () => {
    const detector = new AnomalyDetector({ now: () => NOW });
    warmUp(detector);
    const lengthBefore = detector.windowLength('dev-01', 'temperature');
    expect(detector.inspect(reading(120))).toBeDefined();
    expect(detector.windowLength('dev-01', 'temperature')).toBe(lengthBefore);
    expect(detector.inspect(reading(120))).toBeDefined();
  });
});

describe('per device and per metric isolation', () => {
  it('scores each device against its own history', () => {
    const detector = new AnomalyDetector({ now: () => NOW });
    warmUp(detector, 20, { deviceId: 'dev-01' });
    expect(detector.inspect(reading(20, { deviceId: 'dev-02' }))).toBeUndefined();
    expect(detector.windowLength('dev-02', 'temperature')).toBe(1);
  });

  it('keeps separate windows per metric on the same device', () => {
    const detector = new AnomalyDetector({ now: () => NOW });
    warmUp(detector, 20);
    detector.inspect(reading(55, { metric: 'humidity' }));
    expect(detector.windowLength('dev-01', 'temperature')).toBe(20);
    expect(detector.windowLength('dev-01', 'humidity')).toBe(1);
  });
});

describe('configurability', () => {
  it('honours a lower k, flagging what k=3 would not', () => {
    // minSamples matches the warm-up length so that detection only begins
    // AFTER the baseline is complete. With k=1 a shorter cold start would flag
    // warm-up samples themselves, excluding them and skewing the baseline.
    // The finished window alternates 19.5/20.5: mean = 20, stddev = 0.5, so a
    // reading of 21 sits exactly 2 sigma out — caught by k=1, not by k=3.
    const strict = new AnomalyDetector({ k: 1, minSamples: 20, now: () => NOW });
    warmUp(strict, 20);
    expect(strict.inspect(reading(21))?.zScore).toBe(2);

    const lenient = new AnomalyDetector({ k: 3, minSamples: 20, now: () => NOW });
    warmUp(lenient, 20);
    expect(lenient.inspect(reading(21))).toBeUndefined();
  });

  it('caps the rolling window at N samples', () => {
    const detector = new AnomalyDetector({ windowSize: 5, minSamples: 3, now: () => NOW });
    warmUp(detector, 20);
    expect(detector.windowLength('dev-01', 'temperature')).toBe(5);
  });

  it('defaults to a window of 50 samples', () => {
    const detector = new AnomalyDetector({ now: () => NOW });
    warmUp(detector, 80);
    expect(detector.windowLength('dev-01', 'temperature')).toBe(50);
  });
});

describe('recent anomaly ring', () => {
  it('is bounded, dropping the oldest detections', () => {
    const detector = new AnomalyDetector({ recentLimit: 3, now: () => NOW });
    warmUp(detector);
    for (let i = 0; i < 5; i += 1) detector.inspect(reading(100 + i));
    expect(detector.count()).toBe(3);
    expect(detector.total()).toBe(5);
  });

  it('returns anomalies newest first', () => {
    const detector = new AnomalyDetector({ now: () => NOW });
    warmUp(detector);
    detector.inspect(reading(100, { id: 'first' }));
    detector.inspect(reading(200, { id: 'second' }));
    expect(detector.recent().map((a) => a.reading.id)).toEqual(['second', 'first']);
  });

  it('filters by metric and device, and applies a limit', () => {
    const detector = new AnomalyDetector({ now: () => NOW });
    warmUp(detector, 20, { deviceId: 'dev-01' });
    warmUp(detector, 20, { deviceId: 'dev-02', metric: 'humidity' });
    detector.inspect(reading(100, { deviceId: 'dev-01' }));
    detector.inspect(reading(900, { deviceId: 'dev-02', metric: 'humidity' }));

    expect(detector.recent({ deviceId: 'dev-02' })).toHaveLength(1);
    expect(detector.recent({ metric: 'humidity' })[0]?.reading.deviceId).toBe('dev-02');
    expect(detector.recent({ limit: 1 })).toHaveLength(1);
    expect(detector.recent({ metric: 'power_draw' })).toEqual([]);
  });

  it('reset() clears windows and detections', () => {
    const detector = new AnomalyDetector({ now: () => NOW });
    warmUp(detector);
    detector.inspect(reading(100));
    detector.reset();
    expect(detector.count()).toBe(0);
    expect(detector.total()).toBe(0);
    expect(detector.windowLength('dev-01', 'temperature')).toBe(0);
  });
});
