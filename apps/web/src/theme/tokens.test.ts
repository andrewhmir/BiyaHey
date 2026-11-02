import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Design-token wiring regression (I1).
 *
 * The Task 9 review found `--on-tertiary-container` defined in `tokens.css` and
 * used by three status/staleness banners (`text-on-tertiary-container`) but never
 * mapped in the Tailwind `colors` block. Tailwind only emits utilities for theme
 * colours, so `.text-on-tertiary-container` was absent from the built CSS and the
 * banners silently inherited `--on-surface`.
 *
 * This test keeps the two halves in sync without needing a build: every public
 * colour role defined in `tokens.css` must be mapped in `tailwind.config.js`, and
 * every Tailwind colour must point at a defined token. A colour role added to one
 * side only fails here instead of shipping an inert utility.
 *
 * The built-artefact check (`.text-on-tertiary-container` present in
 * `dist/assets/index-*.css`) still belongs to `npm run build`, which the fix
 * round recorded in the Task 9 report.
 */

function read(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

const tokensCss = read('./tokens.css');
const tailwindConfig = read('../../tailwind.config.js');

/**
 * Public colour roles: hex-valued custom properties in the light `:root` block.
 * The internal `--_dark-*` palette is excluded by the leading-underscore rule,
 * and the non-colour tokens (type, spacing, shape, elevation) by the hex guard.
 */
const lightRoot = tokensCss.slice(
  tokensCss.indexOf(':root {'),
  tokensCss.indexOf('@media (prefers-color-scheme: dark)'),
);
const colourRoles = [...lightRoot.matchAll(/^\s{2}--([a-z][a-z0-9-]*):\s*#[0-9a-f]{3,8};/gim)].map(
  (match) => match[1]!,
);

/** `colors: { <utility>: 'var(--<token>)' }` entries from the Tailwind config. */
const coloursBlock = tailwindConfig.slice(
  tailwindConfig.indexOf('colors: {'),
  tailwindConfig.indexOf('borderRadius:'),
);
const mappedColours = [
  ...coloursBlock.matchAll(/'?([a-z][a-z0-9-]*)'?:\s*'var\(--([a-z0-9-]+)\)'/g),
].map((match) => ({ utility: match[1]!, token: match[2]! }));

describe('design-token wiring', () => {
  it('maps every colour role in tokens.css to a Tailwind colour', () => {
    expect(colourRoles.length).toBeGreaterThan(20);
    const mappedTokens = new Set(mappedColours.map((entry) => entry.token));
    for (const role of colourRoles) {
      expect(mappedTokens.has(role), `--${role} is not mapped in tailwind.config.js`).toBe(true);
    }
  });

  it('points every Tailwind colour at a token defined in tokens.css', () => {
    const definedRoles = new Set(colourRoles);
    for (const { utility, token } of mappedColours) {
      expect(definedRoles.has(token), `colors.${utility} points at undefined --${token}`).toBe(
        true,
      );
    }
    // Guard against the parser silently matching nothing.
    expect(mappedColours.length).toBe(colourRoles.length);
  });

  it('wires the on-tertiary-container contrast role in light and dark', () => {
    expect(colourRoles).toContain('on-tertiary-container');
    expect(mappedColours).toContainEqual({
      utility: 'on-tertiary-container',
      token: 'on-tertiary-container',
    });
    // Both dark entry points (OS preference and `data-theme="dark"`) map it.
    expect(
      tokensCss.match(/--on-tertiary-container: var\(--_dark-on-tertiary-container\);/g),
    ).toHaveLength(2);
  });
});
