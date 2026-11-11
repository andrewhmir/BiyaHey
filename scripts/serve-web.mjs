#!/usr/bin/env node
/**
 * Production preview server for the BiyaHey! PWA.
 *
 * `vite preview` serves the built `dist/` but does not compress, does not send
 * long-lived cache headers for hashed assets, and has no `/api` proxy — which
 * is exactly the difference between an 18 MB Vite dev payload and a ~350 KB
 * brotli shell. This server is the "fast path" the phone/tablet opens:
 *
 *   - brotli (q11) + gzip (9) for every text asset, computed once and cached;
 *   - `cache-control: immutable` for content-hashed assets so a reload costs
 *     nothing, `no-cache` for index.html / sw.js / the map style;
 *   - a same-origin `/api/*` -> BFF reverse proxy (so the build inlines
 *     `VITE_API_URL=/api` and the browser never needs CORS or a second origin);
 *   - SPA history fallback, ETag/304 revalidation, a `/__health` probe;
 *   - `--watch` keeps the served build current (`tsc -b && vite build --watch`),
 *     so this can replace the dev server on the tailnet while costing a
 *     fraction of its bytes.
 *
 * Usage (from the repository root):
 *
 *   node scripts/serve-web.mjs                 # build once, serve :8099
 *   node scripts/serve-web.mjs --watch         # rebuild on source changes
 *   node scripts/serve-web.mjs --no-build --port 8099
 *
 * Options:
 *   --port <n>      listen port (default 8099 — the tailnet serve root points here)
 *   --host <addr>   listen address (default 127.0.0.1)
 *   --root <dir>    static root (default apps/web/dist)
 *   --api <url>     BFF origin proxied at /api (default http://127.0.0.1:8787)
 *   --no-build      serve the existing dist/ without building first
 *   --watch         keep `vite build --watch` running and rebuild on changes
 *   --verbose       log every request
 */
import { spawn } from 'node:child_process';
import { readFile, readdir, stat, unlink } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompress, gzip, constants as zlibConstants } from 'node:zlib';
import { promisify } from 'node:util';

const brotli = promisify(brotliCompress);
const gzipAsync = promisify(gzip);
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};
const COMPRESSIBLE = new Set([
  '.html',
  '.js',
  '.mjs',
  '.css',
  '.json',
  '.webmanifest',
  '.svg',
  '.txt',
  '.map',
]);
const IMMUTABLE = /[-.][A-Za-z0-9_-]{8,}\.(?:js|mjs|css|woff2|png|svg|webp|jpg)$/;
/** Files that must revalidate so a new build is picked up (and the SW can update). */
const REVALIDATE = new Set([
  '/index.html',
  '/sw.js',
  '/registerSW.js',
  '/manifest.webmanifest',
  '/map/style.json',
]);
const BROTLI_OPTIONS = {
  params: {
    [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
    [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
  },
};

function parseArgs(argv) {
  const options = {
    port: 8099,
    host: '127.0.0.1',
    root: join(REPO_ROOT, 'apps', 'web', 'dist'),
    api: 'http://127.0.0.1:8787',
    build: true,
    watch: false,
    verbose: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${arg} needs a value`);
      return argv[index];
    };
    if (arg === '--port') options.port = Number(next());
    else if (arg === '--host') options.host = next();
    else if (arg === '--root') options.root = resolve(REPO_ROOT, next());
    else if (arg === '--api') options.api = next();
    else if (arg === '--no-build') options.build = false;
    else if (arg === '--watch') options.watch = true;
    else if (arg === '--verbose') options.verbose = true;
    else if (arg === '--help' || arg === '-h') {
      console.log('node scripts/serve-web.mjs [--port 8099] [--watch] [--no-build] [--verbose]');
      process.exit(0);
    } else throw new Error(`unknown option ${arg}`);
  }
  if (!Number.isInteger(options.port) || options.port <= 0) throw new Error('--port must be a port');
  return options;
}

/** Content-hash immutable assets get a year; revalidating files get no-cache. */
function cacheControlFor(pathname, file) {
  if (REVALIDATE.has(pathname) || pathname === '/' || file.endsWith('sw.js')) return 'no-cache';
  if (IMMUTABLE.test(pathname)) return 'public, max-age=31536000, immutable';
  return 'public, max-age=604800';
}

/**
 * Per-file compression cache keyed by the file's mtime+size, so a watch-mode
 * rebuild invalidates exactly the files that changed and nothing is compressed
 * twice for the same build.
 */
class CompressionCache {
  constructor() {
    this.entries = new Map();
  }

  async get(file) {
    const info = await stat(file);
    const key = `${info.mtimeMs}:${info.size}`;
    const cached = this.entries.get(file);
    if (cached !== undefined && cached.key === key) return cached;

    const body = await readFile(file);
    const extension = extname(file);
    let br = null;
    let gz = null;
    if (COMPRESSIBLE.has(extension)) {
      const [brBody, gzBody] = await Promise.all([brotli(body, BROTLI_OPTIONS), gzipAsync(body, { level: 9 })]);
      br = brBody;
      gz = gzBody;
    }
    const entry = { key, body, br, gz, mtimeMs: info.mtimeMs, size: info.size };
    this.entries.set(file, entry);
    return entry;
  }

  /** Compress every text file in the build up front so the first request is fast. */
  async warm(root) {
    const walk = async (directory) => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const full = join(directory, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (COMPRESSIBLE.has(extname(entry.name))) await this.get(full);
      }
    };
    await walk(root);
  }
}

function pickEncoding(request, entry) {
  const accepted = String(request.headers['accept-encoding'] ?? '');
  if (entry.br !== null && /\bbr\b/.test(accepted)) return { body: entry.br, encoding: 'br' };
  if (entry.gz !== null && /\bgzip\b/.test(accepted)) return { body: entry.gz, encoding: 'gzip' };
  return { body: entry.body, encoding: null };
}

function etagFor(entry) {
  return `W/"${entry.size.toString(16)}-${Math.round(entry.mtimeMs).toString(16)}"`;
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length === 0 ? undefined : Buffer.concat(chunks);
}

const compressionCache = new CompressionCache();

async function serveStatic(request, response, pathname, options) {
  let file = normalize(join(options.root, pathname));
  if (!file.startsWith(options.root + sep) && file !== options.root) {
    response.writeHead(403, { 'content-type': 'text/plain' });
    response.end('forbidden');
    return;
  }

  let info;
  try {
    info = await stat(file);
    if (info.isDirectory()) {
      file = join(file, 'index.html');
      info = await stat(file);
    }
  } catch {
    const isNavigation = request.method === 'GET' && pathname === '/';
    const looksLikeFile = extname(pathname) !== '';
    if (isNavigation || !looksLikeFile) {
      file = join(options.root, 'index.html');
      info = await stat(file);
    } else {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      response.end('not found');
      return;
    }
  }

  const entry = await compressionCache.get(file);
  const requestedPath = file === join(options.root, 'index.html') ? '/index.html' : pathname;
  const headers = {
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    'cache-control': cacheControlFor(requestedPath, file),
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    etag: etagFor(entry),
    vary: 'accept-encoding',
  };

  if (request.headers['if-none-match'] === headers.etag) {
    response.writeHead(304, headers);
    response.end();
    return;
  }

  const { body, encoding } = pickEncoding(request, entry);
  if (encoding !== null) headers['content-encoding'] = encoding;
  headers['content-length'] = body.length;
  response.writeHead(200, headers);
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  response.end(body);
}

/** Same-origin `/api/*` proxy: strip the prefix, stream the reply, compress JSON. */
async function proxyApi(request, response, options, pathname, search) {
  const target = new URL(`${options.api}${pathname.slice('/api'.length)}${search}`);
  const body = await readRequestBody(request);
  const headers = { ...request.headers, host: target.host };
  delete headers['accept-encoding'];
  headers.connection = 'close';

  const transport = target.protocol === 'https:' ? httpsRequest : httpRequest;
  const upstream = await new Promise((resolvePromise, rejectPromise) => {
    const outgoing = transport(
      target,
      { method: request.method, headers, timeout: 30_000 },
      (upstreamResponse) => resolvePromise(upstreamResponse),
    );
    outgoing.on('timeout', () => rejectPromise(new Error('upstream timeout')));
    outgoing.on('error', rejectPromise);
    if (body !== undefined) outgoing.write(body);
    outgoing.end();
  });

  const chunks = [];
  for await (const chunk of upstream) chunks.push(chunk);
  let payload = Buffer.concat(chunks);
  const contentType = String(upstream.headers['content-type'] ?? 'application/octet-stream');
  const upstreamStatus = upstream.statusCode ?? 502;
  // Validate-get endpoints (registry, fare status) send an ETag: keep it so a
  // browser revalidation becomes a tiny 304 instead of a full 5 KB payload.
  // Everything else keeps no-store (POST /plan must never be cached).
  const upstreamEtag = upstream.headers.etag;
  const responseHeaders = {
    'content-type': contentType,
    'cache-control': upstreamEtag === undefined ? 'no-store' : 'no-cache',
    'x-content-type-options': 'nosniff',
  };
  if (upstreamEtag !== undefined) responseHeaders.etag = upstreamEtag;
  if (upstream.headers['last-modified'] !== undefined) {
    responseHeaders['last-modified'] = upstream.headers['last-modified'];
  }
  if (upstreamStatus === 304) {
    response.writeHead(304, responseHeaders);
    response.end();
    return;
  }
  if (/^(application\/json|text\/)/.test(contentType) && payload.length > 1024) {
    const accepted = String(request.headers['accept-encoding'] ?? '');
    if (/\bbr\b/.test(accepted)) {
      payload = await brotli(payload, BROTLI_OPTIONS);
      responseHeaders['content-encoding'] = 'br';
    } else if (/\bgzip\b/.test(accepted)) {
      payload = await gzipAsync(payload, { level: 9 });
      responseHeaders['content-encoding'] = 'gzip';
    }
    responseHeaders.vary = 'accept-encoding';
  }
  responseHeaders['content-length'] = payload.length;
  response.writeHead(upstreamStatus, responseHeaders);
  response.end(payload);
}

function startBuildWatcher(options) {
  const workspaceArguments = options.watch ? ['run', 'build', '--workspace', '@biyahey/web', '--', '--watch'] : ['run', 'build', '--workspace', '@biyahey/web'];
  const child = spawn('npm', workspaceArguments, {
    cwd: REPO_ROOT,
    // The preview build keeps previous hashed assets on disk (see the prune
    // below): with a watch rebuild every few seconds, emptying dist/ would 404
    // pages that loaded the previous index.html a moment earlier.
    env: { ...process.env, VITE_API_URL: '/api', BIYAHEY_PREVIEW_BUILD: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const relay = (chunk, stream) => {
    for (const line of String(chunk).split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      if (/✓ built in|built in/.test(trimmed)) console.log(`build: ${trimmed.replace(/^.*?built in/, 'built in')}`);
      else if (/error/i.test(trimmed)) stream.write(`build: ${trimmed}\n`);
    }
  };
  child.stdout.on('data', (chunk) => relay(chunk, process.stdout));
  child.stderr.on('data', (chunk) => relay(chunk, process.stderr));
  return {
    child,
    ready: new Promise((resolvePromise) => {
      if (!options.watch) {
        child.on('exit', (code) => {
          if (code === 0) resolvePromise();
          else {
            console.error(`build failed (exit ${code})`);
            process.exitCode = 1;
            resolvePromise();
          }
        });
      } else {
        // Watch mode: the first "built in" line means dist/ is servable.
        let settled = false;
        const onData = (chunk) => {
          if (!settled && /built in/.test(String(chunk))) {
            settled = true;
            child.stdout.off('data', onData);
            resolvePromise();
          }
        };
        child.stdout.on('data', onData);
        child.on('exit', () => {
          if (!settled) {
            settled = true;
            resolvePromise();
          }
        });
      }
    }),
    stop() {
      try {
        child.kill('SIGTERM');
      } catch {
        // already gone
      }
    },
  };
}

/**
 * Watch rebuilds leave the previous build's hashed files behind (emptyOutDir is
 * off for preview builds), which is what keeps a page that loaded one second
 * before the rebuild working. This removes files that are no longer referenced
 * by index.html/sw.js once they have aged past the grace window.
 */
async function pruneStaleBuildFiles(root) {
  let indexHtml;
  try {
    indexHtml = await readFile(join(root, 'index.html'), 'utf8');
  } catch {
    return;
  }
  let serviceWorker = '';
  try {
    serviceWorker = await readFile(join(root, 'sw.js'), 'utf8');
  } catch {
    // first build may not have written the SW yet
  }
  const referenced = new Set();
  const referencePattern = /(?:assets|fonts)\/[A-Za-z0-9_.-]+/g;
  for (const text of [indexHtml, serviceWorker]) {
    for (const match of text.matchAll(referencePattern)) referenced.add(match[0]);
  }
  const graceMs = 10 * 60 * 1000;
  const now = Date.now();
  for (const directory of ['assets', 'fonts']) {
    const full = join(root, directory);
    let entries;
    try {
      entries = await readdir(full, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const relative = `${directory}/${entry.name}`;
      if (referenced.has(relative)) continue;
      const file = join(full, entry.name);
      const info = await stat(file).catch(() => null);
      if (info === null || now - info.mtimeMs < graceMs) continue;
      await unlink(file).catch(() => undefined);
      compressionCache.entries.delete(file);
    }
  }
}

/** Prune after every finished rebuild, detected by index.html changing. */
function startPruneLoop(root) {
  let lastIndexMtime = 0;
  return setInterval(async () => {
    const info = await stat(join(root, 'index.html')).catch(() => null);
    if (info === null || info.mtimeMs === lastIndexMtime) return;
    lastIndexMtime = info.mtimeMs;
    await pruneStaleBuildFiles(root).catch(() => undefined);
  }, 5000);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  let watcher = null;
  // --watch implies building (the watcher's first pass produces dist/); --no-build
  // only skips the separate one-shot build, it never disables an explicit watch.
  if (options.build || options.watch) {
    watcher = startBuildWatcher(options);
    console.log(
      options.watch
        ? 'serve-web: building once, then watching apps/web for changes (VITE_API_URL=/api)…'
        : 'serve-web: building apps/web (VITE_API_URL=/api)…',
    );
    await watcher.ready;
  }

  try {
    await stat(join(options.root, 'index.html'));
  } catch {
    console.error(`serve-web: no build at ${options.root} — run npm run build first, or drop --no-build`);
    process.exit(1);
  }

  // A build made by `npm run build` inlines the dev default (localhost:8787);
  // served through the tailnet that silently breaks every API call. Warn loudly
  // so a stale dist left behind by another build (e2e, CI) cannot hide.
  const assetList = await readdir(join(options.root, 'assets')).catch(() => []);
  for (const asset of assetList) {
    if (!asset.endsWith('.js')) continue;
    const content = await readFile(join(options.root, 'assets', asset), 'utf8').catch(() => '');
    if (content.includes('localhost:8787') || content.includes('127.0.0.1:8787')) {
      console.warn(
        'serve-web: WARNING this build inlines a localhost API URL - run `npm run preview:web:watch` ' +
          '(or delete dist/ and restart) so /api stays same-origin.',
      );
      break;
    }
  }

  console.log('serve-web: compressing the build (brotli q11 + gzip 9)…');
  const warmStarted = Date.now();
  await compressionCache.warm(options.root);
  console.log(`serve-web: assets ready in ${Date.now() - warmStarted} ms`);

  const server = createServer(async (request, response) => {
    const started = Date.now();
    try {
      const parsed = new URL(request.url ?? '/', `http://${options.host}:${options.port}`);
      const pathname = decodeURIComponent(parsed.pathname);
      if (pathname === '/__health') {
        const payload = JSON.stringify({
          ok: true,
          uptimeSeconds: Math.round(process.uptime()),
          dist: options.root,
          api: options.api,
        });
        response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        response.end(payload);
        return;
      }
      if (pathname === '/api' || pathname.startsWith('/api/')) {
        await proxyApi(request, response, options, pathname, parsed.search);
      } else {
        await serveStatic(request, response, pathname, options);
      }
    } catch (error) {
      if (!response.headersSent) {
        response.writeHead(502, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        response.end(JSON.stringify({ error: String(error) }));
      } else {
        response.destroy();
      }
    } finally {
      if (options.verbose) {
        console.log(`${request.method} ${request.url} ${response.statusCode} ${Date.now() - started}ms`);
      }
    }
  });

  const pruneTimer = options.build || options.watch ? startPruneLoop(options.root) : null;
  pruneTimer?.unref?.();

  server.listen(options.port, options.host, () => {
    console.log(`serve-web: http://${options.host}:${options.port}  (dist ${options.root}, /api -> ${options.api})`);
    if (options.watch) console.log('serve-web: watch mode — edits rebuild dist/ automatically');
  });

  const shutdown = () => {
    console.log('\nserve-web: shutting down');
    server.close();
    watcher?.stop();
    if (pruneTimer !== null) clearInterval(pruneTimer);
    setTimeout(() => process.exit(0), 100).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error(`serve-web: ${error instanceof Error ? error.stack : String(error)}`);
  process.exit(1);
});
