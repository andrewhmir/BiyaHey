import { describe, expect, it } from 'vitest';
import { TOOLCHAIN_OK } from './index';

describe('toolchain', () => {
  it('exposes the shared marker', () => expect(TOOLCHAIN_OK).toBe(true));
});
