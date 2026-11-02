import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { httpJsonFetch } from '../src/routing/http-json.js';

/**
 * Tests for the R37 MOTIS transport.
 *
 * The production failure mode was undici's pooled parser asserting when MOTIS
 * closed a keep-alive connection. These tests pin the replacement's contract:
 * one socket per request (`Connection: close`), JSON decoding, status passthrough
 * and abort handling. The live `Parser.finish` crash itself is proved by the
 * repeated heavy-plan stress run in `docs/runbooks/phase1-acceptance.md`, because
 * it can only occur against a real router.
 */

interface RecordedRequest {
  url: string;
  connection: string | undefined;
}

let server: Server;
let baseUrl: string;
const requests: RecordedRequest[] = [];

function handler(request: IncomingMessage, response: ServerResponse): void {
  requests.push({ url: request.url ?? '', connection: request.headers.connection });
  if (request.url === '/ok') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ itineraries: [{ duration: 900 }] }));
    return;
  }
  if (request.url === '/not-json') {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('this is not json');
    return;
  }
  if (request.url === '/slow') {
    // Deliberately outlive the abort below.
    setTimeout(() => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"late":true}');
    }, 2_000);
    return;
  }
  response.writeHead(404, { 'content-type': 'text/plain' });
  response.end('not found');
}

beforeAll(async () => {
  server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error))),
  );
});

describe('httpJsonFetch', () => {
  it('decodes a 200 JSON body and asks for a closed connection', async () => {
    requests.length = 0;
    const raw = (await httpJsonFetch(`${baseUrl}/ok`)) as {
      ok: boolean;
      status: number;
      json(): Promise<unknown>;
    };

    expect(raw.ok).toBe(true);
    expect(raw.status).toBe(200);
    await expect(raw.json()).resolves.toEqual({ itineraries: [{ duration: 900 }] });
    expect(requests[0].connection).toBe('close');
  });

  it('passes a non-2xx status through with its text body', async () => {
    const raw = (await httpJsonFetch(`${baseUrl}/missing`)) as {
      ok: boolean;
      status: number;
      text(): Promise<string>;
    };

    expect(raw.ok).toBe(false);
    expect(raw.status).toBe(404);
    await expect(raw.text()).resolves.toBe('not found');
  });

  it('rejects json() when the body is not JSON', async () => {
    const raw = (await httpJsonFetch(`${baseUrl}/not-json`)) as {
      json(): Promise<unknown>;
    };
    await expect(raw.json()).rejects.toBeInstanceOf(SyntaxError);
  });

  it('honours the abort signal the MOTIS client uses for its timeout', async () => {
    const controller = new AbortController();
    const pending = httpJsonFetch(`${baseUrl}/slow`, { signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects a non-http(s) URL instead of guessing a transport', async () => {
    await expect(httpJsonFetch('ftp://example.invalid/plan')).rejects.toThrow(
      /only speaks http\(s\)/,
    );
  });
});
