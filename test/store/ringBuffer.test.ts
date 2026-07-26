import { beforeEach, describe, expect, it } from 'vitest';
import { RingBuffer } from '../../src/store/ringBuffer.js';
import { METRIC_UNITS, type Metric, type Reading } from '../../src/domain/reading.js';

const HOUR_MS = 3_600_000;
const T0 = 1_700_000_000_000;

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
    ts: T0,
    ...overrides,
  };
}

/** Buffer whose clock the test drives explicitly. */
function bufferAt(now: () => number, windowMs = HOUR_MS, maxSize?: number): RingBuffer {
  return new RingBuffer(maxSize === undefined ? { windowMs, now } : { windowMs, now, maxSize });
}

describe('RingBuffer', () => {
  let clock = T0;

  beforeEach(() => {
    clock = T0;
    seq = 0;
  });

  it('retains readings inside the window', () => {
    const buffer = bufferAt(() => clock);
    buffer.append(reading({ ts: T0 - 1_000 }));
    buffer.append(reading({ ts: T0 - 2_000 }));
    expect(buffer.size()).toBe(2);
  });

  it('evicts readings once they fall past the 60-minute horizon', () => {
    const buffer = bufferAt(() => clock);
    buffer.append(reading({ ts: T0 - 1_000 }));
    expect(buffer.size()).toBe(1);
    clock = T0 + HOUR_MS;
    expect(buffer.size()).toBe(0);
  });

  it('keeps a reading exactly on the horizon boundary out', () => {
    const buffer = bufferAt(() => clock);
    expect(buffer.append(reading({ ts: clock - HOUR_MS }))).toBe(false);
    expect(buffer.append(reading({ ts: clock - HOUR_MS + 1 }))).toBe(true);
  });

  it('rejects a late frame that is already older than the window', () => {
    const buffer = bufferAt(() => clock);
    expect(buffer.append(reading({ ts: T0 - HOUR_MS - 5_000 }))).toBe(false);
    expect(buffer.size()).toBe(0);
  });

  it('returns out-of-order appends sorted oldest first', () => {
    const buffer = bufferAt(() => clock);
    buffer.append(reading({ ts: T0 - 1_000, id: 'late' }));
    buffer.append(reading({ ts: T0 - 5_000, id: 'early' }));
    buffer.append(reading({ ts: T0 - 3_000, id: 'middle' }));
    expect(buffer.all().map((r) => r.id)).toEqual(['early', 'middle', 'late']);
  });

  it('reports the configured window size', () => {
    expect(bufferAt(() => clock, 60_000).windowSizeMs()).toBe(60_000);
  });

  describe('query filters', () => {
    let buffer: RingBuffer;

    beforeEach(() => {
      buffer = bufferAt(() => clock);
      buffer.append(reading({ ts: T0 - 5_000, deviceId: 'dev-01', siteId: 'site-north' }));
      buffer.append(
        reading({ ts: T0 - 4_000, deviceId: 'dev-02', siteId: 'site-south', metric: 'humidity' }),
      );
      buffer.append(
        reading({ ts: T0 - 3_000, deviceId: 'dev-03', siteId: 'site-south', metric: 'power_draw' }),
      );
    });

    it('filters by metric', () => {
      expect(buffer.query({ metric: 'humidity' })).toHaveLength(1);
    });

    it('filters by deviceId', () => {
      expect(buffer.query({ deviceId: 'dev-03' })[0]?.metric).toBe('power_draw');
    });

    it('filters by siteId', () => {
      expect(buffer.query({ siteId: 'site-south' })).toHaveLength(2);
    });

    it('filters by an inclusive time range', () => {
      const rows = buffer.query({ from: T0 - 4_000, to: T0 - 3_000 });
      expect(rows.map((r) => r.deviceId)).toEqual(['dev-02', 'dev-03']);
    });

    it('ANDs every supplied filter', () => {
      expect(buffer.query({ siteId: 'site-south', metric: 'power_draw' })).toHaveLength(1);
      expect(buffer.query({ siteId: 'site-north', metric: 'power_draw' })).toHaveLength(0);
    });

    it('returns everything when no filter is given', () => {
      expect(buffer.query()).toHaveLength(3);
    });
  });

  describe('device last-seen tracking', () => {
    it('records the newest timestamp per device', () => {
      const buffer = bufferAt(() => clock);
      buffer.append(reading({ deviceId: 'dev-01', ts: T0 - 5_000 }));
      buffer.append(reading({ deviceId: 'dev-01', ts: T0 - 1_000 }));
      expect(buffer.devices()).toEqual([
        { deviceId: 'dev-01', siteId: 'site-north', lastSeenTs: T0 - 1_000 },
      ]);
    });

    it('ignores an older frame arriving after a newer one', () => {
      const buffer = bufferAt(() => clock);
      buffer.append(reading({ deviceId: 'dev-01', ts: T0 - 1_000 }));
      buffer.append(reading({ deviceId: 'dev-01', ts: T0 - 9_000 }));
      expect(buffer.devices()[0]?.lastSeenTs).toBe(T0 - 1_000);
    });

    it('keeps last-seen after every reading for that device has been evicted', () => {
      const buffer = bufferAt(() => clock);
      buffer.append(reading({ deviceId: 'dev-01', ts: T0 - 1_000 }));
      clock = T0 + HOUR_MS;
      expect(buffer.size()).toBe(0);
      expect(buffer.devices()[0]).toEqual({
        deviceId: 'dev-01',
        siteId: 'site-north',
        lastSeenTs: T0 - 1_000,
      });
    });

    it('tracks a device whose only frame was too old to retain', () => {
      const buffer = bufferAt(() => clock);
      expect(buffer.append(reading({ deviceId: 'dev-09', ts: T0 - HOUR_MS - 1 }))).toBe(false);
      expect(buffer.devices().map((d) => d.deviceId)).toEqual(['dev-09']);
    });

    it('sorts devices by id', () => {
      const buffer = bufferAt(() => clock);
      buffer.append(reading({ deviceId: 'dev-03' }));
      buffer.append(reading({ deviceId: 'dev-01' }));
      buffer.append(reading({ deviceId: 'dev-02' }));
      expect(buffer.devices().map((d) => d.deviceId)).toEqual(['dev-01', 'dev-02', 'dev-03']);
    });
  });

  describe('size bounds', () => {
    it('stays bounded by the memory backstop, keeping the newest readings', () => {
      const buffer = bufferAt(() => clock, HOUR_MS, 3);
      for (let i = 0; i < 10; i += 1) buffer.append(reading({ ts: T0 - 10_000 + i }));
      expect(buffer.size()).toBe(3);
      expect(buffer.all().map((r) => r.ts)).toEqual([T0 - 10_000 + 7, T0 - 10_000 + 8, T0 - 10_000 + 9]);
    });

    it('reports how many readings an eviction removed', () => {
      const buffer = bufferAt(() => clock);
      buffer.append(reading({ ts: T0 - 1_000 }));
      buffer.append(reading({ ts: T0 - 2_000 }));
      clock = T0 + HOUR_MS;
      expect(buffer.evict()).toBe(2);
    });
  });

  it('clear() drops readings and last-seen state', () => {
    const buffer = bufferAt(() => clock);
    buffer.append(reading());
    buffer.clear();
    expect(buffer.size()).toBe(0);
    expect(buffer.devices()).toEqual([]);
  });
});
