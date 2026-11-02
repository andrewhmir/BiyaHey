import { describe, expect, it } from 'vitest';
import { TOOLCHAIN_OK } from './index.js';

describe('toolchain', () => {
  it('exposes the shared marker', () => expect(TOOLCHAIN_OK).toBe(true));
});
