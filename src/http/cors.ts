/**
 * Cross-origin access for the Dashboard.
 *
 * The Dashboard is served from its own origin and calls this API directly —
 * there is no proxy in front of either — so every REST read and the SSE stream
 * need an explicit allow-origin. The headers are exposed as a plain record as
 * well as middleware because the SSE hub writes its response head itself and
 * cannot go through the middleware chain.
 *
 * Only GET is permitted: this API is read-only, and no credentials are used
 * (the Dashboard's EventSource is created without `withCredentials`), so the
 * wildcard origin remains legal here.
 */
import type { NextFunction, Request, Response } from 'express';

/** Status for a preflight that carries no body. */
const NO_CONTENT = 204;

/**
 * The allow-origin headers for a given configured origin.
 *
 * `Vary: Origin` is always sent so a shared cache can never serve one origin's
 * allow-origin header to another.
 */
export function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };
}

/**
 * Apply {@link corsHeaders} to every response and answer preflights directly.
 *
 * The preflight is short-circuited rather than passed down the stack because
 * the routes below only declare GET handlers: an OPTIONS request would
 * otherwise fall through to the 404 handler and fail the preflight.
 */
export function corsMiddleware(origin: string) {
  const headers = corsHeaders(origin);
  return (req: Request, res: Response, next: NextFunction): void => {
    for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
    if (req.method === 'OPTIONS') {
      res.status(NO_CONTENT).end();
      return;
    }
    next();
  };
}
