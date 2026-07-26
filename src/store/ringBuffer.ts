/**
 * The Ring Buffer — this service's only store.
 *
 * Holds the last `windowMs` of Readings in memory and evicts anything past that
 * horizon. There is no persistence beyond this window by design: the buffer is
 * what lets the API keep answering while its feed is down, not a database.
 */
import type { Metric, Reading } from '../domain/reading.js';

/** Last-seen record for one device, retained independently of its readings. */
export interface DeviceLastSeen {
  deviceId: string;
  siteId: string;
  lastSeenTs: number;
}

export interface RingBufferOptions {
  /** Retention horizon in milliseconds. */
  windowMs: number;
  /** Injected clock, so tests never depend on wall-clock time. */
  now?: () => number;
  /**
   * Hard cap on retained readings. Eviction is normally time-based; this is a
   * memory backstop in case the generator floods faster than the window drains.
   */
  maxSize?: number;
}

/** Filter for {@link RingBuffer.query}. All fields are optional and ANDed. */
export interface ReadingQuery {
  from?: number;
  to?: number;
  metric?: Metric;
  deviceId?: string;
  siteId?: string;
}

const DEFAULT_MAX_SIZE = 500_000;

export class RingBuffer {
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly maxSize: number;
  private readings: Reading[] = [];
  private readonly lastSeen = new Map<string, DeviceLastSeen>();

  constructor(options: RingBufferOptions) {
    this.windowMs = options.windowMs;
    this.now = options.now ?? Date.now;
    this.maxSize = options.maxSize ?? DEFAULT_MAX_SIZE;
  }

  /**
   * Add a reading, then evict expired ones.
   *
   * @returns false when the reading is already older than the horizon, so a
   * late-arriving frame is dropped rather than resurrected for one tick.
   */
  append(reading: Reading): boolean {
    this.touchDevice(reading);
    if (reading.ts <= this.horizon()) return false;
    this.readings.push(reading);
    this.evict();
    return true;
  }

  /**
   * Device liveness outlives its readings: a device silent for longer than the
   * window has no readings left but must still report as offline, so last-seen
   * is tracked separately and never evicted.
   */
  private touchDevice(reading: Reading): void {
    const existing = this.lastSeen.get(reading.deviceId);
    if (existing && existing.lastSeenTs >= reading.ts) return;
    this.lastSeen.set(reading.deviceId, {
      deviceId: reading.deviceId,
      siteId: reading.siteId,
      lastSeenTs: reading.ts,
    });
  }

  /** Oldest timestamp still inside the window. */
  private horizon(): number {
    return this.now() - this.windowMs;
  }

  /** Drop everything past the horizon, then enforce the memory backstop. */
  evict(): number {
    const horizon = this.horizon();
    const before = this.readings.length;
    this.readings = this.readings.filter((reading) => reading.ts > horizon);
    if (this.readings.length > this.maxSize) {
      this.readings.sort((a, b) => a.ts - b.ts);
      this.readings = this.readings.slice(this.readings.length - this.maxSize);
    }
    return before - this.readings.length;
  }

  /** Readings matching every supplied filter, oldest first. */
  query(filter: ReadingQuery = {}): Reading[] {
    this.evict();
    return this.readings
      .filter((reading) => matches(reading, filter))
      .sort((a, b) => a.ts - b.ts);
  }

  /** All retained readings, oldest first. */
  all(): Reading[] {
    return this.query();
  }

  /** Number of retained readings, after eviction. */
  size(): number {
    this.evict();
    return this.readings.length;
  }

  /** Last-seen record per device, including devices with no readings left. */
  devices(): DeviceLastSeen[] {
    return [...this.lastSeen.values()].sort((a, b) => a.deviceId.localeCompare(b.deviceId));
  }

  /** Retention horizon, exposed so callers can label the window they got. */
  windowSizeMs(): number {
    return this.windowMs;
  }

  /** Drop all state. Used by tests and by a full resync. */
  clear(): void {
    this.readings = [];
    this.lastSeen.clear();
  }
}

/** True when a reading satisfies every supplied filter field. */
function matches(reading: Reading, filter: ReadingQuery): boolean {
  if (filter.from !== undefined && reading.ts < filter.from) return false;
  if (filter.to !== undefined && reading.ts > filter.to) return false;
  if (filter.metric !== undefined && reading.metric !== filter.metric) return false;
  if (filter.deviceId !== undefined && reading.deviceId !== filter.deviceId) return false;
  if (filter.siteId !== undefined && reading.siteId !== filter.siteId) return false;
  return true;
}
