import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { analyze, componentImpact, detectFramework, impact, type ProjectGraph } from '../src/index.js';
import { componentName } from '../src/nuxt/naming.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NUXT4 = path.join(HERE, 'fixtures/nuxt4');
const NUXT3 = path.join(HERE, 'fixtures/nuxt3');
const NUXT2 = path.join(HERE, 'fixtures/nuxt2');

const page = (g: ProjectGraph, url: string) => g.routes.find((r) => r.path === url && r.kind === 'page');
const comp = (g: ProjectGraph, name: string) => Object.values(g.components).find((c) => c.name === name);
const pagesOf = (routes: Array<{ route: { path: string; kind: string } }>) => [...new Set(routes.filter((r) => r.route.kind === 'page').map((r) => r.route.path))].sort();

describe('framework detection', () => {
  it('detects Nuxt 4, 3 and 2 from package.json (a hoisted Nuxt of another major is ignored)', () => {
    expect(detectFramework(NUXT4)).toMatchObject({ name: 'nuxt', major: 4 });
    expect(detectFramework(NUXT3)).toMatchObject({ name: 'nuxt', major: 3 });
    expect(detectFramework(NUXT2)).toMatchObject({ name: 'nuxt', major: 2 });
    expect(detectFramework(path.join(HERE, 'fixtures/next16'))).toMatchObject({ name: 'next' });
  });
});

describe('Nuxt component names', () => {
  it('follows Nuxt path prefixes without repeating folders', () => {
    expect(componentName('base/Button.vue')).toBe('BaseButton');
    expect(componentName('base/BaseButton.vue')).toBe('BaseButton');
    expect(componentName('product/ProductCard.vue')).toBe('ProductCard');
    expect(componentName('settings/SettingsPanel.client.vue')).toBe('SettingsPanel');
    expect(componentName('form/input/index.vue')).toBe('FormInput');
    expect(componentName('dashboard/StatsCard.vue')).toBe('DashboardStatsCard');
    expect(componentName('base/Button.vue', false)).toBe('Button');
  });
});

describe('Nuxt 4 (fixture)', () => {
  let g: ProjectGraph;
  beforeAll(() => {
    g = analyze(NUXT4);
  });

  it('uses app/ as source directory and lists pages, nested and API routes', () => {
    expect(g.framework).toMatchObject({ name: 'nuxt', major: 4 });
    expect(g.srcDir).toBe('app');
    expect(g.routes.filter((r) => r.kind === 'page').map((r) => r.path)).toEqual([
      '/',
      '/blog/[...slug]',
      '/checkout',
      '/dashboard',
      '/dashboard/settings',
      '/pricing', // (marketing) route group
      '/products/[id]',
    ]);
    expect(g.routes.filter((r) => r.kind === 'api').map((r) => r.path)).toEqual(['/api/hello', '/api/products/[id]']);
  });

  it('wraps pages with plugins, global middleware, app.vue, error page, their layout and parent pages', () => {
    expect(page(g, '/')!.wrappers).toEqual([
      'app/plugins/toast.ts',
      'app/assets/main.css', // nuxt.config css
      'app/middleware/analytics.global.ts',
      'app/app.vue',
      'app/error.vue',
      'app/layouts/default.vue',
    ]);
    // definePageMeta({ layout: false })
    expect(page(g, '/checkout')!.wrappers).not.toContain('app/layouts/default.vue');
    // the parent's definePageMeta({ layout: 'dashboard', middleware: 'auth' }) applies to its children
    const settings = page(g, '/dashboard/settings')!;
    expect(settings.wrappers).toEqual(expect.arrayContaining(['app/middleware/auth.ts', 'app/layouts/dashboard.vue', 'app/pages/dashboard.vue']));
    expect(settings.wrappers).not.toContain('app/layouts/default.vue');
    expect(g.roles['app/layouts/dashboard.vue']).toEqual({ role: 'layout', name: 'dashboard' });
    expect(g.roles['app/pages/dashboard.vue']).toEqual({ role: 'parent', name: '/dashboard' });
    expect(g.roles['app/middleware/analytics.global.ts']).toMatchObject({ role: 'middleware', global: true });
  });

  it('indexes auto-imported components with their Nuxt names, usages and props', () => {
    const button = comp(g, 'BaseButton')!;
    expect(button.module).toBe('app/components/base/Button.vue');
    expect(button.usages.map((u) => u.module).sort()).toEqual([
      'app/components/app/Header.vue',
      'app/components/base/Modal.vue',
      'app/components/product/ProductCard.vue',
      'app/components/settings/SettingsPanel.client.vue',
      'app/error.vue',
      'app/pages/checkout.vue',
      'app/pages/products/[id].vue',
    ]);
    const danger = button.usages.find((u) => u.module.endsWith('SettingsPanel.client.vue'))!;
    expect(danger.props).toEqual([
      { name: 'variant', kind: 'literal', value: 'danger', type: 'string' },
      { name: 'onClick', kind: 'expression', value: 'open = true' },
    ]);
    const product = button.usages.find((u) => u.module.endsWith('[id].vue'))!;
    expect(product.props.find((p) => p.name === 'variant')).toMatchObject({ kind: 'expression' });
    const stats = comp(g, 'DashboardStatsCard')!.usages[0]!;
    expect(stats.props).toEqual(
      expect.arrayContaining([
        { name: 'value', kind: 'literal', value: '12', type: 'number' },
        { name: 'trend', kind: 'literal', value: 'up', type: 'string' },
      ]),
    );
  });

  it('resolves explicit imports, Lazy components and .client components', () => {
    // pages/blog/[...slug].vue imports Card.vue explicitly: same component as the auto-import.
    expect(comp(g, 'BaseCard')!.usages.map((u) => u.module)).toContain('app/pages/blog/[...slug].vue');
    const panel = g.modules['app/components/settings/SettingsPanel.client.vue']!;
    expect(panel.client).toBe(true);
    expect(panel.imports.find((e) => e.to === 'app/components/base/Modal.vue')?.kind).toBe('dynamic'); // <LazyBaseModal>
    expect(comp(g, 'SettingsPanel')!.client).toBe(true);
  });

  it('links auto-imported composables and utils, and propagates their impact', () => {
    expect(g.modules['app/components/app/Header.vue']!.imports.map((e) => e.to)).toContain('app/composables/useCart.ts');
    expect(pagesOf(impact(g, ['app/composables/useCart.ts']).routes)).toEqual([
      '/',
      '/blog/[...slug]',
      '/dashboard',
      '/dashboard/settings',
      '/pricing',
      '/products/[id]',
    ]);
    expect(pagesOf(impact(g, ['app/utils/format.ts']).routes)).toEqual(['/', '/products/[id]']);
    expect(pagesOf(componentImpact(g, comp(g, 'BaseModal')!.id).routes)).toEqual(['/dashboard/settings']);
  });

  it('reports unused components and keeps global CSS and server files reachable', () => {
    expect(g.unreachable).toEqual(['app/components/UnusedWidget.vue', 'app/components/base/Avatar.vue']);
    expect(g.unresolved).toEqual([]);
  });
});

describe('Nuxt 3 (fixture with generated .nuxt)', () => {
  it('uses the project root as source directory', () => {
    const g = analyze(NUXT3);
    expect(g.framework.major).toBe(3);
    expect(g.srcDir).toBe('');
    expect(page(g, '/')!.wrappers).toContain('layouts/default.vue');
    expect(comp(g, 'BaseButton')!.usages).toHaveLength(7);
  });

  it('gives the same result without .nuxt (conventions only)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'impact-analyser-nuxt3-'));
    fs.cpSync(NUXT3, tmp, { recursive: true });
    fs.rmSync(path.join(tmp, '.nuxt'), { recursive: true, force: true });
    try {
      const withGenerated = analyze(NUXT3);
      const withoutGenerated = analyze(tmp);
      const summary = (g: ProjectGraph) => Object.values(g.components).map((c) => `${c.name}:${c.usages.length}`).sort();
      expect(summary(withoutGenerated)).toEqual(summary(withGenerated));
      expect(withoutGenerated.unreachable).toEqual(withGenerated.unreachable);
      expect(pagesOf(impact(withoutGenerated, ['composables/useCart.ts']).routes)).toEqual(pagesOf(impact(withGenerated, ['composables/useCart.ts']).routes));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('Nuxt 2 (fixture)', () => {
  let g: ProjectGraph;
  beforeAll(() => {
    g = analyze(NUXT2);
  });

  it('understands _param pages, layouts and middleware of the options API and nuxt.config', () => {
    expect(g.framework.major).toBe(2);
    expect(g.routes.map((r) => r.path)).toEqual(['/', '/[...all]', '/dashboard', '/products/[id]']);
    const product = page(g, '/products/[id]')!;
    expect(product.wrappers).toEqual([
      'plugins/toast.js', // nuxt.config plugins
      'middleware/analytics.js', // nuxt.config router.middleware
      'layouts/error.vue', // error page
      'middleware/auth.js', // middleware: 'auth'
      'layouts/dashboard.vue', // layout: 'dashboard'
    ]);
    expect(g.roles['layouts/error.vue']).toEqual({ role: 'error' });
  });

  it('resolves kebab-case tags of auto-imported components (components: true)', () => {
    const button = comp(g, 'BaseButton')!;
    expect(button.usages.map((u) => `${u.module}:${u.tag}`)).toEqual(
      expect.arrayContaining(['components/app/Header.vue:base-button', 'pages/index.vue:BaseButton']),
    );
    expect(comp(g, 'BaseCard')!.usages.map((u) => u.module)).toContain('pages/dashboard/index.vue');
    expect(g.unreachable).toEqual(['components/Unused.vue']);
  });
});

describe('Nuxt layers, Nitro auto-imports, <component :is>, Pug (fixture nuxt-layers)', () => {
  const LAYERS = path.join(HERE, 'fixtures/nuxt-layers/app');
  let g: ProjectGraph;
  beforeAll(() => {
    g = analyze(LAYERS);
  });
  const usagesOf = (graph: ProjectGraph, name: string) => comp(graph, name)!.usages.map((u) => `${u.module}:${u.line} ${u.tag}`).sort();

  it('collects pages of every layer; the app overrides a layer page with the same URL', () => {
    expect(g.routes.filter((r) => r.kind === 'page').map((r) => `${r.path} ${r.file}`)).toEqual([
      '/ app/pages/index.vue',
      '/dynamic app/pages/dynamic.vue',
      '/legal layers/base/app/pages/legal.vue', // from layers/base
      '/pug app/pages/pug.vue',
      '/render app/pages/render.vue',
      '/terms app/pages/terms.vue', // the app's, not layers/base's
    ]);
    // The overridden layer page is never served.
    expect(g.unreachable).toEqual(['layers/base/app/pages/terms.vue']);
    // Layout coming from a layer.
    expect(page(g, '/')!.wrappers).toContain('layers/base/app/layouts/default.vue');
  });

  it('indexes components of auto layers and of local layers outside the project (extends: ../shared-layer)', () => {
    expect(comp(g, 'UiAlert')!.module).toBe('layers/base/app/components/ui/Alert.vue');
    expect(comp(g, 'SharedFooter')!.module).toBe('../shared-layer/app/components/SharedFooter.vue');
    expect(usagesOf(g, 'SharedFooter')).toContain('layers/base/app/layouts/default.vue:4 SharedFooter');
    expect(pagesOf(componentImpact(g, comp(g, 'SharedFooter')!.id).routes)).toEqual(['/', '/dynamic', '/legal', '/pug', '/render', '/terms']);
  });

  it('links server files to Nitro auto-imports (server/utils of every layer), server middleware wraps every route', () => {
    expect(g.modules['server/api/items.ts']!.imports.map((e) => e.to)).toEqual(['server/utils/db.ts']);
    expect(g.modules['server/middleware/log.ts']!.imports.map((e) => e.to)).toEqual(['../shared-layer/server/utils/shared.ts']);
    expect(g.roles['server/middleware/log.ts']).toEqual({ role: 'server-middleware', name: 'log' });
    expect(g.routes.find((r) => r.path === '/api/items')!.wrappers).toEqual(['server/middleware/log.ts']);
    expect(page(g, '/pug')!.wrappers[0]).toBe('server/middleware/log.ts');
    // App auto-imports are not available in server files, and the other way round.
    expect(g.modules['app/pages/pug.vue']!.imports.map((e) => e.to)).toContain('layers/base/app/composables/useToast.ts');
  });

  it('resolves <component :is> (literal, variable, condition) and resolveComponent() in render functions', () => {
    expect(usagesOf(g, 'UiAlert')).toEqual(
      expect.arrayContaining([
        'app/pages/dynamic.vue:9 component', // :is="'UiAlert'"
        'app/pages/dynamic.vue:10 component', // :is="ok ? Footer : 'UiAlert'"
        "app/pages/render.vue:3 resolveComponent('UiAlert')", // h(resolveComponent('UiAlert'))
      ]),
    );
    // `const Footer = resolveComponent('SharedFooter')` used as :is="… Footer …".
    expect(usagesOf(g, 'SharedFooter')).toContain('app/pages/dynamic.vue:10 component');
    const literal = comp(g, 'UiAlert')!.usages.find((u) => u.module.endsWith('dynamic.vue') && u.line === 9)!;
    expect(literal.props.find((p) => p.name === 'tone')).toMatchObject({ value: 'warning' });
  });

  it('parses Pug templates: tags, kebab-case, props, events and template identifiers', () => {
    const pug = comp(g, 'UiAlert')!.usages.find((u) => u.module === 'app/pages/pug.vue')!;
    expect(pug.line).toBe(7);
    expect(pug.props).toEqual([
      { name: 'tone', kind: 'literal', value: 'success', type: 'string' },
      { name: 'dismissible', kind: 'literal', value: 'true', type: 'boolean' },
      { name: 'onClose', kind: 'expression', value: "show('closed')" },
    ]);
    expect(usagesOf(g, 'SharedFooter')).toContain('app/pages/pug.vue:8 shared-footer');
  });

  it('gives the same result without .nuxt (conventions only)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'impact-analyser-layers-'));
    fs.cpSync(path.join(HERE, 'fixtures/nuxt-layers'), tmp, { recursive: true });
    fs.rmSync(path.join(tmp, 'app/.nuxt'), { recursive: true, force: true });
    try {
      const conventions = analyze(path.join(tmp, 'app'));
      expect(conventions.nuxt).toEqual({ generated: false });
      const summary = (graph: ProjectGraph) => Object.values(graph.components).map((c) => `${c.name}:${c.module}:${c.usages.length}`).sort();
      expect(summary(conventions)).toEqual(summary(g));
      expect(conventions.modules['server/api/items.ts']!.imports.map((e) => e.to)).toEqual(['server/utils/db.ts']);
      expect(conventions.unreachable).toEqual(g.unreachable);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
