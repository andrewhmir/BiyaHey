import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
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

/**
 * Browser origins allowed to call the BFF when `CORS_ORIGINS` is unset.
 *
 * Vite's dev server serves the PWA on port 5173. Both spellings are listed
 * because a browser treats `localhost` and `127.0.0.1` as different origins.
 */
export const DEFAULT_CORS_ORIGINS: readonly string[] = Object.freeze([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

/**
 * Parse `CORS_ORIGINS` (comma-separated) or fall back to the localhost PWA.
 *
 * An empty/blank value means "use the defaults", not "deny every browser".
 */
export function corsOriginsFromEnv(value: string | undefined): string[] {
  const configured = (value ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  return configured.length > 0 ? configured : [...DEFAULT_CORS_ORIGINS];
}

/** Options accepted by {@link buildApp}. */
export interface BuildAppOptions {
  /** Repository `data/` directory; defaults to the one the loader resolves. */
  dataDir?: string;
  /** MOTIS transport; defaults to the Node `http`/`https` JSON client (R37). */
  motisFetch?: FetchLike;
  /**
   * Browser origins allowed to call this API (CORS). Defaults to the
   * `CORS_ORIGINS` environment variable, then {@link DEFAULT_CORS_ORIGINS}.
   */
  corsOrigins?: readonly string[];
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
 *
 * CORS is registered for the PWA's dev origin(s) only (spec §7: the browser
 * calls `api:8787` from `web:5173`). The default has no wildcard and no
 * credentials, so a random web page cannot read `/plan` responses; a deployment
 * sets `CORS_ORIGINS` to its real web origin.
 */
export function buildApp(opts: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const dataDir = opts.dataDir ?? resolveDataDir();
  const sources = loadProvenance(opts.dataDir);
  const corsOrigins = new Set(opts.corsOrigins ?? corsOriginsFromEnv(process.env.CORS_ORIGINS));
  app.decorate('motisFetch', opts.motisFetch ?? httpJsonFetch);
  // Registered synchronously; Fastify loads the plugin on `ready`/`listen`/`inject`.
  app.register(cors, {
    origin: (origin, callback) => callback(null, origin === undefined || corsOrigins.has(origin)),
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    maxAge: 600,
  });
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
