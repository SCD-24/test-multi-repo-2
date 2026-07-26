/**
 * A stand-in for the Telemetry Generator (new-test1).
 *
 * The real generator now exists, so this fake is no longer speaking to a
 * hypothetical: its frames are byte-for-byte what `GET /stream` actually emits,
 * as pinned by that repo's `test/http/streamContract.test.ts` — an opening
 * `: connected` comment, named `reading` events with a single data line, bare
 * `: keepalive` comments, and no `id:` or `retry:` directives. Keeping the two
 * aligned is the point: if the generator's framing changes, its contract test
 * fails there and this fake must be updated here, rather than the ingest tests
 * quietly passing against a format nothing produces.
 *
 * Tests drive it explicitly: nothing is emitted unless asked.
 */
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import type { Response } from 'express';
import { METRIC_UNITS, type Metric, type Reading } from '../../src/domain/reading.js';

let readingSeq = 0;

/** Build a valid Reading; override anything a test needs to vary. */
export function makeReading(overrides: Partial<Reading> = {}): Reading {
  const metric: Metric = overrides.metric ?? 'temperature';
  return {
    id: `r-${++readingSeq}`,
    deviceId: 'dev-01',
    siteId: 'site-north',
    metric,
    value: 20,
    unit: METRIC_UNITS[metric],
    ts: Date.now(),
    ...overrides,
  };
}

export interface FakeGenerator {
  /** The SSE endpoint to hand to the client under test. */
  url: string;
  /** Emit a well-formed `reading` frame to every subscriber. */
  emit(reading: Reading): void;
  /** Emit arbitrary bytes, for malformed-frame and keepalive cases. */
  emitRaw(text: string): void;
  /** Kill open streams without stopping the server, simulating a dropout. */
  dropConnections(): void;
  /** Make subsequent requests fail with this status, or 0 to serve normally. */
  failWith(status: number): void;
  /** How many subscribers are currently attached. */
  connectionCount(): number;
  /** Total /stream requests served, so tests can count reconnects. */
  requestCount(): number;
  close(): Promise<void>;
}

export interface FakeGeneratorOptions {
  /**
   * Cadence of bare `: keepalive` comment frames, mirroring the real hub (15s
   * there). Off by default so most tests stay fully deterministic; set it when
   * the point of the test is that keepalives do not disturb the parser.
   */
  keepaliveMs?: number;
}

/** Start the fake on an ephemeral port. */
export async function startFakeGenerator(
  options: FakeGeneratorOptions = {},
): Promise<FakeGenerator> {
  const clients = new Set<Response>();
  let failStatus = 0;
  let requests = 0;
  const app = express();

  app.get('/stream', (req, res) => {
    requests += 1;
    if (failStatus !== 0) {
      res.status(failStatus).json({ error: 'generator unavailable' });
      return;
    }
    // Same head the real generator writes, down to the no-transform and the
    // proxy-buffering opt-out.
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
  });

  const server = await listen(app);
  const { port } = server.address() as AddressInfo;

  // Track raw sockets so close() can tear them down. A client that aborts a
  // fetch leaves its socket in undici's keep-alive pool, and server.close()
  // would otherwise block for the several seconds until that pool expires.
  const sockets = new Set<Socket>();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  const write = (text: string): void => {
    for (const client of clients) client.write(text);
  };

  const keepalive = options.keepaliveMs
    ? setInterval(() => write(': keepalive\n\n'), options.keepaliveMs)
    : null;
  keepalive?.unref?.();

  return {
    url: `http://127.0.0.1:${port}/stream`,
    emit: (reading) => write(`event: reading\ndata: ${JSON.stringify(reading)}\n\n`),
    emitRaw: write,
    dropConnections: () => {
      for (const client of clients) client.end();
      clients.clear();
    },
    failWith: (status) => {
      failStatus = status;
    },
    connectionCount: () => clients.size,
    requestCount: () => requests,
    close: async () => {
      if (keepalive) clearInterval(keepalive);
      for (const client of clients) client.end();
      clients.clear();
      for (const socket of sockets) socket.destroy();
      sockets.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function listen(app: express.Express): Promise<Server> {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

/** Poll until a condition holds, so tests never sleep for a fixed duration. */
export async function waitFor(
  condition: () => boolean,
  timeoutMs = 2_000,
  label = 'condition',
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
}
