import type { FastifyInstance } from 'fastify';

/** Liveness probe used by the compose healthcheck (spec §12). */
export function registerHealthRoutes(app: FastifyInstance): void {
  app.get('/health', async () => ({ status: 'ok' as const }));
}
