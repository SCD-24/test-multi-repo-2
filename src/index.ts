/**
 * Entrypoint: compose the service and manage its lifecycle.
 *
 * Wiring order follows the data path — config, store, detector, feed, snapshot,
 * stream, HTTP — so a reader can trace a Reading from the generator to the
 * Dashboard by reading top to bottom.
 */
import type { Server } from 'node:http';
import type { Socket } from 'node:net';
import { AnomalyDetector } from './analytics/anomalyDetector.js';
import { createSnapshotProvider } from './analytics/snapshot.js';
import { DEFAULT_TUNING, loadConfigOrExit } from './config.js';
import { GeneratorClient } from './ingest/generatorClient.js';
import { createServer } from './http/server.js';
import { SseHub } from './http/sseHub.js';
import { RingBuffer } from './store/ringBuffer.js';

/** How long a shutdown may take before remaining sockets are forced closed. */
const SHUTDOWN_GRACE_MS = 3_000;

function main(): void {
  const config = loadConfigOrExit();

  const buffer = new RingBuffer({ windowMs: config.ringWindowMs });
  const detector = new AnomalyDetector({ k: config.anomalyK });

  const generator = new GeneratorClient({
    url: config.generatorUrl,
    onReading: (reading) => {
      buffer.append(reading);
      detector.inspect(reading);
    },
    onStateChange: (connected) => {
      const state = connected ? 'connected to' : 'lost';
      console.log(`[analytics-api] ${state} generator at ${config.generatorUrl}`);
    },
  });

  const snapshot = createSnapshotProvider({
    readings: () => buffer.all(),
    devices: () => buffer.devices(),
    anomalies: () => detector.recent(),
    windowMs: () => buffer.windowSizeMs(),
    generatorConnected: () => generator.isConnected(),
  });

  const hub = new SseHub({ snapshot, intervalMs: DEFAULT_TUNING.snapshotIntervalMs });
  const app = createServer({ buffer, detector, generator, hub, snapshot });

  generator.start();
  hub.start();

  const server = app.listen(config.port, () => {
    console.log(`[analytics-api] listening on :${config.port}`);
  });
  installShutdown(server, hub, generator);
}

/**
 * Close in dependency order: stop pushing to subscribers, stop pulling from the
 * generator, then stop accepting requests. Lingering keep-alive sockets are
 * destroyed after a grace period so a shutdown cannot hang indefinitely.
 */
function installShutdown(server: Server, hub: SseHub, generator: GeneratorClient): void {
  const sockets = new Set<Socket>();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[analytics-api] ${signal} received, shutting down`);
    hub.close();
    await generator.stop();
    const forced = setTimeout(() => {
      for (const socket of sockets) socket.destroy();
    }, SHUTDOWN_GRACE_MS);
    forced.unref?.();
    server.close(() => {
      clearTimeout(forced);
      process.exit(0);
    });
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main();
