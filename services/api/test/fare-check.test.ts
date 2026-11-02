import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * End-to-end tests for the `npm run check:fares` CI gate (spec §8.3).
 *
 * The script is plain Node (CI runs it without compiling TypeScript), so it is
 * exercised through its real CLI rather than imported. `--today` makes the
 * 183-day boundary deterministic; the dates mirror `isFareStale`'s rule:
 * 183 days is still fresh, 184 is stale.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const script = join(repoRoot, 'scripts', 'check-fares.mjs');

function checkFares(today: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [script, `--today=${today}`], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('npm run check:fares', () => {
  it('passes on the 183-day boundary and names the matrix', () => {
    const result = checkFares('2027-03-30');
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('ltfrb-puv-2026-09-28');
    expect(result.stdout).toContain('fresh');
    expect(result.stdout).toContain('183 days');
  });

  it('fails one day past the boundary', () => {
    const result = checkFares('2027-03-31');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('FAIL');
    expect(result.stderr).toContain('183 days');
  });

  it('passes on the recorded review date 2026-11-01', () => {
    const result = checkFares('2026-11-01');
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('fresh');
  });

  it('rejects an impossible date with exit code 2', () => {
    const result = checkFares('2027-02-30');
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('not a real calendar date');
  });
});
