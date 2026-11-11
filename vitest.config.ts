import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // One Node project: the shared package and the BFF are plain TypeScript,
    // and the web app has no DOM tests (its browser flows live in Playwright).
    environment: 'node',
    include: ['packages/**/*.test.ts', 'services/**/*.test.ts', 'apps/web/src/**/*.test.ts'],
    // `integration` marks suites that talk to a running stack over HTTP.
    // `npm test` filters them out with `--tagsFilter=!integration`; run them
    // deliberately with `npm run test:integration` once the compose stack is up.
    tags: [
      {
        name: 'integration',
        description: 'talks to a running stack (needs API_URL and/or MOTIS_URL)',
      },
    ],
  },
});
