import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, expect, vi } from 'vitest';
// vitest-axe 0.1.0's `extend-expect` entry is empty and its `matchers` barrel
// is type-only, so the runtime matcher comes straight from the dist module.
import { toHaveNoViolations } from 'vitest-axe/dist/matchers.js';
import { resetMapLibreMock } from './mocks/maplibre';
import { server } from './msw/server';

// jsdom has no WebGL, so every suite gets the MapLibre double (R42). Without
// this, rendering `Home` in an unrelated test would construct a real map and
// fetch the OpenFreeMap style over the network.
vi.mock('maplibre-gl', async () => {
  const { mockMapLibre } = await import('./mocks/maplibre');
  return { ...mockMapLibre, default: mockMapLibre };
});

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
  resetMapLibreMock();
});

afterAll(() => server.close());
