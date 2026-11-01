import type { HttpHandler } from 'msw';

// Handler list for the BFF contract (R40). Later tasks append handlers for
// `/search`, `/plan`, `/sources` and `/fares/quote`.
export const handlers: HttpHandler[] = [];
