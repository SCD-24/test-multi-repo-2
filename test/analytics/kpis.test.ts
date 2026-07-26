import { describe, expect, it } from 'vitest';
import { buildKpis } from '../../src/analytics/kpis.js';
import { buildDeviceHealth } from '../../src/analytics/deviceHealth.js';
import { METRIC_UNITS, METRICS, type Metric, type Reading } from '../../src/domain/reading.js';
import type { DeviceLastSeen } from '../../src/store/ringBuffer.js';

const NOW = 1_700_000_100_000;
const HOUR_MS = 3_600_000;

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

function lastSeen(deviceId: string, ageMs: number): DeviceLastSeen {
  return { deviceId, siteId: 'site-north', lastSeenTs: NOW - ageMs };
}

describe('buildKpis', () => {
  it('reports zeros for an empty window but still lists every metric', () => {
    const kpis = buildKpis({ readings: [], devices: [], anomalyCount: 0, windowMs: HOUR_MS });
    expect(kpis.totalReadings).toBe(0);
    expect(kpis.deviceCount).toBe(0);
    expect(kpis.activeDevices).toBe(0);
    expect(kpis.byMetric.map((m) => m.metric)).toEqual([...METRICS]);
    expect(kpis.byMetric.every((m) => m.count === 0)).toBe(true);
  });

  it('echoes the retention window it summarised', () => {
    const kpis = buildKpis({ readings: [], devices: [], anomalyCount: 0, windowMs: 60_000 });
    expect(kpis.windowMs).toBe(60_000);
  });

  it('totals readings across all metrics', () => {
    const kpis = buildKpis({
      readings: [reading(1), reading(2, { metric: 'humidity' }), reading(3)],
      devices: [],
      anomalyCount: 0,
      windowMs: HOUR_MS,
    });
    expect(kpis.totalReadings).toBe(3);
  });

  it('summarises each metric independently', () => {
    const kpis = buildKpis({
      readings: [
        reading(10),
        reading(20),
        reading(50, { metric: 'humidity' }),
        reading(60, { metric: 'humidity' }),
      ],
      devices: [],
      anomalyCount: 0,
      windowMs: HOUR_MS,
    });
    const temperature = kpis.byMetric.find((m) => m.metric === 'temperature');
    const humidity = kpis.byMetric.find((m) => m.metric === 'humidity');
    expect(temperature).toEqual({ metric: 'temperature', avg: 15, min: 10, max: 20, p95: 20, count: 2 });
    expect(humidity?.avg).toBe(55);
    expect(kpis.byMetric.find((m) => m.metric === 'power_draw')?.count).toBe(0);
  });

  it('rounds floating-point noise out of the averages', () => {
    const kpis = buildKpis({
      readings: [reading(0.1), reading(0.2)],
      devices: [],
      anomalyCount: 0,
      windowMs: HOUR_MS,
    });
    expect(kpis.byMetric.find((m) => m.metric === 'temperature')?.avg).toBe(0.15);
  });

  it('counts devices and active devices from the health rows', () => {
    const devices = buildDeviceHealth(
      [lastSeen('dev-01', 0), lastSeen('dev-02', 1_000), lastSeen('dev-03', 60_000)],
      NOW,
    );
    const kpis = buildKpis({ readings: [], devices, anomalyCount: 0, windowMs: HOUR_MS });
    expect(kpis.deviceCount).toBe(3);
    expect(kpis.activeDevices).toBe(2);
  });

  it('passes the anomaly count straight through', () => {
    const kpis = buildKpis({ readings: [], devices: [], anomalyCount: 7, windowMs: HOUR_MS });
    expect(kpis.anomalyCount).toBe(7);
  });
});
