import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { analyze, compilePattern, createScope, loadConfig } from '../src/index.js';

const NEXT16 = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/next16');

describe('scope patterns', () => {
  const matches = (pattern: string, id: string) => compilePattern(pattern).test(id);

  it('"*" and "**" match every file', () => {
    expect(matches('*', 'src/app/page.tsx')).toBe(true);
    expect(matches('**', 'src/app/page.tsx')).toBe(true);
    expect(matches('**/*', 'src/app/page.tsx')).toBe(true);
  });

  it('a pattern without slash matches a name at any depth', () => {
    expect(matches('*.generated.ts', 'src/lib/api.generated.ts')).toBe(true);
    expect(matches('*.generated.ts', 'src/lib/api.ts')).toBe(false);
    expect(matches('__mocks__', 'src/lib/__mocks__/api.ts')).toBe(true);
    expect(matches('legacy', 'src/legacy-utils/a.ts')).toBe(false);
  });

  it('a pattern with slash is anchored at the root and covers folders', () => {
    expect(matches('src/legacy', 'src/legacy/a/b.tsx')).toBe(true);
    expect(matches('src/legacy/**', 'src/legacy/a/b.tsx')).toBe(true);
    expect(matches('./src/legacy/', 'src/legacy/b.tsx')).toBe(true);
    expect(matches('legacy/**', 'src/legacy/b.tsx')).toBe(false);
    expect(matches('src/*/index.ts', 'src/lib/index.ts')).toBe(true);
    expect(matches('src/*/index.ts', 'src/lib/deep/index.ts')).toBe(false);
    expect(matches('src/**/index.ts', 'src/lib/deep/index.ts')).toBe(true);
    expect(matches('src/**/index.ts', 'src/index.ts')).toBe(true);
  });

  it('supports ?, {a,b} and literal special characters', () => {
    expect(matches('src/app/(shop)/**', 'src/app/(shop)/checkout/page.tsx')).toBe(true);
    expect(matches('src/app/(shop)/**', 'src/app/shop/page.tsx')).toBe(false);
    expect(matches('*.{stories,test}.tsx', 'src/ui/Button.stories.tsx')).toBe(true);
    expect(matches('*.{stories,test}.tsx', 'src/ui/Button.tsx')).toBe(false);
    expect(matches('src/app/[id]/page.tsx', 'src/app/[id]/page.tsx')).toBe(true);
    expect(matches('v?.ts', 'src/v2.ts')).toBe(true);
  });

  it('include defaults to everything, exclude wins over include', () => {
    const all = createScope();
    expect(all('src/app/page.tsx')).toBe(true);
    const scope = createScope({ include: ['src/**'], exclude: ['src/legacy'] });
    expect(scope('src/app/page.tsx')).toBe(true);
    expect(scope('src/legacy/x.tsx')).toBe(false);
    expect(scope('scripts/seed.ts')).toBe(false);
  });
});

describe('analysis with include / exclude', () => {
  it('records the scope, "*" by default', () => {
    const graph = analyze(NEXT16);
    expect(graph.scope).toEqual({ include: ['*'], exclude: [] });
    expect(graph.excluded).toEqual([]);
  });

  it('an excluded folder is neither analysed, followed nor reported as dead code', () => {
    const graph = analyze(NEXT16, { exclude: ['src/components/icons', 'UnusedWidget.tsx'] });
    expect(Object.keys(graph.modules).some((id) => id.startsWith('src/components/icons/'))).toBe(false);
    expect(Object.keys(graph.components).some((id) => id.startsWith('src/components/icons/'))).toBe(false);
    expect(graph.excluded).toContain('src/components/icons/index.tsx');
    expect(graph.unreachable).not.toContain('src/components/UnusedWidget.tsx');
    // Header still exists, it just no longer depends on the icons.
    const header = graph.modules['src/components/layout/Header.tsx'];
    expect(header).toBeDefined();
    expect(header!.imports.some((e) => e.to.startsWith('src/components/icons/'))).toBe(false);
  });

  it('excluded route files drop their routes, excluded layouts stop wrapping pages', () => {
    const graph = analyze(NEXT16, { exclude: ['src/pages', 'src/app/dashboard/layout.tsx'] });
    expect(graph.routes.some((r) => r.router === 'pages')).toBe(false);
    const dashboard = graph.routes.find((r) => r.path === '/dashboard' && r.kind === 'page' && !r.slot);
    expect(dashboard?.wrappers).not.toContain('src/app/dashboard/layout.tsx');
    expect(graph.modules['src/app/dashboard/layout.tsx']).toBeUndefined();
  });

  it('include restricts the analysis to the given folders', () => {
    const graph = analyze(NEXT16, { include: ['src/app', 'src/components'] });
    const ids = Object.keys(graph.modules);
    expect(ids.every((id) => id.startsWith('src/app/') || id.startsWith('src/components/'))).toBe(true);
    expect(graph.excluded).toContain('src/lib/products.ts');
    expect(graph.unreachable.every((id) => id.startsWith('src/app/') || id.startsWith('src/components/'))).toBe(true);
    expect(graph.routes.some((r) => r.router === 'pages')).toBe(false);
  });

  it('config validation rejects a malformed include', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'impact-analyser-scope-'));
    fs.writeFileSync(path.join(dir, 'impact-analyser.config.json'), JSON.stringify({ include: 'src/**' }));
    await expect(loadConfig(dir)).rejects.toThrow(/"include" must be an array/);
    fs.writeFileSync(path.join(dir, 'impact-analyser.config.json'), JSON.stringify({ include: ['*'], exclude: ['src/legacy/**'] }));
    await expect(loadConfig(dir)).resolves.toMatchObject({ config: { include: ['*'], exclude: ['src/legacy/**'] } });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
