/**
 * The HTTP surface declared for this component: four REST reads, one SSE
 * stream, and a health probe.
 *
 * Two rules hold across every route:
 *  1. REST responses are wrapped in {stale, data}, so a caller always knows
 *     whether the feed behind the numbers is currently live.
 *  2. A dead generator is never an error. The ring buffer keeps answering and
 *     the response is simply marked stale — no 5xx, no empty payload.
 */
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import type { AnomalyDetector } from '../analytics/anomalyDetector.js';
import { bucketize } from '../analytics/buckets.js';
import type { RingBuffer } from '../store/ringBuffer.js';
import type { Snapshot, StaleEnvelope } from '../domain/types.js';
import { CONFIG_DEFAULTS } from '../config.js';
import { corsMiddleware } from './cors.js';
import type { SseHub } from './sseHub.js';
import {
  BadRequestError,
  assertRange,
  optionalGroupBy,
  optionalId,
  optionalLimit,
  optionalMetric,
  optionalTimestamp,
  requireBucket,
  requireMetric,
} from './validation.js';

/** What the routes read from. Everything is injected, nothing is global. */
export interface ServerDeps {
  /** Browser origin allowed to call this API; defaults to the declared one. */
  corsOrigin?: string;
  buffer: RingBuffer;
  detector: AnomalyDetector;
  /** The generator feed, whose connection state alone decides `stale`. */
  generator: { isConnected(): boolean; stats(): unknown };
  hub: SseHub;
  snapshot: () => Snapshot;
  now?: () => number;
}

/** Wrap a payload with the current staleness of the upstream feed. */
function envelope<T>(deps: ServerDeps, data: T): StaleEnvelope<T> {
  return { stale: !deps.generator.isConnected(), data };
}

/** Adapt a throwing handler to Express's error channel. */
function route(handler: (req: Request, res: Response) => void) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      handler(req, res);
    } catch (error) {
      next(error);
    }
  };
}

function kpisRoute(deps: ServerDeps) {
  return route((_req, res) => {
    res.json(envelope(deps, deps.snapshot().kpis));
  });
}

function timeseriesRoute(deps: ServerDeps) {
  return route((req, res) => {
    const metric = requireMetric(req.query['metric']);
    const bucket = requireBucket(req.query['bucket']);
    const groupBy = optionalGroupBy(req.query['groupBy']);
    const from = optionalTimestamp(req.query['from'], 'from');
    const to = optionalTimestamp(req.query['to'], 'to');
    assertRange(from, to);
    const readings = deps.buffer.query({
      metric,
      ...(from === undefined ? {} : { from }),
      ...(to === undefined ? {} : { to }),
      ...pick('deviceId', optionalId(req.query['deviceId'], 'deviceId')),
      ...pick('siteId', optionalId(req.query['siteId'], 'siteId')),
    });
    res.json(envelope(deps, bucketize(readings, { bucket, groupBy })));
  });
}

function devicesRoute(deps: ServerDeps) {
  return route((_req, res) => {
    res.json(envelope(deps, deps.snapshot().devices));
  });
}

function anomaliesRoute(deps: ServerDeps) {
  return route((req, res) => {
    const anomalies = deps.detector.recent({
      ...pick('metric', optionalMetric(req.query['metric'])),
      ...pick('deviceId', optionalId(req.query['deviceId'], 'deviceId')),
      ...pick('limit', optionalLimit(req.query['limit'])),
    });
    res.json(envelope(deps, anomalies));
  });
}

function streamRoute(deps: ServerDeps) {
  return (_req: Request, res: Response): void => {
    deps.hub.subscribe(res);
  };
}

/**
 * Liveness, not readiness: this returns 200 even when the generator is gone,
 * because a stale-but-serving API is healthy. `generatorConnected` is what an
 * operator watches instead.
 */
function healthRoute(deps: ServerDeps, startedAt: number, now: () => number) {
  return (_req: Request, res: Response): void => {
    res.json({
      ok: true,
      uptimeMs: now() - startedAt,
      generatorConnected: deps.generator.isConnected(),
      generator: deps.generator.stats(),
      bufferSize: deps.buffer.size(),
      subscribers: deps.hub.size(),
    });
  };
}

/** Omit a key entirely when its value is undefined. */
function pick<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

/** Translate validation failures into 400s and anything else into a 500. */
function errorHandler(error: Error, _req: Request, res: Response, _next: NextFunction): void {
  if (error instanceof BadRequestError) {
    res.status(400).json({ error: error.message });
    return;
  }
  res.status(500).json({ error: 'internal error' });
}

/** Build the Express app. Listening is the entrypoint's job, not this one's. */
export function createServer(deps: ServerDeps): Express {
  const now = deps.now ?? Date.now;
  const app = express();
  app.disable('x-powered-by');
  app.use(corsMiddleware(deps.corsOrigin ?? CONFIG_DEFAULTS.CORS_ORIGIN));
  app.get('/api/kpis', kpisRoute(deps));
  app.get('/api/timeseries', timeseriesRoute(deps));
  app.get('/api/devices', devicesRoute(deps));
  app.get('/api/anomalies', anomaliesRoute(deps));
  app.get('/api/stream', streamRoute(deps));
  app.get('/healthz', healthRoute(deps, now(), now));
  app.use((_req: Request, res: Response) => res.status(404).json({ error: 'not found' }));
  app.use(errorHandler);
  return app;
}
