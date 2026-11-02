#!/usr/bin/env node
/**
 * Local-first entry point: boot the computer-side stack (spec §7).
 *
 * `npm run dev` starts the two computer-side services — MOTIS (`routing`, port
 * 8080) and the Fastify BFF (`api`, port 8787) — through Docker Compose and
 * waits for both healthchecks. The PWA (`web`, port 5173) runs from the host and
 * is started separately with `npm run dev --workspace @biyahey/web`; its origin
 * is already in the API's CORS allow-list.
 *
 * Prerequisites: Docker is running and the data build has produced
 * `data/build/gtfs/gtfs.zip` (see docs/runbooks/data-build.md). Both are checked
 * before compose runs so a missing build fails with the command that fixes it.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';
const docker = isWindows ? 'docker.exe' : 'docker';

function fail(message) {
  console.error(`dev: ${message}`);
  process.exit(1);
}

for (const [label, path] of [
  ['provenance registry', join(repoRoot, 'data', 'provenance', 'sources.yaml')],
  ['built GTFS feed', join(repoRoot, 'data', 'build', 'gtfs', 'gtfs.zip')],
]) {
  if (!existsSync(path)) {
    fail(
      `missing ${label} at ${path}. Run \`npm run data:build\` first ` +
        '(docs/runbooks/data-build.md).',
    );
  }
}

console.log('dev: bringing up routing + api (detached, waiting for health)...');
const compose = spawnSync(docker, ['compose', 'up', '-d', '--wait', 'routing', 'api'], {
  cwd: repoRoot,
  stdio: 'inherit',
});
if (compose.status !== 0) {
  fail(`docker compose exited with ${compose.status ?? 'no status'}`);
}

console.log(`
dev: stack is up
  routing  http://localhost:8080   (MOTIS)
  api      http://localhost:8787   (BFF: /health, /sources, /search, /plan, /fares/quote, /fares/status)
  web      npm run dev --workspace @biyahey/web → http://localhost:5173
           (Vite dev server, separate terminal; origin already CORS-allowed)

Next:
  npm run test:e2e          # Playwright against this stack (builds the PWA first)
  npm run verify:phase2     # phase-2 acceptance (performance recorded PARTIAL)
  docker compose logs -f api # if /health is not ready
  docker compose down        # stop the stack
`);
