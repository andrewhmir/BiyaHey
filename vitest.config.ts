import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `integration` marks suites that talk to an already-running stack over HTTP
    // (`golden.test.ts` needs API_URL, `motis-live.test.ts` needs MOTIS_URL).
    // The root `test` script filters them out with `--tagsFilter=!integration`,
    // so `npm test` / `npm run ci` stay offline even when the caller's shell
    // exports either URL; run them deliberately with `npm run test:integration`.
    tags: [
      {
        name: 'integration',
        description: 'talks to a running stack (needs API_URL and/or MOTIS_URL)',
      },
    ],
    // Two projects share one root config: the Plan 1 packages in Node and the
    // PWA in jsdom (RTL needs a DOM; the app's tests are `*.test.tsx`).
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['packages/**/*.test.ts', 'services/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'web',
          environment: 'jsdom',
          globals: true,
          include: ['apps/web/src/**/*.test.{ts,tsx}'],
          setupFiles: ['./apps/web/src/test/setup.ts'],
        },
      },
    ],
  },
});
