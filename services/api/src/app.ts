import Fastify, { type FastifyInstance } from 'fastify';
import { loadProvenance, resolveDataDir } from '@biyahey/shared/provenance';
import { registerErrorHandler } from './errors.js';
import { registerFaresRoutes } from './routes/fares.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerPlanRoutes } from './routes/plan.js';
import { registerSearchRoutes } from './routes/search.js';
import { registerSourcesRoutes } from './routes/sources.js';
import { httpJsonFetch } from './routing/http-json.js';

/** Minimal injectable HTTP transport; see `httpJsonFetch` for the default. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<unknown>;

/** Options accepted by {@link buildApp}. */
export interface BuildAppOptions {
  /** Repository `data/` directory; defaults to the one the loader resolves. */
  dataDir?: string;
  /** MOTIS transport; defaults to the Node `http`/`https` JSON client (R37). */
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
 * boot, and `motisFetch` defaults to the Node `http`/`https` client rather than
 * global `fetch`: undici's pooled parser asserts (and kills the process) when
 * MOTIS closes a keep-alive connection mid-response (ruling R37). A caller can
 * still inject a transport, which is what the unit tests do.
 */
export function buildApp(opts: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const dataDir = opts.dataDir ?? resolveDataDir();
  const sources = loadProvenance(opts.dataDir);
  app.decorate('motisFetch', opts.motisFetch ?? httpJsonFetch);
  registerErrorHandler(app);
  registerHealthRoutes(app);
  registerSourcesRoutes(app, sources);
  registerFaresRoutes(app);
  registerSearchRoutes(app);
  // Pass the same registry `/sources` serves, so plan validation and provenance
  // rows always describe the active data directory.
  registerPlanRoutes(app, dataDir, sources);
  return app;
}
