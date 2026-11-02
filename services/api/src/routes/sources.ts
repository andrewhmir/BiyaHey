import type { FastifyInstance } from 'fastify';
import type { DataSource, SourceId } from '@biyahey/shared/provenance';

/** Serve the provenance registry in canonical registry order (spec §8.5). */
export function registerSourcesRoutes(
  app: FastifyInstance,
  sources: Map<SourceId, DataSource>,
): void {
  app.get('/sources', async () => [...sources.values()]);
}
