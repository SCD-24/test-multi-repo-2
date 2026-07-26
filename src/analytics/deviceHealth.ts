/**
 * Device Health — how alive each device in the fleet is.
 *
 * Status is derived from the age of a device's last Reading against an injected
 * clock, never from wall-clock time directly, so every threshold transition is
 * pinnable in a test without waiting.
 *
 * The thresholds are tuning knobs, NOT env vars: they are not declared on the
 * architecture canvas, so they are passed in with defaults from DEFAULT_TUNING.
 */
import { DEFAULT_TUNING } from '../config.js';
import type { DeviceLastSeen } from '../store/ringBuffer.js';
import type { DeviceHealth, DeviceStatus } from '../domain/types.js';

export interface DeviceHealthOptions {
  /** Seen more recently than this many ms ago: `online`. */
  onlineThresholdMs?: number;
  /** Seen more recently than this many ms ago: `stale`; beyond it, `offline`. */
  staleThresholdMs?: number;
}

/**
 * Classify one device by how long it has been silent.
 *
 * Boundaries are exclusive at the top: an age exactly equal to the online
 * threshold is already `stale`, so a device cannot linger in a status its
 * silence has outgrown.
 */
export function classifyStatus(
  ageMs: number,
  options: DeviceHealthOptions = {},
): DeviceStatus {
  const online = options.onlineThresholdMs ?? DEFAULT_TUNING.onlineThresholdMs;
  const stale = options.staleThresholdMs ?? DEFAULT_TUNING.staleThresholdMs;
  if (ageMs < online) return 'online';
  if (ageMs < stale) return 'stale';
  return 'offline';
}

/**
 * Build a health row per device.
 *
 * Ages are clamped at 0 so a Reading timestamped slightly in the future (clock
 * skew between the generator and this service) never reports a negative age.
 */
export function buildDeviceHealth(
  devices: readonly DeviceLastSeen[],
  now: number,
  options: DeviceHealthOptions = {},
): DeviceHealth[] {
  return devices.map((device) => {
    const ageMs = Math.max(0, now - device.lastSeenTs);
    return {
      deviceId: device.deviceId,
      siteId: device.siteId,
      status: classifyStatus(ageMs, options),
      lastSeenTs: device.lastSeenTs,
      ageMs,
    };
  });
}

/** Devices currently reporting — the `activeDevices` KPI. */
export function countActive(health: readonly DeviceHealth[]): number {
  return health.filter((device) => device.status === 'online').length;
}
