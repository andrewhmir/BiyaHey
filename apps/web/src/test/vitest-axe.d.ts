import 'vitest';

// Vitest 5's assert types are generic over the assertion return type; augment
// them here because vitest-axe 0.1.0 still targets the old `Vi` namespace.
declare module 'vitest' {
  interface Assertion<R extends void | Promise<void> = void> {
    toHaveNoViolations(): R;
  }

  interface AsymmetricMatchersContaining {
    toHaveNoViolations(): void;
  }
}
