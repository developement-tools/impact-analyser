import fs from 'node:fs';
import path from 'node:path';
import { toId } from './paths.js';
import type { ImportEdge, ProjectGraph, RouteEntry } from './types.js';

const ALL = '*';

export interface ImpactOptions {
  /** Also follow `import type` edges (off by default: they have no runtime impact). */
  includeTypeOnly?: boolean;
  /** Base directory for relative input paths (defaults to process.cwd()). */
  cwd?: string;
}

export interface ImpactedRoute {
  route: RouteEntry;
  /** Entry file of the route that reaches the target: the page itself or one of its wrappers. */
  entry: string;
  /** Shortest import chain from `entry` to the changed file. */
  chain: string[];
}

export interface ImpactResult {
  /** Changed files found in the graph. */
  targets: string[];
  /** Inputs that are not part of the graph (unused file, typo, file outside the project…). */
  notInGraph: string[];
  /** Modules importing the targets, directly or transitively. */
  dependents: string[];
  routes: ImpactedRoute[];
  /** Import edges (importer -> imported) through which the impact propagated. */
  edges: Array<{ from: string; to: string }>;
}

/** Number of distinct pages (URLs) among routes: slots and `default.tsx` belong to their page, API routes are not pages. */
export function countPages(routes: ImpactedRoute[]): number {
  return new Set(routes.filter((r) => r.route.kind !== 'api').map((r) => `${r.route.router}:${r.route.path}`)).size;
}

export interface RankedModule {
  id: string;
  /** Number of routes impacted by a change to this module. */
  routes: number;
  /** Number of distinct pages (URLs) impacted. */
  pages: number;
  /** Number of modules depending on it, directly or transitively. */
  dependents: number;
  /** Number of modules importing it directly. */
  importers: number;
}

/** Accepts an absolute path, a path relative to cwd, or a path relative to the project root. */
export function toModuleId(graph: ProjectGraph, input: string, cwd = process.cwd()): string {
  const candidates = path.isAbsolute(input) ? [input] : [path.resolve(cwd, input), path.resolve(graph.root, input)];
  const ids = candidates.map((c) => toId(graph.root, c));
  return (
    ids.find((id) => graph.modules[id]) ??
    ids[candidates.findIndex((c) => fs.existsSync(c))] ??
    ids[ids.length - 1]!
  );
}

type Importers = Map<string, Array<{ from: string; edge: ImportEdge }>>;

function buildImporters(graph: ProjectGraph, includeTypeOnly = false): Importers {
  const importers: Importers = new Map();
  for (const mod of Object.values(graph.modules)) {
    for (const edge of mod.imports) {
      if (edge.kind === 'type' && !includeTypeOnly) continue;
      const list = importers.get(edge.to) ?? [];
      list.push({ from: mod.id, edge });
      importers.set(edge.to, list);
    }
  }
  return importers;
}

/** Every runtime export of a module (`*` when it has `export *`, which is not expanded). */
function allExportsOf(graph: ProjectGraph, id: string): Set<string> {
  const mod = graph.modules[id];
  const star = mod?.imports.some((e) => e.kind === 'reexport' && e.names.includes(ALL) && !e.aliases);
  return star || !mod ? new Set([ALL]) : new Set(mod.exports);
}

/** Names re-exported by the barrel `edge` that are affected, given the affected names of its source. */
function forwardReexport(graph: ProjectGraph, edge: ImportEdge, affected: Set<string>, source: string): Set<string> {
  const out = new Set<string>();
  const everything = affected.has(ALL);
  edge.names.forEach((name, i) => {
    const alias = edge.aliases?.[i];
    if (name === ALL && alias) {
      out.add(alias); // export * as ns from '…'
    } else if (name === ALL) {
      // export * from '…' (never re-exports `default`)
      for (const n of everything ? allExportsOf(graph, source) : affected) if (n !== 'default') out.add(n);
    } else if (everything || affected.has(name)) {
      out.add(alias ?? name);
    }
  });
  return out;
}

/**
 * Reverse propagation of the affected export names (`*` = the whole module is affected).
 * A module importing an affected name is affected as a whole; a barrel only forwards
 * the names it re-exports, so `import { Button } from '@/ui'` is not hit by a change to Card.
 */
function propagate(graph: ProjectGraph, importers: Importers, seeds: Array<[string, Set<string>]>) {
  const affected = new Map<string, Set<string>>();
  // `towardTarget[x]` = next hop from x toward a target (null for targets), for the chains.
  const towardTarget = new Map<string, string | null>();
  const edges = new Map<string, { from: string; to: string }>();
  const queue: string[] = [];

  const mark = (id: string, names: Set<string>, via: string | null) => {
    if (names.size === 0) return;
    if (via) edges.set(`${id}\0${via}`, { from: id, to: via });
    const current = affected.get(id);
    if (!current) {
      affected.set(id, new Set(names.has(ALL) ? [ALL] : names));
      towardTarget.set(id, via);
      queue.push(id);
      return;
    }
    if (current.has(ALL)) return;
    const before = current.size;
    if (names.has(ALL)) {
      current.clear();
      current.add(ALL);
    } else {
      for (const n of names) current.add(n);
    }
    if (current.size !== before || current.has(ALL)) queue.push(id);
  };

  for (const [target, names] of seeds) mark(target, names, null);
  while (queue.length > 0) {
    const current = queue.shift()!;
    const names = affected.get(current)!;
    for (const { from, edge } of importers.get(current) ?? []) {
      if (edge.kind === 'reexport') {
        mark(from, forwardReexport(graph, edge, names, current), current);
      } else if (names.has(ALL) || edge.names.some((n) => n === ALL || names.has(n))) {
        mark(from, new Set([ALL]), current);
      }
    }
  }

  return { towardTarget, edges: [...edges.values()] };
}

function impactedRoutes(graph: ProjectGraph, towardTarget: Map<string, string | null>): ImpactedRoute[] {
  const chainFrom = (id: string): string[] => {
    const chain = [id];
    for (let next = towardTarget.get(id); next; next = towardTarget.get(next)) chain.push(next);
    return chain;
  };
  const routes: ImpactedRoute[] = [];
  for (const route of graph.routes) {
    // Prefer the page itself, then the innermost wrapper.
    const entry = [route.file, ...[...route.wrappers].reverse()].find((f) => towardTarget.has(f));
    if (entry) routes.push({ route, entry, chain: chainFrom(entry) });
  }
  return routes;
}

export function impact(graph: ProjectGraph, inputs: string[], options: ImpactOptions = {}): ImpactResult {
  const ids = [...new Set(inputs.map((input) => toModuleId(graph, input, options.cwd)))];
  const targets = ids.filter((id) => graph.modules[id]);
  const notInGraph = ids.filter((id) => !graph.modules[id]);

  const seeds = targets.map((t): [string, Set<string>] => [t, new Set([ALL])]);
  const { towardTarget, edges } = propagate(graph, buildImporters(graph, options.includeTypeOnly), seeds);
  const targetSet = new Set(targets);
  return {
    targets,
    notInGraph,
    dependents: [...towardTarget.keys()].filter((id) => !targetSet.has(id)).sort(),
    routes: impactedRoutes(graph, towardTarget),
    edges,
  };
}

/** Impact of every module of the graph, most impactful first: the "riskiest" files to change. */
export function rankModules(graph: ProjectGraph, options: Pick<ImpactOptions, 'includeTypeOnly'> = {}): RankedModule[] {
  const importers = buildImporters(graph, options.includeTypeOnly);
  const ranking: RankedModule[] = [];
  for (const id of Object.keys(graph.modules)) {
    const { towardTarget } = propagate(graph, importers, [[id, new Set([ALL])]]);
    const routes = impactedRoutes(graph, towardTarget);
    ranking.push({
      id,
      routes: routes.length,
      pages: countPages(routes),
      dependents: towardTarget.size - 1,
      importers: new Set((importers.get(id) ?? []).map((i) => i.from)).size,
    });
  }
  return ranking.sort((a, b) => b.pages - a.pages || b.routes - a.routes || b.dependents - a.dependents || a.id.localeCompare(b.id));
}

/** Export names to propagate when a component changes (the whole file when its siblings render it). */
function componentSeed(graph: ProjectGraph, componentId: string): [string, Set<string>] | undefined {
  const component = graph.components[componentId];
  if (!component) return undefined;
  const mod = graph.modules[component.module];
  const usedBySibling = component.usages.some((u) => u.module === component.module);
  const names = usedBySibling || !mod || mod.exports.length <= 1 ? ALL : component.export;
  return [component.module, new Set([names])];
}

/**
 * Impact of a change to one component: unlike `impact()` on its file, other components
 * exported by the same file are not considered changed.
 */
export function componentImpact(
  graph: ProjectGraph,
  componentId: string,
  options: Pick<ImpactOptions, 'includeTypeOnly'> = {},
): ImpactResult {
  const seed = componentSeed(graph, componentId);
  if (!seed) return { targets: [], notInGraph: [componentId], dependents: [], routes: [], edges: [] };
  const { towardTarget, edges } = propagate(graph, buildImporters(graph, options.includeTypeOnly), [seed]);
  return {
    targets: [seed[0]],
    notInGraph: [],
    dependents: [...towardTarget.keys()].filter((id) => id !== seed[0]).sort(),
    routes: impactedRoutes(graph, towardTarget),
    edges,
  };
}

export interface RankedComponent {
  id: string;
  /** Number of routes impacted by a change to this component. */
  routes: number;
  /** Number of distinct pages (URLs) impacted. */
  pages: number;
  /** Number of JSX usages. */
  usages: number;
  /** Number of files rendering it. */
  files: number;
}

/** Components sorted by impact: the ones to change with the most care first. */
export function rankComponents(graph: ProjectGraph, options: Pick<ImpactOptions, 'includeTypeOnly'> = {}): RankedComponent[] {
  const importers = buildImporters(graph, options.includeTypeOnly);
  return Object.values(graph.components)
    .map((component) => {
      const seed = componentSeed(graph, component.id)!;
      const { towardTarget } = propagate(graph, importers, [seed]);
      const routes = impactedRoutes(graph, towardTarget);
      return {
        id: component.id,
        routes: routes.length,
        pages: countPages(routes),
        usages: component.usages.length,
        files: new Set(component.usages.map((u) => u.module)).size,
      };
    })
    .sort((a, b) => b.pages - a.pages || b.routes - a.routes || b.usages - a.usages || a.id.localeCompare(b.id));
}
