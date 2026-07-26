import { describe, expect, it } from 'vitest';
import { buildSnapshot } from '../../src/analytics/snapshot.js';
import { METRIC_UNITS, METRICS, type Metric, type Reading } from '../../src/domain/reading.js';
import type { AnomalyRecord } from '../../src/domain/types.js';
import type { DeviceLastSeen } from '../../src/store/ringBuffer.js';

/** Exact 5m/1m/10s boundary, so bucket windows are unambiguous. */
const NOW = 1_700_000_100_000;
const HOUR_MS = 3_600_000;

let seq = 0;

function reading(overrides: Partial<Reading> = {}): Reading {
  const metric: Metric = overrides.metric ?? 'temperature';
  return {
    id: `r-${++seq}`,
    deviceId: 'dev-01',
    siteId: 'site-north',
    metric,
    value: 20,
    unit: METRIC_UNITS[metric],
    ts: NOW,
    ...overrides,
  };
}

function anomaly(id: string): AnomalyRecord {
  return { reading: reading({ id, value: 300 }), zScore: 9, detectedTs: NOW };
}

function input(overrides: Partial<Parameters<typeof buildSnapshot>[0]> = {}) {
  return {
    readings: [] as Reading[],
    devices: [] as DeviceLastSeen[],
    anomalies: [] as AnomalyRecord[],
    windowMs: HOUR_MS,
    generatorConnected: true,
    now: NOW,
    ...overrides,
  };
}

describe('buildSnapshot', () => {
  it('produces every declared section even with no data', () => {
    const snapshot = buildSnapshot(input());
    expect(Object.keys(snapshot).sort()).toEqual([
      'anomalies',
      'devices',
      'generatedTs',
      'kpis',
      'latestBuckets',
      'stale',
    ]);
    expect(snapshot.latestBuckets).toEqual([]);
    expect(snapshot.devices).toEqual([]);
    expect(snapshot.anomalies).toEqual([]);
    expect(snapshot.kpis.byMetric.map((m) => m.metric)).toEqual([...METRICS]);
  });

  it('stamps the injected clock rather than wall-clock time', () => {
    expect(buildSnapshot(input()).generatedTs).toBe(NOW);
  });

  describe('stale propagation', () => {
    it('is not stale while the generator feed is up', () => {
      expect(buildSnapshot(input({ generatorConnected: true })).stale).toBe(false);
    });

    it('is stale the moment the generator feed is down', () => {
      expect(buildSnapshot(input({ generatorConnected: false })).stale).toBe(true);
    });

    it('still carries buffered data while stale, rather than emptying', () => {
      const snapshot = buildSnapshot(
        input({
          generatorConnected: false,
          readings: [reading({ value: 21 })],
          devices: [{ deviceId: 'dev-01', siteId: 'site-north', lastSeenTs: NOW - 1_000 }],
        }),
      );
      expect(snapshot.stale).toBe(true);
      expect(snapshot.kpis.totalReadings).toBe(1);
      expect(snapshot.latestBuckets).toHaveLength(1);
      expect(snapshot.devices).toHaveLength(1);
    });
  });

  it('carries the newest 10s bucket per metric', () => {
    const snapshot = buildSnapshot(
      input({
        readings: [
          reading({ ts: NOW - 20_000, value: 10 }),
          reading({ ts: NOW, value: 30 }),
          reading({ ts: NOW, metric: 'humidity', unit: '%', value: 55 }),
        ],
      }),
    );
    expect(snapshot.latestBuckets.map((b) => b.metric)).toEqual(['humidity', 'temperature']);
    const temperature = snapshot.latestBuckets.find((b) => b.metric === 'temperature');
    expect(temperature?.windowStart).toBe(NOW);
    expect(temperature?.avg).toBe(30);
  });

  it('derives device health from the injected clock', () => {
    const snapshot = buildSnapshot(
      input({
        devices: [
          { deviceId: 'dev-01', siteId: 'site-north', lastSeenTs: NOW - 1_000 },
          { deviceId: 'dev-02', siteId: 'site-south', lastSeenTs: NOW - 10_000 },
          { deviceId: 'dev-03', siteId: 'site-south', lastSeenTs: NOW - 60_000 },
        ],
      }),
    );
    expect(snapshot.devices.map((d) => d.status)).toEqual(['online', 'stale', 'offline']);
    expect(snapshot.kpis.activeDevices).toBe(1);
    expect(snapshot.kpis.deviceCount).toBe(3);
  });

  it('counts every anomaly in the KPIs but caps the ones it carries', () => {
    const anomalies = Array.from({ length: 25 }, (_unused, i) => anomaly(`a-${i}`));
    const snapshot = buildSnapshot(input({ anomalies }));
    expect(snapshot.kpis.anomalyCount).toBe(25);
    expect(snapshot.anomalies).toHaveLength(20);
    expect(snapshot.anomalies[0]?.reading.id).toBe('a-0');
  });

  it('honours an explicit anomaly limit', () => {
    const anomalies = [anomaly('a-1'), anomaly('a-2'), anomaly('a-3')];
    expect(buildSnapshot(input({ anomalies, anomalyLimit: 2 })).anomalies).toHaveLength(2);
  });

  it('echoes the retention window into the KPIs', () => {
    expect(buildSnapshot(input({ windowMs: 60_000 })).kpis.windowMs).toBe(60_000);
  });

  it('honours injected health thresholds', () => {
    const snapshot = buildSnapshot(
      input({
        devices: [{ deviceId: 'dev-01', siteId: 'site-north', lastSeenTs: NOW - 1_000 }],
        health: { onlineThresholdMs: 500, staleThresholdMs: 800 },
      }),
    );
    expect(snapshot.devices[0]?.status).toBe('offline');
  });
});
