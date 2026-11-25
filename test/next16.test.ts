import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { analyze, impact, parseModule, type ProjectGraph } from '../src/index.js';

const NEXT16 = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/next16');

let graph: ProjectGraph;
beforeAll(() => {
  graph = analyze(NEXT16);
});

const routeKeys = (g: ProjectGraph) =>
  g.routes.map((r) => `${r.router} ${r.kind} ${r.path}${r.slot ? ` @${r.slot}` : ''}`);

const impactedPaths = (files: string[], options = {}) =>
  impact(graph, files, { cwd: NEXT16, ...options })
    .routes.map((r) => `${r.route.router} ${r.route.path}${r.route.slot ? ` @${r.route.slot}` : ''}`)
    .sort();

describe('routes', () => {
  it('detects App Router and Pages Router routes', () => {
    expect(routeKeys(graph).sort()).toEqual(
      [
        'app page /',
        'app page /about', // (marketing) route group is stripped
        'app page /blog/[slug]',
        'app page /checkout', // (shop) route group
        'app page /products/[id]',
        'app page /dashboard',
        'app page /dashboard @analytics',
        'app default /dashboard @analytics',
        'app page /dashboard/settings',
        'app api /api/hello',
        'pages page /legacy',
        'pages page /legacy/[id]',
        'pages api /api/health',
      ].sort(),
    );
  });

  it('attaches layouts and boundaries as wrappers, outermost first', () => {
    const settings = graph.routes.find((r) => r.path === '/dashboard/settings')!;
    expect(settings.wrappers).toEqual([
      'src/app/layout.tsx',
      'src/app/dashboard/layout.tsx',
      'src/app/dashboard/error.tsx',
      'src/app/dashboard/loading.tsx',
    ]);
    const legacy = graph.routes.find((r) => r.path === '/legacy')!;
    expect(legacy.wrappers).toEqual(['src/pages/_app.tsx']);
    const api = graph.routes.find((r) => r.path === '/api/health')!;
    expect(api.wrappers).toEqual([]);
  });
});

describe('module graph', () => {
  it('resolves tsconfig aliases, barrels, dynamic imports and css modules', () => {
    const header = graph.modules['src/components/layout/Header.tsx']!;
    expect(header.imports).toContainEqual({
      to: 'src/components/ui/index.ts',
      kind: 'static',
      specifier: '@/components/ui',
      names: ['Button'],
    });
    // `import * as Icons` only used as <Icons.Cart /> and <Icons.User />
    expect(header.imports.find((e) => e.specifier === '@/components/icons')?.names).toEqual(['Cart', 'User']);
    expect(header.externals).toEqual(['next']);

    const barrel = graph.modules['src/components/ui/index.ts']!;
    expect(barrel.imports.map((e) => [e.to, e.kind, e.names])).toEqual([
      ['src/components/ui/Avatar.tsx', 'reexport', ['Avatar']],
      ['src/components/ui/Badge.tsx', 'reexport', ['Badge']],
      ['src/components/ui/Button.tsx', 'reexport', ['Button']],
      ['src/components/ui/Card.tsx', 'reexport', ['Card']],
    ]);
    expect(barrel.exports).toEqual(['Avatar', 'Badge', 'Button', 'Card']);
    expect(barrel.category).toBe('barrel');

    const panel = graph.modules['src/features/settings/SettingsPanel.tsx']!;
    expect(panel.client).toBe(true);
    expect(panel.imports).toContainEqual({
      to: 'src/components/ui/Modal.tsx',
      kind: 'dynamic',
      specifier: '@/components/ui/Modal',
      names: ['*'],
    });

    expect(graph.modules['src/components/ui/Button.module.css']?.kind).toBe('style');
    expect(graph.unresolved).toEqual([]);
  });

  it('reports files not reachable from any route', () => {
    expect(graph.unreachable).toEqual(['src/components/UnusedWidget.tsx']);
  });
});

describe('impact', () => {
  it('follows imported names through barrels: Card only impacts the routes rendering it', () => {
    // Header (root layout) and SettingsPanel import { Button } from the same barrel as Card:
    // they must not make every page "impacted".
    expect(impactedPaths(['src/components/ui/Card.tsx'])).toEqual([
      'app /',
      'app /about',
      'app /checkout',
      'app /dashboard',
      'app /dashboard @analytics',
      'app /products/[id]',
      'pages /legacy',
    ]);
  });

  it('Button is in the root layout header, so it impacts every App Router page', () => {
    const paths = impactedPaths(['src/components/ui/Button.module.css']);
    expect(paths).toEqual([
      'app /',
      'app /about',
      'app /blog/[slug]',
      'app /checkout',
      'app /dashboard',
      'app /dashboard @analytics',
      'app /dashboard @analytics', // default.tsx of the slot
      'app /dashboard/settings',
      'app /products/[id]',
    ]);
  });

  it('a component used in the root layout impacts all App Router pages, not the Pages Router', () => {
    const paths = impactedPaths(['src/components/layout/Header.tsx']);
    expect(paths).toContain('app /blog/[slug]');
    expect(paths).toContain('app /dashboard/settings');
    expect(paths.some((p) => p.startsWith('pages'))).toBe(false);
    expect(paths).not.toContain('app /api/hello');
  });

  it('gives the shortest import chain from the route to the changed file', () => {
    const result = impact(graph, ['src/components/ui/Modal.tsx'], { cwd: NEXT16 });
    expect(result.routes).toHaveLength(1);
    expect(result.routes[0]!.chain).toEqual([
      'src/app/dashboard/settings/page.tsx',
      'src/features/settings/SettingsPanel.tsx',
      'src/components/ui/Modal.tsx',
    ]);
  });

  it('ignores type-only imports unless asked', () => {
    expect(impactedPaths(['src/lib/types.ts'])).toEqual([]);
    expect(impactedPaths(['src/lib/types.ts'], { includeTypeOnly: true })).toEqual(['app /blog/[slug]']);
  });

  it('flags files that are not in the graph', () => {
    const result = impact(graph, ['src/components/UnusedWidget.tsx'], { cwd: NEXT16 });
    expect(result.notInGraph).toEqual(['src/components/UnusedWidget.tsx']);
    expect(result.routes).toEqual([]);
  });
});

describe('parseModule', () => {
  it('detects "use client" only as a leading directive', () => {
    expect(parseModule('a.tsx', `'use client';\nexport const a = 1;`).client).toBe(true);
    expect(parseModule('a.tsx', `import x from 'y';\n'use client';`).client).toBe(false);
  });

  it('classifies import kinds', () => {
    const { imports } = parseModule(
      'a.ts',
      `import a from './a';
       import type { B } from './b';
       import { type C } from './c';
       export * from './d';
       export type { E } from './e';
       const f = () => import('./f');
       const g = require('./g');
       import './h.css';`,
    );
    expect(imports.map((i) => `${i.specifier}:${i.kind}`)).toEqual([
      './a:static',
      './b:type',
      './c:type',
      './d:reexport',
      './e:type',
      './f:dynamic',
      './g:static',
      './h.css:static',
    ]);
  });

  it('collects imported and exported names', () => {
    const { imports, exports } = parseModule(
      'barrel.ts',
      `import Def, { a, b as c, type T } from './x';
       export { Button as PrimaryButton, Card } from './ui';
       export * as icons from './icons';
       export const one = 1, { two, three: [four] } = obj;
       export default function () {}
       export function fn() {}
       export interface Ignored {}`,
    );
    expect(imports[0]!.names).toEqual(['default', 'a', 'b']);
    expect(imports[1]).toMatchObject({ names: ['Button', 'Card'], aliases: ['PrimaryButton', null] });
    expect(imports[2]).toMatchObject({ names: ['*'], aliases: ['icons'] });
    expect(exports.sort()).toEqual(['Card', 'PrimaryButton', 'default', 'fn', 'four', 'icons', 'one', 'two'].sort());
  });
});

describe('impact through barrel chains', () => {
  // Synthetic graph: page -> ui/index (export *) -> ui/forms/index ({ Input }) -> Input / Select
  const node = (id: string, imports: ProjectGraph['modules'][string]['imports'], exports: string[] = []) => ({
    id,
    kind: 'source' as const,
    client: false,
    imports,
    exports,
    externals: [],
  });
  const synthetic: ProjectGraph = {
    version: 1,
    root: '/virtual',
    routes: [
      { router: 'app', kind: 'page', path: '/a', file: 'a.tsx', wrappers: [] },
      { router: 'app', kind: 'page', path: '/b', file: 'b.tsx', wrappers: [] },
    ],
    modules: {
      'a.tsx': node('a.tsx', [{ to: 'ui/index.ts', kind: 'static', specifier: './ui', names: ['Input'] }]),
      'b.tsx': node('b.tsx', [{ to: 'ui/index.ts', kind: 'static', specifier: './ui', names: ['Select'] }]),
      'ui/index.ts': node('ui/index.ts', [{ to: 'ui/forms/index.ts', kind: 'reexport', specifier: './forms', names: ['*'] }]),
      'ui/forms/index.ts': node(
        'ui/forms/index.ts',
        [
          { to: 'ui/forms/Input.tsx', kind: 'reexport', specifier: './Input', names: ['Input'] },
          { to: 'ui/forms/Select.tsx', kind: 'reexport', specifier: './Select', names: ['Select'] },
        ],
        ['Input', 'Select'],
      ),
      'ui/forms/Input.tsx': node('ui/forms/Input.tsx', [], ['Input']),
      'ui/forms/Select.tsx': node('ui/forms/Select.tsx', [], ['Select']),
    },
    importedBy: {},
    unresolved: [],
    unreachable: [],
  };

  it('only impacts the route importing the changed name', () => {
    const result = impact(synthetic, ['/virtual/ui/forms/Input.tsx']);
    expect(result.routes.map((r) => r.route.path)).toEqual(['/a']);
    expect(result.routes[0]!.chain).toEqual(['a.tsx', 'ui/index.ts', 'ui/forms/index.ts', 'ui/forms/Input.tsx']);
  });

  it('a change to the barrel itself impacts everything importing it', () => {
    const result = impact(synthetic, ['/virtual/ui/index.ts']);
    expect(result.routes.map((r) => r.route.path)).toEqual(['/a', '/b']);
  });
});
