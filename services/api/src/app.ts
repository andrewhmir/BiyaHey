import Fastify, { type FastifyInstance } from 'fastify';
import { loadProvenance } from '@biyahey/shared/provenance';
import { registerErrorHandler } from './errors.js';
import { registerFaresRoutes } from './routes/fares.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerSourcesRoutes } from './routes/sources.js';

/** Minimal injectable HTTP transport; Node's `fetch` satisfies it. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<unknown>;

/** Options accepted by {@link buildApp}. */
export interface BuildAppOptions {
  /** Repository `data/` directory; defaults to the one the loader resolves. */
  dataDir?: string;
  /** MOTIS transport, reserved for Task 10; Task 4 never calls it. */
  motisFetch?: FetchLike;
}

declare module 'fastify' {
  interface FastifyInstance {
    motisFetch: FetchLike;
  }
}

/**
 * Build the Fastify BFF.
 *
 * The provenance registry is loaded up front so a bad data directory fails at
 * boot, and the `motisFetch` slot is decorated now (ruling R7) so Task 10 can
 * inject a MOTIS transport without changing this signature.
 */
export function buildApp(opts: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const sources = loadProvenance(opts.dataDir);
  app.decorate('motisFetch', opts.motisFetch ?? fetch);
  registerErrorHandler(app);
  registerHealthRoutes(app);
  registerSourcesRoutes(app, sources);
  registerFaresRoutes(app);
  return app;
}
