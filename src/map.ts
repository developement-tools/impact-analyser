// AI-oriented project map: a compact, deterministic Markdown file (docs/impact-map.md by default).
// Written for code assistants: stable headings to search (`### <Button>`, file paths), one fact per line,
// no timestamp (an unchanged project gives an identical file, so git diffs only show real changes).
import path from 'node:path';
import { componentImpact, impact, type ImpactedRoute } from './impact.js';
import type { ComponentInfo, ModuleNode, ProjectGraph, PropUsage, RouteEntry } from './types.js';

export const DEFAULT_OUTPUT = { dir: 'docs', file: 'impact-map.md' } as const;

/** Pages listed in full up to this count; above, the first ones and "+N more". */
const MAX_LISTED_PAGES = 15;
const MAX_SNIPPET = 140;
const IGNORED_PROPS = new Set(['children', 'key', 'ref']);

const plural = (n: number, one: string, other: string) => `${n} ${n === 1 ? one : other}`;
const code = (text: string) => `\`${text.replace(/`/g, "'")}\``;
const pageKey = (r: RouteEntry) => `${r.router}:${r.path}`;

/** Distinct URLs (slots and default.tsx belong to their page, API routes excluded). */
function pagesOf(routes: ImpactedRoute[]): string[] {
  return [...new Set(routes.filter((r) => r.route.kind !== 'api').map((r) => r.route.path))].sort();
}

function allPages(graph: ProjectGraph): string[] {
  return [...new Set(graph.routes.filter((r) => r.kind !== 'api').map(pageKey))].sort();
}

function pageList(pages: string[], total: number): string {
  if (pages.length === 0) return 'none';
  if (pages.length === total) return `all ${total}`;
  const shown = pages.slice(0, MAX_LISTED_PAGES).map(code).join(', ');
  return `${pages.length}/${total}: ${shown}${pages.length > MAX_LISTED_PAGES ? `, +${pages.length - MAX_LISTED_PAGES} more` : ''}`;
}

/** `<Button variant="primary" size={2} onClick={…} />` (JSX) or `<BaseButton variant="primary" :size="2" @click="…" />` (Vue). */
export function usageSnippet(tag: string, props: PropUsage[], vue: boolean): string {
  const parts = [`<${tag}`];
  for (const p of props) {
    if (IGNORED_PROPS.has(p.name)) continue;
    if (p.kind === 'spread') parts.push(vue ? `v-bind="${p.value}"` : `{...${p.value}}`);
    else if (p.kind === 'literal' && p.type === 'boolean' && p.value === 'true') parts.push(p.name);
    else if (p.kind === 'literal' && p.type === 'string') parts.push(`${p.name}="${p.value}"`);
    else if (vue && p.name.startsWith('v-')) parts.push(`${p.name}="${p.value}"`);
    else if (vue && /^on[A-Z]/.test(p.name)) parts.push(`@${p.name.charAt(2).toLowerCase()}${p.name.slice(3)}="${p.value}"`);
    else parts.push(vue ? `:${p.name}="${p.value}"` : `${p.name}={${p.value}}`);
  }
  const text = `${parts.join(' ')} />`;
  return text.length > MAX_SNIPPET ? `${text.slice(0, MAX_SNIPPET - 4)}… />` : text;
}

/** `variant: "primary"×2 | "danger"×1 | unset×2 | expr×1` for each prop passed to the component. */
function propsSummary(component: ComponentInfo): string[] {
  const stats = new Map<string, { values: Map<string, number>; expr: number; set: number }>();
  for (const usage of component.usages) {
    for (const p of usage.props) {
      if (p.kind === 'spread' || IGNORED_PROPS.has(p.name)) continue;
      const s = stats.get(p.name) ?? { values: new Map(), expr: 0, set: 0 };
      s.set++;
      if (p.kind === 'literal') {
        const v = p.type === 'string' ? `"${p.value}"` : p.value;
        s.values.set(v, (s.values.get(v) ?? 0) + 1);
      } else s.expr++;
      stats.set(p.name, s);
    }
  }
  const total = component.usages.length;
  return [...stats.entries()]
    .sort((a, b) => b[1].set - a[1].set || a[0].localeCompare(b[0]))
    .map(([name, s]) => {
      const values = [...s.values.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([v, n]) => `${v}×${n}`);
      if (s.expr) values.push(`expr×${s.expr}`);
      if (total - s.set > 0) values.push(`unset×${total - s.set}`);
      return `${name}: ${values.join(' | ')}`;
    });
}

function roleText(graph: ProjectGraph, file: string): string {
  const role = graph.roles[file];
  if (!role) return path.posix.basename(file);
  return role.name && role.name !== role.role ? `${role.role} ${role.name}` : role.role;
}

/** Components rendered by a module (direct JSX / template usages), by name. */
function rendered(graph: ProjectGraph, mod: ModuleNode | undefined, self?: string): string[] {
  const names = new Set<string>();
  for (const u of mod?.usages ?? []) {
    const c = graph.components[u.component];
    if (c && c.id !== self) names.add(`<${c.name}>`);
  }
  return [...names].sort();
}

function frameworkLine(graph: ProjectGraph): string {
  const fw = graph.framework;
  const name = fw.name === 'nuxt' ? 'Nuxt' : 'Next.js';
  const version = fw.version?.replace(/^[^\d]*/, '');
  const routers = [...new Set(graph.routes.map((r) => r.router))].map((r) => ({ app: 'App Router', pages: 'Pages Router', nuxt: 'pages/' })[r]);
  return `${name}${version ? ` ${version}` : ''}${fw.name === 'next' && routers.length ? ` (${routers.join(' + ')})` : ''}`;
}

/** Nuxt calls hooks "composables". */
const categoryName = (category: string, vue: boolean) => (vue && category === 'hook' ? 'composable' : category);

export interface ImpactMapOptions {
  /** Project name shown in the title (default: folder name). */
  name?: string;
}

/** Builds the Markdown map of a project. Pure: same graph, same text. */
export function formatImpactMap(graph: ProjectGraph, options: ImpactMapOptions = {}): string {
  const vue = graph.framework.name === 'nuxt';
  const total = allPages(graph).length;
  const components = Object.values(graph.components).sort((a, b) => a.name.localeCompare(b.name) || a.module.localeCompare(b.module));
  const componentPages = new Map(components.map((c) => [c.id, pagesOf(componentImpact(graph, c.id).routes)]));
  const componentModules = new Set(components.map((c) => c.module));
  const sharedModules = Object.values(graph.modules)
    .filter((m) => ['hook', 'util', 'style'].includes(m.category) && !componentModules.has(m.id))
    .sort((a, b) => a.id.localeCompare(b.id));
  const modulePages = new Map(sharedModules.map((m) => [m.id, pagesOf(impact(graph, [m.id], { cwd: graph.root }).routes)]));
  const neverRendered = components.filter((c) => c.usages.length === 0);
  const sources = Object.values(graph.modules).filter((m) => m.kind === 'source').length;
  const L: string[] = [];

  // ------------------------------------------------------------ header
  L.push(`# Impact map — ${options.name ?? path.basename(graph.root)}`, '');
  L.push('> Generated by impact-analyser (static analysis). Do not edit: run `impact-analyser generate`.');
  L.push('> Find a component with `### <Name>`, a file by its path. "Pages" = distinct URLs whose render can change.');
  L.push(`> Before changing a component or module, check its pages and usages below; high-impact items are listed first.`, '');

  L.push('## Summary', '');
  L.push(`- Framework: ${frameworkLine(graph)}`);
  L.push(`- Source dir: ${code(graph.srcDir || '.')}`);
  L.push(`- Scope: include ${graph.scope.include.map(code).join(' ')}${graph.scope.exclude.length ? ` · exclude ${graph.scope.exclude.map(code).join(' ')}` : ''}`);
  L.push(`- ${plural(total, 'page', 'pages')} · ${plural(graph.routes.length, 'route', 'routes')} · ${plural(components.length, 'component', 'components')} · ${plural(sources, 'source module', 'source modules')}`);
  L.push(`- Dead code: ${plural(graph.unreachable.length, 'unreachable file', 'unreachable files')} · ${plural(neverRendered.length, 'component never rendered', 'components never rendered')}`);
  if (graph.nuxt && !graph.nuxt.generated) L.push('- Warning: .nuxt not generated, auto-import names inferred from Nuxt conventions (run `nuxi prepare`).');
  L.push('');

  // ------------------------------------------------------------ high impact
  const high = [
    ...components.map((c) => ({ label: `<${c.name}>`, file: c.module, kind: 'component', pages: componentPages.get(c.id)!.length })),
    ...sharedModules.map((m) => ({ label: path.posix.basename(m.id), file: m.id, kind: categoryName(m.category, vue), pages: modulePages.get(m.id)!.length })),
  ]
    .filter((x) => total > 0 && x.pages / total >= 0.5)
    .sort((a, b) => b.pages - a.pages || a.label.localeCompare(b.label));
  L.push('## High impact (≥ 50% of pages: change with care)', '');
  if (high.length === 0) L.push('None.');
  for (const x of high) L.push(`- ${code(x.label)} ${x.kind} — ${x.pages}/${total} pages — ${code(x.file)}`);
  L.push('');

  // ------------------------------------------------------------ routes
  // Wrappers shared by every page (Nuxt app.vue, plugins, global middleware…) are listed once.
  const pageRoutes = graph.routes.filter((r) => r.kind !== 'api');
  const globalWrappers = pageRoutes.length > 1 ? pageRoutes[0]!.wrappers.filter((w) => pageRoutes.every((r) => r.wrappers.includes(w))) : [];
  const globalSet = new Set(globalWrappers);
  L.push('## Routes', '');
  L.push('Format: `URL` [kind] → page file · wrappers (outermost first) · components rendered by the page file.', '');
  if (globalWrappers.length) L.push(`Every page is also wrapped by: ${globalWrappers.map((w) => `${roleText(graph, w)} ${code(w)}`).join(' > ')}`, '');
  for (const r of graph.routes) {
    const tags = [r.kind !== 'page' && r.kind, r.slot && `@${r.slot}`, r.router !== 'nuxt' && r.router].filter(Boolean).join(', ');
    const parts = [`- ${code(r.path)}${tags ? ` [${tags}]` : ''} → ${code(r.file)}`];
    const own = r.wrappers.filter((w) => !globalSet.has(w));
    if (own.length) parts.push(`wrappers: ${own.map((w) => `${roleText(graph, w)} ${code(w)}`).join(' > ')}`);
    const renders = rendered(graph, graph.modules[r.file]);
    if (renders.length) parts.push(`renders: ${renders.join(' ')}`);
    L.push(parts.join(' · '));
  }
  L.push('');

  // ------------------------------------------------------------ wrappers
  const wrapperPages = new Map<string, Set<string>>();
  for (const r of graph.routes) {
    if (r.kind === 'api') continue;
    for (const w of r.wrappers) (wrapperPages.get(w) ?? wrapperPages.set(w, new Set()).get(w)!).add(r.path);
  }
  if (wrapperPages.size > 0) {
    L.push('## Layouts and wrappers', '');
    L.push('A change in a wrapper applies to every page it wraps.', '');
    for (const [file, pages] of [...wrapperPages.entries()].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))) {
      const renders = rendered(graph, graph.modules[file]);
      L.push(`- ${code(file)} (${roleText(graph, file)}) — pages ${pageList([...pages].sort(), total)}${renders.length ? ` · renders ${renders.join(' ')}` : ''}`);
    }
    L.push('');
  }

  // ------------------------------------------------------------ components
  L.push('## Components', '');
  for (const c of components) {
    const mod = graph.modules[c.module];
    const pages = componentPages.get(c.id)!;
    L.push(`### <${c.name}>`, '');
    L.push(`- file: ${code(c.module)}${c.export !== 'default' ? ` (export ${c.export})` : ''}${c.client ? ' · client' : ''}`);
    L.push(`- pages: ${pageList(pages, total)}`);
    const props = propsSummary(c);
    if (props.length) L.push(`- props: ${props.join(' ; ')}`);
    const renders = rendered(graph, mod, c.id);
    if (renders.length) L.push(`- renders: ${renders.join(' ')}`);
    if (c.usages.length === 0) L.push('- used in: nowhere (dead code candidate)');
    else {
      L.push(`- used in (${c.usages.length}):`);
      const usages = [...c.usages].sort((a, b) => a.module.localeCompare(b.module) || a.line - b.line);
      for (const u of usages) L.push(`  - ${code(`${u.module}:${u.line}`)} ${code(usageSnippet(u.tag, u.props, vue))}`);
    }
    L.push('');
  }

  // ------------------------------------------------------------ shared modules
  if (sharedModules.length > 0) {
    L.push('## Shared modules', '');
    L.push(`Hooks${vue ? ' / composables' : ''}, utilities and styles imported by components or pages.`, '');
    for (const m of sharedModules) {
      const importers = (graph.importedBy[m.id] ?? []).slice().sort();
      L.push(`- ${code(m.id)} (${categoryName(m.category, vue)})${m.exports.length ? ` exports ${m.exports.slice().sort().map(code).join(' ')}` : ''}`);
      // A module without runtime export (types, interfaces) cannot change a render.
      L.push(m.exports.length === 0 && m.kind === 'source' ? '  - pages: none (types only, no runtime impact)' : `  - pages: ${pageList(modulePages.get(m.id)!, total)}`);
      if (importers.length) L.push(`  - imported by: ${importers.map(code).join(', ')}`);
    }
    L.push('');
  }

  // ------------------------------------------------------------ dead code
  L.push('## Dead code', '');
  if (graph.unreachable.length === 0 && neverRendered.length === 0 && graph.unresolved.length === 0) L.push('None.');
  for (const f of graph.unreachable) L.push(`- unreachable file: ${code(f)}`);
  for (const c of neverRendered) L.push(`- component never rendered: ${code(`<${c.name}>`)} in ${code(c.module)}`);
  for (const u of graph.unresolved) L.push(`- unresolved import: ${code(u.specifier)} in ${code(u.from)}`);
  L.push('');

  return L.join('\n');
}
