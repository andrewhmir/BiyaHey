import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { DataSource, SourceId } from '@biyahey/shared/provenance';

/**
 * Shared HTTP-cache policy for the two deploy-static registry GETs
 * (`/sources` here and `/fares/status` in fares.ts).
 *
 * The provenance rows and the fare matrix's effectivity date change only when
 * the service is redeployed with new data, so browsers may reuse a response
 * for a minute and serve it for up to five more while revalidating in the
 * background. `/fares/status` builds an identical validator the same way so
 * both routes behave consistently.
 */
export const REGISTRY_CACHE_CONTROL = 'public, max-age=60, stale-while-revalidate=300';

/**
 * One weak validator for a byte-identical JSON body.
 *
 * Weak (`W/`) because a shared cache or reverse proxy in front of the BFF may
 * compress the same representation; hashing the serialized body keeps the
 * validator stable across requests regardless of framing.
 */
export function weakEtag(payload: string): string {
  return `W/"${createHash('sha256').update(payload).digest('base64url')}"`;
}

/**
 * RFC 9110 `If-None-Match` check with weak comparison, so an intermediary that
 * forwards `"<hash>"` (or a browser re-sending a list / `*`) still revalidates.
 */
export function ifNoneMatchHits(header: string | string[] | undefined, etag: string): boolean {
  if (header === undefined) return false;
  const candidates = Array.isArray(header) ? header.join(',') : header;
  const opaque = (tag: string): string => tag.trim().replace(/^W\//, '');
  const ours = opaque(etag);
  return candidates.split(',').some((candidate) => {
    const value = candidate.trim();
    return value === '*' || opaque(value) === ours;
  });
}

/** Serve the provenance registry in canonical registry order (spec §8.5). */
export function registerSourcesRoutes(
  app: FastifyInstance,
  sources: Map<SourceId, DataSource>,
): void {
  // The registry is loaded at boot and never mutated, so the serialized body and
  // its validator are computed once instead of on every request.
  const payload = JSON.stringify([...sources.values()]);
  const etag = weakEtag(payload);

  app.get('/sources', async (request, reply) => {
    reply.header('cache-control', REGISTRY_CACHE_CONTROL);
    reply.header('etag', etag);
    if (ifNoneMatchHits(request.headers['if-none-match'], etag)) {
      // Status only: an async handler returning after this sends no body, and
      // Fastify keeps the ETag/Cache-Control headers on the 304.
      reply.code(304);
      return;
    }
    // A pre-serialized JSON string is sent byte-identically, which is what the
    // ETag above promises; Fastify only adds the content type we set here.
    reply.type('application/json; charset=utf-8');
    return payload;
  });
}
