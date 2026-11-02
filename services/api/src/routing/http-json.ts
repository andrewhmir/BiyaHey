import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { FetchLike } from '../app.js';

/**
 * MOTIS JSON transport built on Node's `http`/`https` clients.
 *
 * Why this exists (ruling R37)
 * ----------------------------
 * The default transport used to be Node's global `fetch`, whose bundled undici
 * kills the whole API process when MOTIS closes a keep-alive connection while a
 * response is being parsed:
 *
 * ```
 * AssertionError [ERR_ASSERTION]: false == true
 *     at Parser.finish (node:internal/deps/undici/undici)
 *     at Socket.onHttpSocketEnd (node:internal/deps/undici/undici)
 * ```
 *
 * A heavy `/plan` fans out to three MOTIS calls (base, shifted, direct-only) and
 * reproduced it on the first request against the live NCR build. The fix is the
 * boring one: no connection reuse, so there is no pooled parser to assert on.
 * Every request opens its own socket, sends `Connection: close`, and reads the
 * response to completion before resolving.
 *
 * The transport keeps the Task 4 injectable seam: `buildApp` decorates
 * `motisFetch` with this function by default and tests still inject fixtures.
 *
 * Responses are shaped like the small `ResponseLike` subset `motis-client.ts`
 * consumes (`ok`, `status`, `json()`, `text()`), not like a full `fetch`
 * `Response`.
 */

/** Cap on a MOTIS response body; a runaway body must not exhaust memory. */
const MAX_BODY_BYTES = 32 * 1024 * 1024;

/** Minimal response surface the MOTIS client decodes. */
export interface HttpJsonResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

function responseFor(status: number, body: string): HttpJsonResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json(): Promise<unknown> {
      return JSON.parse(body) as unknown;
    },
    async text(): Promise<string> {
      return body;
    },
  };
}

/**
 * Perform one HTTP(S) request with no connection reuse and resolve with a
 * `ResponseLike` object.
 *
 * Args:
 *   url: absolute `http:`/`https:` URL.
 *   init: `method`, `headers` and an optional `signal` are honoured; the signal
 *     is how `motis-client` enforces its per-attempt timeout.
 *
 * Raises:
 *   TypeError: the URL is not absolute or not http(s).
 *   Error: the socket fails, the request is aborted, or the body exceeds
 *     {@link MAX_BODY_BYTES}.
 */
export const httpJsonFetch: FetchLike = (url, init = {}) => {
  const target = new URL(url);
  const transport =
    target.protocol === 'https:'
      ? httpsRequest
      : target.protocol === 'http:'
        ? httpRequest
        : undefined;
  if (transport === undefined) {
    return Promise.reject(
      new TypeError(`MOTIS transport only speaks http(s), got ${target.protocol}`),
    );
  }

  const headers: Record<string, string> = {
    accept: 'application/json',
    // The crash is a pooled-parser assertion; one socket per request means no
    // pool. The explicit header documents the intent to MOTIS as well.
    connection: 'close',
  };
  if (init.headers !== undefined) {
    for (const [name, value] of Object.entries(
      init.headers as Record<string, string>,
    )) {
      headers[name.toLowerCase()] = String(value);
    }
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (action: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      action();
    };

    const request = transport(
      target,
      {
        method: init.method ?? 'GET',
        headers,
        // No shared agent: this is the keep-alive pool that undici crashed on.
        agent: false,
        signal: init.signal ?? undefined,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) {
            settle(() =>
              reject(
                new Error(
                  `MOTIS response from ${url} exceeded ${MAX_BODY_BYTES} bytes`,
                ),
              ),
            );
            request.destroy();
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          settle(() =>
            resolve(
              responseFor(
                response.statusCode ?? 0,
                Buffer.concat(chunks).toString('utf8'),
              ),
            ),
          );
        });
        response.on('error', (error) => settle(() => reject(error)));
      },
    );

    request.on('error', (error) => settle(() => reject(error)));
    request.end();
  });
};
