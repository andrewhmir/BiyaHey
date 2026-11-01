import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';
// vitest-axe 0.1.0's `extend-expect` entry is empty and its `matchers` barrel
// is type-only, so the runtime matcher comes straight from the dist module.
import { toHaveNoViolations } from 'vitest-axe/dist/matchers.js';
import { server } from './msw/server';

// vitest-axe still targets the pre-Vitest-5 `Vi` namespace; register the
// matcher here and augment Vitest's types in `vitest-axe.d.ts`.
expect.extend({ toHaveNoViolations });

// The API is mocked for every test; a test that hits the network without a
// handler fails loudly instead of leaking a real request (R40). MSW 3 renamed
// `onUnhandledRequest` to `onUnhandledFrame`.
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));

afterEach(() => {
  cleanup();
  server.resetHandlers();
});

afterAll(() => server.close());
