import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  analyze,
  componentImpact,
  createTranslator,
  formatImpactMarkdown,
  impact,
  loadConfig,
  rankComponents,
  resolveLang,
  type ProjectGraph,
} from '../src/index.js';

const NEXT16 = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/next16');

let graph: ProjectGraph;
beforeAll(() => {
  graph = analyze(NEXT16);
});

const paths = (routes: Array<{ route: { path: string; slot?: string; kind: string } }>) =>
  routes.map((r) => `${r.route.path}${r.route.slot ? ` @${r.route.slot}` : ''}${r.route.kind === 'default' ? ' (default)' : ''}`).sort();

describe('component index', () => {
  it('lists components with display names, through barrels, namespaces and next/dynamic', () => {
    const names = Object.values(graph.components).map((c) => c.name).sort();
    expect(names).toEqual(
      ['Avatar', 'Badge', 'Button', 'Card', 'Cart', 'Footer', 'Header', 'LegacyBanner', 'Modal', 'ProductCard', 'Providers', 'Settings', 'SettingsPanel', 'ShopBanner', 'Sidebar', 'StatsCard', 'User'].sort(),
    );
    // `export default function Modal`, rendered through `dynamic(() => import(...))`
    const modal = graph.components['src/components/ui/Modal.tsx#default']!;
    expect(modal.name).toBe('Modal');
    expect(modal.usages.map((u) => u.module)).toEqual(['src/features/settings/SettingsPanel.tsx']);
    // <Icons.Cart /> through `import * as Icons`
    expect(graph.components['src/components/icons/index.tsx#Cart']!.usages).toMatchObject([{ module: 'src/components/layout/Header.tsx', tag: 'Icons.Cart' }]);
    // exported but never rendered
    expect(graph.components['src/components/ui/Avatar.tsx#Avatar']!.usages).toEqual([]);
  });

  it('records the props of every usage, i.e. the variants', () => {
    const button = graph.components['src/components/ui/Button.tsx#Button']!;
    const byFile = Object.fromEntries(button.usages.map((u) => [u.module, u.props.filter((p) => p.name !== 'children')]));
    expect(byFile['src/components/layout/Header.tsx']).toEqual([
      { name: 'variant', kind: 'literal', value: 'primary', type: 'string' },
      { name: 'size', kind: 'literal', value: 'sm', type: 'string' },
    ]);
    expect(byFile['src/app/(shop)/products/[id]/page.tsx']).toEqual([
      { name: 'variant', kind: 'expression', value: "available ? 'primary' : 'default'" },
      { name: 'disabled', kind: 'expression', value: '!available' },
    ]);
    const variants = button.usages.map((u) => u.props.find((p) => p.name === 'variant')?.value ?? '(default)').sort();
    expect(variants).toEqual(['(default)', '(default)', 'available ? \'primary\' : \'default\'', 'danger', 'ghost', 'primary', 'primary']);
  });

  it('categorizes files', () => {
    const category = (id: string) => graph.modules[id]?.category;
    expect(category('src/components/ui/Button.tsx')).toBe('component');
    expect(category('src/components/ui/index.ts')).toBe('barrel');
    expect(category('src/lib/format.ts')).toBe('util');
    expect(category('src/app/layout.tsx')).toBe('route');
    expect(category('src/components/ui/Button.module.css')).toBe('style');
  });
});

describe('component impact', () => {
  it('only counts the pages using that very component, not its file siblings', () => {
    // Header renders <Icons.Cart /> and <Icons.User />, the dashboard Sidebar renders <Settings />.
    expect(paths(componentImpact(graph, 'src/components/icons/index.tsx#Settings').routes)).toEqual([
      '/dashboard',
      '/dashboard @analytics',
      '/dashboard @analytics (default)',
      '/dashboard/settings',
    ]);
    // The whole file impacts more: Cart is in the root layout.
    expect(impact(graph, ['src/components/icons/index.tsx']).routes.length).toBe(9);
  });

  it('ranks components by impacted pages', () => {
    const ranking = rankComponents(graph);
    const button = ranking.find((r) => r.id === 'src/components/ui/Button.tsx#Button')!;
    // 9 App Router routes = 7 URLs (the @analytics slot and its default screen belong to /dashboard)
    expect(button).toEqual({ id: 'src/components/ui/Button.tsx#Button', routes: 9, pages: 7, usages: 7, files: 7 });
    expect(ranking.find((r) => r.id === 'src/components/ui/Avatar.tsx#Avatar')).toMatchObject({ routes: 0, usages: 0 });
  });
});

describe('config & languages', () => {
  let dir: string;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'impact-analyser-config-'));
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('reads impact-analyser.config.json, then .mjs, then package.json', async () => {
    expect(await loadConfig(dir)).toEqual({ config: {} });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ impactAnalyser: { lang: 'fr' } }));
    expect((await loadConfig(dir)).config).toEqual({ lang: 'fr' });
    fs.writeFileSync(path.join(dir, 'impact-analyser.config.mjs'), `export default { lang: 'en', editor: 'cursor' };`);
    expect((await loadConfig(dir)).config).toEqual({ lang: 'en', editor: 'cursor' });
    fs.writeFileSync(path.join(dir, 'impact-analyser.config.json'), JSON.stringify({ lang: 'de' }));
    await expect(loadConfig(dir)).rejects.toThrow('"lang" must be one of en, fr');
  });

  it('resolves the language: flag > config > system locale > en', () => {
    expect(resolveLang('fr', { lang: 'en' }, {})).toBe('fr');
    expect(resolveLang(undefined, { lang: 'fr' }, { LANG: 'en_US.UTF-8' })).toBe('fr');
    expect(resolveLang(undefined, {}, { LANG: 'fr_FR.UTF-8' })).toBe('fr');
    expect(resolveLang(undefined, {}, { LANG: 'en_US.UTF-8' })).toBe('en');
    expect(() => resolveLang('de', {}, {})).toThrow('--lang must be one of en, fr');
  });

  it('translates, with French plurals (0 and 1 are singular)', () => {
    const fr = createTranslator('fr');
    const en = createTranslator('en');
    expect(fr('n.impactedRoute', { n: 0 })).toBe('0 route impactée');
    expect(fr('n.impactedRoute', { n: 2 })).toBe('2 routes impactées');
    expect(en('n.impactedRoute', { n: 0 })).toBe('0 impacted routes');
    const result = impact(graph, ['src/components/ui/Modal.tsx']);
    expect(formatImpactMarkdown(graph, result, { lang: 'fr' })).toContain('### impact-analyser — 1 route impactée');
  });
});
