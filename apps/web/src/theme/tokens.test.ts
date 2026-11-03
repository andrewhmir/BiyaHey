import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Design-token wiring and identity regression.
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
 * UX v2 additionally pins the Kalsada palette values (so a stray edit cannot
 * quietly revert the approved identity) and computes WCAG contrast for the
 * pairs the review cares about instead of trusting the old values.
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

/** Read one hex-valued role from the light `:root` block. */
function lightRole(role: string): string {
  const match = lightRoot.match(new RegExp(`^\\s{2}--${role}:\\s*(#[0-9a-f]{6});`, 'im'));
  if (match === null) throw new Error(`token --${role} not found in tokens.css`);
  return match[1]!;
}

/** Read the internal dark palette value (`--_dark-<name>`). */
function darkRole(name: string): string {
  const match = tokensCss.match(new RegExp(`^\\s{2}--_dark-${name}:\\s*(#[0-9a-f]{6});`, 'im'));
  if (match === null) throw new Error(`token --_dark-${name} not found in tokens.css`);
  return match[1]!;
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const raw = hex.replace('#', '');
  const r = Number.parseInt(raw.slice(0, 2), 16);
  const g = Number.parseInt(raw.slice(2, 4), 16);
  const b = Number.parseInt(raw.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

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

  it('pins the approved Kalsada identity values', () => {
    expect(lightRole('surface')).toBe('#f4f6f3');
    expect(lightRole('surface-container-lowest')).toBe('#ffffff');
    expect(lightRole('on-surface')).toBe('#0b1d24');
    expect(lightRole('primary')).toBe('#0e7c7b');
    expect(lightRole('fare-bg')).toBe('#fff1c9');
    expect(lightRole('inverse-surface')).toBe('#0b1d24');
    expect(tokensCss).toContain('--shape-medium: 20px;');
    expect(tokensCss).toContain('--shape-large: 28px;');
  });

  it('keeps the text/background pairs readable (WCAG 2.2 AA)', () => {
    const pairs: [string, string, string][] = [
      ['on-surface', 'surface', 'body text on canvas'],
      ['on-surface-variant', 'surface', 'secondary text on canvas'],
      ['on-surface', 'surface-container-lowest', 'body text on cards'],
      ['on-primary', 'primary', 'CTA label on brand'],
      ['on-primary-container', 'primary-container', 'selected tint text'],
      ['on-fare-bg', 'fare-bg', 'fare text on fare surface'],
      ['on-tertiary-container', 'tertiary-container', 'staleness banner text'],
      ['inverse-on-surface', 'inverse-surface', 'active chip text'],
      ['on-secondary-container', 'secondary-container', 'quiet chip text'],
    ];
    for (const [fg, bg, label] of pairs) {
      const ratio = contrast(lightRole(fg), lightRole(bg));
      expect(ratio, `${label}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps the dark scheme readable', () => {
    const pairs: [string, string, string][] = [
      ['on-surface', 'surface', 'dark body text'],
      ['on-surface-variant', 'surface', 'dark secondary text'],
      ['on-primary', 'primary', 'dark CTA label'],
      ['on-fare-bg', 'fare-bg', 'dark fare text'],
    ];
    for (const [fg, bg, label] of pairs) {
      const ratio = contrast(darkRole(fg), darkRole(bg));
      expect(ratio, `${label}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
