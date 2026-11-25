import path from 'node:path';
import type { Lang } from './config.js';
import type { ClassifiedChanges } from './git.js';
import { createTranslator } from './i18n.js';
import type { ImpactResult } from './impact.js';
import type { ImportEdge, ModuleNode, ProjectGraph, RouteEntry } from './types.js';

export interface FormatOptions {
  lang?: Lang;
}

const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const color = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = color('1');
const dim = color('2');
const cyan = color('36');
const green = color('32');
const yellow = color('33');
const magenta = color('35');

const ROUTER_TITLE = { app: 'App Router', pages: 'Pages Router', nuxt: 'Nuxt' } as const;
const ROUTERS = ['app', 'pages', 'nuxt'] as const;

/** Role of a wrapper: layout, template, _app… (Next.js), `layout:dashboard`, `middleware:auth`… (Nuxt). */
function roleOf(graph: ProjectGraph, id: string): string {
  const role = graph.roles?.[id];
  if (!role) return path.posix.basename(id).replace(/\.[^.]+$/, '');
  return role.name && role.name !== role.role ? `${role.role}:${role.name}` : role.role;
}

export function routeLabel(route: RouteEntry): string {
  const tags = [route.slot && `@${route.slot}`, route.kind !== 'page' && route.kind].filter(Boolean);
  return tags.length > 0 ? `${route.path} ${dim(`[${tags.join(' ')}]`)}` : route.path;
}

const visibleLength = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '').length;
const padEnd = (s: string, width: number) => s + ' '.repeat(Math.max(0, width - visibleLength(s)));

function moduleTags(mod: ModuleNode | undefined): string {
  if (!mod) return '';
  const tags: string[] = [];
  if (mod.client) tags.push(yellow('client'));
  if (mod.kind === 'style') tags.push(magenta('style'));
  return tags.length > 0 ? ' ' + tags.join(' ') : '';
}

export function formatRoutes(graph: ProjectGraph, options: FormatOptions = {}): string {
  const t = createTranslator(options.lang);
  const lines: string[] = [];
  for (const router of ROUTERS) {
    const routes = graph.routes.filter((r) => r.router === router);
    if (routes.length === 0) continue;
    const dir = router === 'app' ? graph.appDir : graph.pagesDir;
    const title = router === 'nuxt' && graph.framework.major ? `Nuxt ${graph.framework.major}` : ROUTER_TITLE[router];
    lines.push(`${bold(title)} ${dim(dir ?? '')}`);
    const labels = routes.map(routeLabel);
    const width = Math.max(...labels.map(visibleLength)) + 2;
    routes.forEach((route, i) => {
      const wrappers = route.wrappers.length > 0 ? dim(` (+${route.wrappers.map((w) => roleOf(graph, w)).join(', ')})`) : '';
      lines.push(`  ${padEnd(cyan(labels[i]!), width)}${route.file}${wrappers}`);
    });
    lines.push('');
  }
  const sources = Object.values(graph.modules).filter((m) => m.kind === 'source').length;
  const components = Object.keys(graph.components).length;
  lines.push(
    dim(
      [
        t('n.route', { n: graph.routes.length }),
        t('n.module', { n: sources }),
        t('n.component', { n: components }),
        t('n.unusedFile', { n: graph.unreachable.length }),
      ].join(' · '),
    ),
  );
  return lines.join('\n');
}

export interface TreeOptions extends FormatOptions {
  includeTypeOnly?: boolean;
  /** Max depth (default: unlimited). */
  depth?: number;
}

/** Dependency tree of the routes matching `urlPath` (wrappers first, then the page). */
export function formatTree(graph: ProjectGraph, urlPath: string, options: TreeOptions = {}): string {
  const routes = graph.routes.filter((r) => r.path === urlPath);
  if (routes.length === 0) {
    throw new Error(createTranslator(options.lang)('tree.noRoute', { path: urlPath }));
  }
  const maxDepth = options.depth ?? Infinity;
  const lines: string[] = [];

  for (const route of routes) {
    lines.push(`${bold(cyan(routeLabel(route)))} ${dim(`${ROUTER_TITLE[route.router]} · ${route.kind}`)}`);
    const seen = new Set<string>();

    /**
     * `wanted` = names used from this module by its parent (`*` = all). Through a barrel,
     * only the re-exports actually used are shown: `import { Button } from '@/ui'` hides Card.
     */
    const printNode = (id: string, wanted: Set<string>, prefix: string, isLast: boolean, depth: number, label?: string) => {
      const mod = graph.modules[id];
      // Only barrels show a different subtree depending on the names used.
      const isBarrel = mod?.imports.some((e) => e.kind === 'reexport') ?? false;
      const partial = isBarrel && !wanted.has('*');
      const seenKey = partial ? `${id}|${[...wanted].sort().join(',')}` : id;
      const branch = depth === 0 ? '' : isLast ? '└─ ' : '├─ ';
      const repeated = seen.has(seenKey);
      const head = label ? `${green(`[${label}]`)} ` : '';
      const used = partial ? dim(` { ${[...wanted].join(', ')} }`) : '';
      lines.push(`${prefix}${branch}${head}${id}${used}${moduleTags(mod)}${repeated && mod?.imports.length ? dim(' …') : ''}`);
      if (repeated || !mod || depth >= maxDepth) return;
      seen.add(seenKey);

      const children: Array<{ edge: ImportEdge; names: Set<string> }> = [];
      for (const edge of mod.imports) {
        if (edge.kind === 'type' && !options.includeTypeOnly) continue;
        if (edge.kind !== 'reexport' || !partial) {
          children.push({ edge, names: new Set(edge.kind === 'reexport' ? ['*'] : edge.names) });
          continue;
        }
        // Keep only the re-exports providing a wanted name, mapped back to their original name.
        const names = new Set<string>();
        edge.names.forEach((name, i) => {
          const exported = edge.aliases?.[i] ?? name;
          if (name === '*' && !edge.aliases?.[i]) for (const w of wanted) names.add(w); // export *
          else if (wanted.has(exported)) names.add(name);
        });
        if (names.size > 0) children.push({ edge, names });
      }

      const childPrefix = depth === 0 ? prefix : prefix + (isLast ? '   ' : '│  ');
      children.forEach(({ edge, names }, i) => {
        const tag = edge.kind === 'dynamic' ? 'dynamic' : undefined;
        printNode(edge.to, names, childPrefix, i === children.length - 1, depth + 1, tag);
      });
    };

    const all = new Set(['*']);
    for (const wrapper of route.wrappers) printNode(wrapper, all, '  ', true, 0, roleOf(graph, wrapper));
    printNode(route.file, all, '  ', true, 0, route.kind);
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

export interface ImpactContext extends FormatOptions {
  /** Set with `--since`: how the changed files were sorted. */
  changes?: ClassifiedChanges;
  since?: string;
}

const plainRouteLabel = (route: RouteEntry): string => {
  const tags = [route.slot && `@${route.slot}`, route.kind !== 'page' && route.kind].filter(Boolean);
  return tags.length > 0 ? `${route.path} [${tags.join(' ')}]` : route.path;
};

export function formatImpact(graph: ProjectGraph, result: ImpactResult, context: ImpactContext = {}): string {
  const t = createTranslator(context.lang);
  const lines: string[] = [];
  const { changes, since } = context;

  if (changes) {
    const total = changes.inGraph.length + changes.global.length + changes.unused.length;
    lines.push(`${bold(t('impact.changesSince', { ref: since ?? '' }))} ${dim(t('impact.inProject', { files: t('n.file', { n: total }) }))}`);
    for (const id of changes.global) lines.push(yellow(`  ${t('impact.globalChanged', { file: id })}`));
    if (changes.unused.length > 0) {
      const files = t('n.changedFile', { n: changes.unused.length });
      lines.push(dim(`  ${t('impact.unusedChanged', { files, list: changes.unused.join(', ') })}`));
    }
    lines.push('');
  } else {
    for (const id of result.notInGraph) lines.push(yellow(t('impact.notInGraph', { file: id })));
  }
  if (result.targets.length === 0) {
    if (changes) lines.push(green(t('impact.none')));
    return lines.join('\n').trimEnd();
  }

  lines.push(`${bold(t('impact.of'))} ${result.targets.join(', ')}`);
  const direct = [...new Set(result.targets.flatMap((t) => graph.importedBy[t] ?? []))]
    .filter((id) => !result.targets.includes(id))
    .sort();
  lines.push(
    dim(
      `  ${t('n.directImporter', { n: direct.length })} · ${t('n.dependent', { n: result.dependents.length })} · ${t('n.route', { n: result.routes.length })}`,
    ),
  );
  lines.push('');

  if (direct.length > 0) {
    lines.push(bold(t('impact.directlyImportedBy')));
    for (const id of direct) lines.push(`  ${id}${moduleTags(graph.modules[id])}`);
    lines.push('');
  }

  for (const router of ROUTERS) {
    const impacted = result.routes.filter((r) => r.route.router === router);
    if (impacted.length === 0) continue;
    lines.push(bold(`${ROUTER_TITLE[router]} — ${t('n.impactedRoute', { n: impacted.length })}`));
    for (const { route, entry, chain } of impacted) {
      const through = entry === route.file ? '' : dim(` via ${roleOf(graph, entry)}`);
      lines.push(`  ${cyan(routeLabel(route))}${through}`);
      lines.push(dim(`    ${chain.join(' → ')}`));
    }
    lines.push('');
  }

  if (result.routes.length === 0) lines.push(green(t('impact.none')));
  return lines.join('\n').trimEnd();
}

/** Markdown report, e.g. for a pull request comment. */
export function formatImpactMarkdown(_graph: ProjectGraph, result: ImpactResult, context: ImpactContext = {}): string {
  const t = createTranslator(context.lang);
  const { changes, since } = context;
  const code = (s: string) => `\`${s}\``;
  const lines: string[] = [`### impact-analyser — ${t('n.impactedRoute', { n: result.routes.length })}`, ''];

  if (changes?.global.length) {
    lines.push(`> [!WARNING]`);
    lines.push(`> ${t('md.globalWarning', { files: changes.global.map(code).join(', ') })}`, '');
  }
  const changed = result.targets.length > 0 ? result.targets.map(code).join(', ') : t('md.noneUsed');
  const sinceText = since ? ` ${t('md.since', { ref: code(since) })}` : '';
  const colon = context.lang === 'fr' ? ' :' : ':'; // French typography: space before the colon
  lines.push(`**${t('md.changedFiles')}${sinceText}${colon}** ${changed}`, '');

  if (result.routes.length > 0) {
    lines.push(t('md.headers'), '|---|---|---|');
    for (const { route, chain } of result.routes) {
      const shortChain = chain.map((id) => path.posix.basename(id)).join(' → ');
      lines.push(`| ${ROUTER_TITLE[route.router]} | ${code(plainRouteLabel(route))} | ${shortChain} |`);
    }
    lines.push('');
  }
  if (changes?.unused.length) {
    const files = t('n.changedFile', { n: changes.unused.length });
    lines.push(`<details><summary>${t('md.unusedSummary', { files })}</summary>`, '');
    for (const id of changes.unused) lines.push(`- ${code(id)}`);
    lines.push('', '</details>');
  }
  return lines.join('\n').trimEnd();
}
