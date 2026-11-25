import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { analyze, impact, type ProjectGraph } from '../src/index.js';
import { readNextPageExtensions } from '../src/project.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NEXT12 = path.join(HERE, 'fixtures/next12');
const NEXT13 = path.join(HERE, 'fixtures/next13');
const NEXT16 = path.join(HERE, 'fixtures/next16');

const comp = (g: ProjectGraph, name: string) => Object.values(g.components).find((c) => c.name === name);
const pagesOf = (routes: Array<{ route: { path: string; kind: string } }>) =>
  [...new Set(routes.filter((r) => r.route.kind === 'page').map((r) => r.route.path))].sort();

describe('Next.js 12 (Pages Router, JavaScript, jsconfig baseUrl)', () => {
  let g: ProjectGraph;
  beforeAll(() => {
    g = analyze(NEXT12);
  });

  it('detects the version declared by the project (not the hoisted Next 16)', () => {
    expect(g.framework).toMatchObject({ name: 'next', major: 12 });
  });

  it('does not list _error and _middleware as routes', () => {
    expect(g.routes.map((r) => r.path)).toEqual(['/', '/404', '/admin', '/api/hello']);
  });

  it('wraps pages with _middleware (per folder), _document, _app and the _error page', () => {
    const admin = g.routes.find((r) => r.path === '/admin')!;
    expect(admin.wrappers).toEqual(['pages/_middleware.js', 'pages/admin/_middleware.js', 'pages/_document.js', 'pages/_app.js', 'pages/_error.js']);
    expect(g.routes.find((r) => r.path === '/api/hello')!.wrappers).toEqual(['pages/_middleware.js']);
    expect(g.roles['pages/_error.js']).toEqual({ role: 'error' });
    expect(g.roles['pages/admin/_middleware.js']).toEqual({ role: 'middleware', name: '/admin' });
  });

  it('resolves baseUrl imports and indexes class / HOC-wrapped components', () => {
    expect(g.unresolved).toEqual([]);
    expect(g.modules['pages/_app.js']!.imports.map((e) => e.to)).toContain('components/Layout.js');
    expect(comp(g, 'Counter')!.usages.map((u) => u.module)).toEqual(['pages/index.js']);
    expect(comp(g, 'Nav')!.usages.map((u) => u.module)).toEqual(['components/Layout.js']);
    expect(comp(g, 'Button')!.usages.map((u) => u.module).sort()).toEqual(['components/Counter.js', 'pages/_error.js', 'pages/index.js']);
    expect(g.unreachable).toEqual(['components/Legacy.js']);
  });

  it('propagates impact through _app, _error and folder middleware', () => {
    // Layout is rendered by _app: every page.
    expect(pagesOf(impact(g, ['components/Layout.js']).routes)).toEqual(['/', '/404', '/admin']);
    // Button is in _error: every page can show it.
    expect(pagesOf(impact(g, ['components/Button.js']).routes)).toEqual(['/', '/404', '/admin']);
    expect(pagesOf(impact(g, ['pages/admin/_middleware.js']).routes)).toEqual(['/admin']);
    expect(pagesOf(impact(g, ['lib/format.js']).routes)).toEqual(['/admin']);
  });
});

describe('Next.js 13 (App Router in src/, custom pageExtensions, middleware.ts)', () => {
  let g: ProjectGraph;
  beforeAll(() => {
    g = analyze(NEXT13);
  });

  it('reads pageExtensions from next.config', () => {
    expect(readNextPageExtensions(NEXT13)).toEqual(['page.tsx', 'page.ts']);
    expect(readNextPageExtensions(NEXT16)).toBeUndefined();
  });

  it('only treats *.page.* files as routes and special files', () => {
    expect(g.framework).toMatchObject({ name: 'next', major: 13 });
    expect(g.routes.map((r) => `${r.kind} ${r.path} ${r.file}`)).toEqual([
      'page / src/app/page.page.tsx',
      'api /api/hello src/app/api/hello/route.page.ts',
      'page /dashboard src/app/dashboard/page.page.tsx',
    ]);
    const dashboard = g.routes.find((r) => r.path === '/dashboard')!;
    expect(dashboard.wrappers).toEqual(['src/middleware.ts', 'src/app/layout.page.tsx', 'src/app/dashboard/loading.page.tsx']);
    expect(g.roles['src/app/layout.page.tsx']).toEqual({ role: 'layout' });
    expect(g.roles['src/app/dashboard/loading.page.tsx']).toEqual({ role: 'loading' });
    expect(g.roles['src/middleware.ts']).toEqual({ role: 'middleware', name: 'middleware', global: true });
  });

  it('keeps colocated components as regular modules', () => {
    expect(g.modules['src/app/dashboard/Chart.tsx']).toMatchObject({ category: 'component', client: true });
    expect(comp(g, 'Card')!.usages.map((u) => u.module).sort()).toEqual(['src/app/dashboard/Chart.tsx', 'src/app/layout.page.tsx', 'src/app/page.page.tsx']);
    expect(g.unreachable).toEqual([]);
  });

  it('the impact-analyser config overrides next.config pageExtensions', () => {
    const withDefaults = analyze(NEXT13, { pageExtensions: ['tsx', 'ts'] });
    // With the default extensions, page.page.tsx is not a page (its name is "page.page").
    expect(withDefaults.routes).toEqual([]);
  });
});

describe('Next.js 16 middleware (fixture has none)', () => {
  it('adds no middleware wrapper when the project has no middleware.ts / proxy.ts', () => {
    const g = analyze(NEXT16);
    expect(Object.values(g.roles).some((r) => r.role === 'middleware')).toBe(false);
  });
});
