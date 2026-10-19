import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const eslint = new ESLint({ cwd: root });

async function ruleIds(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: `${root}${filePath}` });
  return (result?.messages ?? []).map((m) => m.ruleId ?? m.message);
}

const literalPage = `export function Hero() {\n  return <h1 className="title">Healthy saplings</h1>;\n}\n`;
const messagesPage = `const m = { title: 'x' };\nexport function Hero() {\n  return <h1 className="title" data-cta="hero-shop">{m.title}</h1>;\n}\n`;

describe('copy rule (messages only on storefront surfaces)', () => {
  it('fails on a literal string in a package ui component', async () => {
    expect(await ruleIds(literalPage, 'packages/fixture/src/ui/Hero.tsx')).toContain('react/jsx-no-literals');
  });
  it('fails on a literal string in an app storefront route', async () => {
    expect(await ruleIds(literalPage, 'apps/shop/app/(shop)/fixture/page.tsx')).toContain('react/jsx-no-literals');
  });
  it('fails on literal visible attribute text', async () => {
    const code = `export function Pic() {\n  return <img src="/a.webp" alt="Mango sapling" />;\n}\n`;
    expect(await ruleIds(code, 'packages/fixture/src/ui/Pic.tsx')).toContain('no-restricted-syntax');
  });
  it('passes when copy comes from messages and props are class names', async () => {
    expect(await ruleIds(messagesPage, 'packages/fixture/src/ui/Hero.tsx')).toEqual([]);
  });
  it('exempts admin UI', async () => {
    expect(await ruleIds(literalPage, 'apps/shop/app/(admin)/admin/fixture/page.tsx')).toEqual([]);
    expect(await ruleIds(literalPage, 'packages/fixture/src/admin/Hero.tsx')).toEqual([]);
  });
});

describe('boundaries', () => {
  it('blocks deep imports into another package', async () => {
    const code = `import { x } from '@ecomkit/catalog/src/server/products';\nexport const y = x;\n`;
    expect(await ruleIds(code, 'packages/cart/src/server/cart.ts')).toContain('no-restricted-imports');
  });
  it('blocks relative hops into another package', async () => {
    const code = `import { x } from '../../../catalog/src/server/products';\nexport const y = x;\n`;
    expect(await ruleIds(code, 'packages/cart/src/server/cart.ts')).toContain('no-restricted-imports');
  });
  it('keeps domain/ free of React, Next and the database', async () => {
    const code = `import { sql } from 'drizzle-orm';\nexport const q = sql\`select 1\`;\n`;
    expect(await ruleIds(code, 'packages/cart/src/domain/totals.ts')).toContain('no-restricted-imports');
  });
  it('allows public exports', async () => {
    const code = `import { getProduct } from '@ecomkit/catalog/server';\nexport const y = getProduct;\n`;
    expect(await ruleIds(code, 'packages/cart/src/server/cart.ts')).toEqual([]);
  });
});

describe('same-package relative imports', () => {
  it('are allowed', async () => {
    const code = `import { a } from '../domain/totals';\nimport { b } from '../../src/domain/x';\nexport const y = [a, b];\n`;
    expect(await ruleIds(code, 'packages/cart/src/server/cart.ts')).toEqual([]);
    const test = `import { a } from '../src/domain/totals';\nexport const y = a;\n`;
    expect(await ruleIds(test, 'packages/cart/test/totals.test.ts')).toEqual([]);
  });
});
