// Browser-safe barrel: keep this file free of Node-only imports so the PWA can
// bundle `@biyahey/shared`. Node-only helpers live at `@biyahey/shared/provenance`.
export * from './domain.js';
export * from './fares.js';
export * from './types.js';

export const TOOLCHAIN_OK = true;
