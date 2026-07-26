import { describe, expect, it, vi } from 'vitest';
import {
  CONFIG_DEFAULTS,
  ConfigError,
  DEFAULT_TUNING,
  loadConfig,
  loadConfigOrExit,
} from '../src/config.js';

describe('loadConfig', () => {
  it('falls back to the declared defaults on an empty environment', () => {
    expect(loadConfig({})).toEqual({
      generatorUrl: CONFIG_DEFAULTS.GENERATOR_URL,
      ringWindowMs: 3_600_000,
      anomalyK: 3,
      port: 4002,
      corsOrigin: CONFIG_DEFAULTS.CORS_ORIGIN,
    });
  });

  it('defaults the allowed origin to the Dashboard dev server', () => {
    expect(loadConfig({}).corsOrigin).toBe('http://localhost:5173');
  });

  it('treats blank values as absent', () => {
    const config = loadConfig({ GENERATOR_URL: '   ', RING_WINDOW_MS: '', PORT: '' });
    expect(config.generatorUrl).toBe(CONFIG_DEFAULTS.GENERATOR_URL);
    expect(config.ringWindowMs).toBe(3_600_000);
    expect(config.port).toBe(4002);
  });

  it('applies overrides from the environment', () => {
    const config = loadConfig({
      GENERATOR_URL: 'https://generator.internal:9000/stream',
      RING_WINDOW_MS: '60000',
      ANOMALY_K: '2.5',
      PORT: '8080',
      CORS_ORIGIN: 'https://ops.example.com',
    });
    expect(config).toEqual({
      generatorUrl: 'https://generator.internal:9000/stream',
      ringWindowMs: 60_000,
      anomalyK: 2.5,
      port: 8080,
      corsOrigin: 'https://ops.example.com',
    });
  });

  it('accepts the wildcard origin', () => {
    expect(loadConfig({ CORS_ORIGIN: '*' }).corsOrigin).toBe('*');
  });

  it('rejects an origin with a path or trailing slash, naming the fix', () => {
    // Browsers compare the header byte for byte, so "http://x/" never matches.
    expect(() => loadConfig({ CORS_ORIGIN: 'http://localhost:5173/' })).toThrow(
      /no path or trailing slash.*http:\/\/localhost:5173/,
    );
  });

  it.each([
    ['GENERATOR_URL', 'not-a-url'],
    ['GENERATOR_URL', 'ftp://generator/stream'],
    ['RING_WINDOW_MS', '0'],
    ['RING_WINDOW_MS', '-1'],
    ['RING_WINDOW_MS', '1.5'],
    ['RING_WINDOW_MS', 'soon'],
    ['ANOMALY_K', '0'],
    ['ANOMALY_K', '-3'],
    ['ANOMALY_K', 'three'],
    ['PORT', '0'],
    ['PORT', '70000'],
    ['PORT', 'http'],
    ['CORS_ORIGIN', 'localhost:5173'],
    ['CORS_ORIGIN', 'ftp://localhost:5173'],
    ['CORS_ORIGIN', 'http://localhost:5173/api'],
  ])('rejects %s=%s', (key, value) => {
    expect(() => loadConfig({ [key]: value })).toThrow(ConfigError);
  });

  it('names the offending variable in the error message', () => {
    expect(() => loadConfig({ ANOMALY_K: 'three' })).toThrow(/ANOMALY_K/);
  });
});

describe('loadConfigOrExit', () => {
  it('returns the config when the environment is valid', () => {
    const exit = vi.fn();
    expect(loadConfigOrExit({ PORT: '5000' }, exit as never).port).toBe(5000);
    expect(exit).not.toHaveBeenCalled();
  });

  it('exits non-zero on invalid configuration', () => {
    const exit = vi.fn();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => loadConfigOrExit({ PORT: 'nope' }, exit as never)).toThrow(ConfigError);
    expect(exit).toHaveBeenCalledWith(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('PORT'));
    error.mockRestore();
  });
});

describe('DEFAULT_TUNING', () => {
  it('keeps undeclared knobs out of the environment', () => {
    expect(DEFAULT_TUNING.anomalyWindowSize).toBe(50);
    expect(DEFAULT_TUNING.snapshotIntervalMs).toBe(1_000);
    expect(DEFAULT_TUNING.onlineThresholdMs).toBeLessThan(DEFAULT_TUNING.staleThresholdMs);
  });
});
