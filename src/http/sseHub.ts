/**
 * SSE hub — pushes `update` frames to every Dashboard subscriber.
 *
 * One shared cadence timer builds the snapshot ONCE per tick and fans it out,
 * so cost is independent of how many dashboards are watching.
 */
import type { Response } from 'express';
import { DEFAULT_TUNING } from '../config.js';
import type { Snapshot } from '../domain/types.js';

/** The event name the Dashboard listens for. */
const UPDATE_EVENT = 'update';

export interface SseHubOptions {
  /** Produces the current picture; called once per tick. */
  snapshot: () => Snapshot;
  /** Cadence of `update` frames. */
  intervalMs?: number;
  /** Comment-only keepalive interval, for proxies that idle out a quiet socket. */
  keepaliveMs?: number;
}

export class SseHub {
  private readonly snapshot: () => Snapshot;
  private readonly intervalMs: number;
  private readonly keepaliveMs: number;
  private readonly clients = new Set<Response>();
  private timer: NodeJS.Timeout | null = null;
  private keepaliveTimer: NodeJS.Timeout | null = null;
  private framesSent = 0;

  constructor(options: SseHubOptions) {
    this.snapshot = options.snapshot;
    this.intervalMs = options.intervalMs ?? DEFAULT_TUNING.snapshotIntervalMs;
    this.keepaliveMs = options.keepaliveMs ?? 15_000;
  }

  /**
   * Attach a subscriber.
   *
   * The first frame is sent immediately rather than at the next tick, so a
   * dashboard that has just loaded paints real data without waiting a cadence.
   */
  subscribe(res: Response): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');
    this.clients.add(res);
    res.on('close', () => this.clients.delete(res));
    this.send(res, this.snapshot());
  }

  /** Begin the cadence. Idempotent. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.broadcast(), this.intervalMs);
    this.timer.unref?.();
    this.keepaliveTimer = setInterval(() => this.writeAll(': keepalive\n\n'), this.keepaliveMs);
    this.keepaliveTimer.unref?.();
  }

  /** Build one snapshot and fan it out to every subscriber. */
  broadcast(): void {
    if (this.clients.size === 0) return;
    const snapshot = this.snapshot();
    for (const client of this.clients) this.send(client, snapshot);
  }

  /**
   * Stop the cadence and end every stream.
   *
   * Called on shutdown so subscribers are closed cleanly instead of being left
   * to time out against a dead process.
   */
  close(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.keepaliveTimer) clearInterval(this.keepaliveTimer);
    this.timer = null;
    this.keepaliveTimer = null;
    for (const client of this.clients) client.end();
    this.clients.clear();
  }

  /** Current subscriber count, surfaced by /healthz. */
  size(): number {
    return this.clients.size;
  }

  /** Frames written since start, for tests and diagnostics. */
  sent(): number {
    return this.framesSent;
  }

  private send(res: Response, snapshot: Snapshot): void {
    res.write(`event: ${UPDATE_EVENT}\ndata: ${JSON.stringify(snapshot)}\n\n`);
    this.framesSent += 1;
  }

  private writeAll(text: string): void {
    for (const client of this.clients) client.write(text);
  }
}
