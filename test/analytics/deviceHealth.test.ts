import { describe, expect, it } from 'vitest';
import {
  buildDeviceHealth,
  classifyStatus,
  countActive,
} from '../../src/analytics/deviceHealth.js';
import { DEFAULT_TUNING } from '../../src/config.js';
import type { DeviceLastSeen } from '../../src/store/ringBuffer.js';

const NOW = 1_700_000_100_000;
const { onlineThresholdMs: ONLINE, staleThresholdMs: STALE } = DEFAULT_TUNING;

function lastSeen(deviceId: string, ageMs: number, siteId = 'site-north'): DeviceLastSeen {
  return { deviceId, siteId, lastSeenTs: NOW - ageMs };
}

describe('classifyStatus threshold transitions', () => {
  it.each([
    [0, 'online'],
    [1, 'online'],
    [ONLINE - 1, 'online'],
    [ONLINE, 'stale'],
    [ONLINE + 1, 'stale'],
    [STALE - 1, 'stale'],
    [STALE, 'offline'],
    [STALE + 1, 'offline'],
    [3_600_000, 'offline'],
  ])('an age of %ims is %s', (ageMs, expected) => {
    expect(classifyStatus(ageMs)).toBe(expected);
  });

  it('uses the declared 5s and 30s defaults', () => {
    expect(ONLINE).toBe(5_000);
    expect(STALE).toBe(30_000);
  });

  it('honours injected thresholds instead of the defaults', () => {
    const options = { onlineThresholdMs: 100, staleThresholdMs: 200 };
    expect(classifyStatus(99, options)).toBe('online');
    expect(classifyStatus(100, options)).toBe('stale');
    expect(classifyStatus(200, options)).toBe('offline');
  });
});

describe('buildDeviceHealth', () => {
  it('returns nothing when no device has ever reported', () => {
    expect(buildDeviceHealth([], NOW)).toEqual([]);
  });

  it('derives age and status from the injected clock', () => {
    const health = buildDeviceHealth([lastSeen('dev-01', 1_000)], NOW);
    expect(health).toEqual([
      {
        deviceId: 'dev-01',
        siteId: 'site-north',
        status: 'online',
        lastSeenTs: NOW - 1_000,
        ageMs: 1_000,
      },
    ]);
  });

  it('classifies a mixed fleet at one instant', () => {
    const health = buildDeviceHealth(
      [
        lastSeen('dev-01', 1_000),
        lastSeen('dev-02', 10_000, 'site-central'),
        lastSeen('dev-03', 120_000, 'site-south'),
      ],
      NOW,
    );
    expect(health.map((d) => d.status)).toEqual(['online', 'stale', 'offline']);
  });

  it('walks one device through online then stale then offline as the clock advances', () => {
    const device = [lastSeen('dev-01', 0)];
    expect(buildDeviceHealth(device, NOW)[0]?.status).toBe('online');
    expect(buildDeviceHealth(device, NOW + 6_000)[0]?.status).toBe('stale');
    expect(buildDeviceHealth(device, NOW + 31_000)[0]?.status).toBe('offline');
  });

  it('clamps a future timestamp to zero age rather than reporting negative', () => {
    const health = buildDeviceHealth([lastSeen('dev-01', -5_000)], NOW);
    expect(health[0]?.ageMs).toBe(0);
    expect(health[0]?.status).toBe('online');
  });

  it('preserves the site so the Dashboard can group by it', () => {
    const health = buildDeviceHealth([lastSeen('dev-07', 0, 'site-south')], NOW);
    expect(health[0]?.siteId).toBe('site-south');
  });
});

describe('countActive', () => {
  it('counts only online devices', () => {
    const health = buildDeviceHealth(
      [lastSeen('dev-01', 0), lastSeen('dev-02', 10_000), lastSeen('dev-03', 60_000)],
      NOW,
    );
    expect(countActive(health)).toBe(1);
  });

  it('is zero for an empty fleet', () => {
    expect(countActive([])).toBe(0);
  });
});
