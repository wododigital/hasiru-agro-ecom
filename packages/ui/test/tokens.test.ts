import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');
const tokensCss = readFileSync(join(root, 'src/tokens.css'), 'utf8');
const themeCss = readFileSync(join(root, '../../apps/shop/theme.css'), 'utf8');

const REQUIRED = [
  'bg', 'surface', 'surface-2', 'text', 'muted', 'primary', 'primary-fg', 'accent', 'accent-fg',
  'success', 'warning', 'danger', 'border', 'role-main', 'role-host', 'role-biomass',
].map((n) => `--color-${n}`).concat(['--radius-sm', '--radius-md', '--radius-lg', '--font-display', '--font-body', '--shadow-card']);

/** Variables declared in the first block whose selector matches. */
function block(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('\n}', start));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
}

const lum = (hex: string) =>
  [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i]!, 0);
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

const palettes = {
  default: block(tokensCss, '@theme static'),
  admin: block(tokensCss, "[data-surface='admin']"),
  hasiru: block(themeCss, ':root'),
};

describe('design tokens', () => {
  it('defaults define every semantic token', () => {
    for (const t of REQUIRED) expect(palettes.default, t).toHaveProperty(t);
  });

  it('the Hasiru theme sets the plan brand colours', () => {
    expect(palettes.hasiru).toMatchObject({ '--color-primary': '#1b4332', '--color-accent': '#fdc717', '--color-bg': '#faf6e9', '--color-surface-2': '#f0ead6' });
  });

  for (const [name, p] of Object.entries(palettes)) {
    it(`${name} palette text pairs pass WCAG AA (4.5:1)`, () => {
      const c = (k: string) => p[`--color-${k}`] ?? palettes.default[`--color-${k}`]!;
      const pairs: [string, string][] = [
        ['text', 'bg'], ['text', 'surface'], ['text', 'surface-2'], ['muted', 'bg'], ['muted', 'surface'], ['muted', 'surface-2'],
        ['primary', 'bg'], ['primary', 'surface'], ['primary-fg', 'primary'], ['primary-fg', 'primary-hover'], ['accent-fg', 'accent'],
        ['success', 'surface'], ['warning', 'surface'], ['danger', 'surface'], ['danger', 'bg'],
      ];
      for (const [fg, bg] of pairs) expect(contrast(c(fg), c(bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe('no colour literals outside tokens.css', () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));
  it('src has no hex colours except tokens.css', () => {
    const offenders = files(join(root, 'src')).filter((f) => !f.endsWith('tokens.css') && /#[0-9a-f]{3,8}\b/i.test(readFileSync(f, 'utf8').replace(/&#\d+;/g, '')));
    expect(offenders).toEqual([]);
  });
});
