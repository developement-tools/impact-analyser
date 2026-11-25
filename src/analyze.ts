import fs from 'node:fs';
import path from 'node:path';
import { buildComponents } from './components.js';
import { buildModuleGraph, moduleKindOf, reverseIndex } from './graph.js';
import { toId } from './paths.js';
import { loadProject, type LoadProjectOptions, type ProjectLayout } from './project.js';
import { collectNuxtRoutes } from './nuxt/routes.js';
import { collectAppRoutes, collectPagesRoutes, findMiddleware } from './routes.js';
import { createScope, DEFAULT_INCLUDE, type Scope, type ScopeOptions } from './scope.js';
import type { ModuleNode, ProjectGraph, RouteEntry, WrapperRole } from './types.js';

export type AnalyzeOptions = LoadProjectOptions & ScopeOptions;

const IGNORED_DIRS = new Set(['node_modules', '.next', '.nuxt', '.output', '.git', 'dist', 'build', 'out', 'public', 'static', 'coverage', '.turbo']);
const NOT_APP_CODE = /\.(?:test|spec|stories)\.[cm]?[jt]sx?$|\.d\.ts$/;

/** All source/style files of the project (used to report files unreachable from any route). */
function listProjectFiles(project: ProjectLayout, inScope: Scope): string[] {
  const files: string[] = [];
  let dirs: string[] = [];
  // Files at the root of the project or of a layer are config files (nuxt.config.ts…).
  const configRoots = new Set([project.root, ...(project.nuxt?.layers.map((l) => l.rootDir) ?? [])]);
  let currentRoot = '';
  const walkRoot = (dir: string) => {
    currentRoot = dir;
    walk(dir, 0);
  };
  const walk = (dir: string, depth: number): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name) && !dirs.slice(1).includes(full) && inScope(toId(project.root, full))) walk(full, depth + 1);
      } else if (entry.isFile()) {
        // Without src/, files at the project root are config files (next.config.ts, nuxt.config.ts…).
        if (depth === 0 && configRoots.has(currentRoot)) continue;
        if (NOT_APP_CODE.test(entry.name) || moduleKindOf(entry.name) === 'asset') continue;
        const id = toId(project.root, full);
        if (inScope(id)) files.push(id);
      }
    }
  };
  // Nuxt: source folders of every layer, plus server/ and shared/ next to app/ (Nuxt 4).
  const nuxt = project.nuxt;
  const extra = nuxt
    ? [...nuxt.layers.flatMap((l) => [l.srcDir, path.join(l.rootDir, 'server'), path.join(l.rootDir, 'shared')]), ...nuxt.serverDirs]
    : [];
  dirs = [...new Set([project.srcDir, ...extra])].filter((d) => fs.existsSync(d));
  for (const dir of dirs) walkRoot(dir);
  return [...new Set(files)].sort();
}

export function analyze(root: string, options: AnalyzeOptions = {}): ProjectGraph {
  const project = loadProject(root, options);
  const inScope = createScope(options);
  const KIND_ORDER = { page: 0, default: 1, api: 2 } as const;
  const nuxtRoutes = project.nuxt ? collectNuxtRoutes(project.nuxt) : undefined;
  const middleware = nuxtRoutes ? undefined : findMiddleware(project);
  const collected = nuxtRoutes
    ? nuxtRoutes.routes
    : [...collectAppRoutes(project), ...collectPagesRoutes(project)].map((r) =>
        middleware ? { ...r, wrappers: [toId(project.root, middleware), ...r.wrappers] } : r,
      );
  // Excluded route files are dropped; excluded layouts no longer wrap their pages.
  const routes = collected
    .filter((r) => inScope(r.file))
    .map((r) => ({ ...r, wrappers: r.wrappers.filter(inScope) }))
    .sort(
    (a, b) =>
      a.router.localeCompare(b.router) ||
      a.path.localeCompare(b.path) ||
      (a.slot ?? '').localeCompare(b.slot ?? '') ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind],
  );
  const entries = [...new Set(routes.flatMap((r) => [...r.wrappers, r.file]))];
  const { modules, unresolved, excluded } = buildModuleGraph(project, entries, inScope);
  const components = buildComponents(modules, routes);

  const sortedModules: Record<string, ModuleNode> = {};
  for (const id of Object.keys(modules).sort()) sortedModules[id] = modules[id]!;

  return {
    version: 1,
    framework: project.framework,
    root: project.root,
    srcDir: toId(project.root, project.srcDir),
    ...(project.appDir && { appDir: toId(project.root, project.appDir) }),
    ...(project.pagesDir && { pagesDir: toId(project.root, project.pagesDir) }),
    routes,
    modules: sortedModules,
    components,
    importedBy: reverseIndex(modules),
    unresolved,
    unreachable: listProjectFiles(project, inScope).filter((id) => !modules[id]),
    scope: { include: options.include?.length ? options.include : DEFAULT_INCLUDE, exclude: options.exclude ?? [] },
    excluded,
    roles: nuxtRoutes ? pick(nuxtRoutes.roles, routes) : nextRoles(routes, project.pageExtensions),
    ...(project.nuxt && { nuxt: { generated: project.nuxt.generated, ...(project.nuxt.remoteLayers.length && { remoteLayers: project.nuxt.remoteLayers }) } }),
  };
}

/**
 * Next.js: the role of a wrapper is its file name without the page extension
 * (`layout.tsx`, `layout.page.tsx` -> layout). `_error` is the error page; `middleware` / `proxy` / `_middleware` are middleware.
 */
function nextRoles(routes: RouteEntry[], pageExtensions: string[]): Record<string, WrapperRole> {
  const exts = [...new Set([...pageExtensions, 'ts', 'js', 'mts', 'mjs', 'tsx', 'jsx'])].sort((a, b) => b.length - a.length);
  const stemOf = (file: string) => {
    const name = path.posix.basename(file);
    const ext = exts.find((x) => name.endsWith(`.${x}`));
    return ext ? name.slice(0, -(ext.length + 1)) : name.replace(/\.[^.]+$/, '');
  };
  const roles: Record<string, WrapperRole> = {};
  for (const route of routes) {
    for (const file of route.wrappers) {
      if (roles[file]) continue;
      const stem = stemOf(file);
      if (stem === '_error') roles[file] = { role: 'error' };
      else if (stem === 'middleware' || stem === 'proxy') roles[file] = { role: 'middleware', name: stem, global: true };
      else if (stem === '_middleware') roles[file] = { role: 'middleware', name: path.posix.dirname(file).replace(/^(?:src\/)?pages/, '') || '/' };
      else roles[file] = { role: stem };
    }
  }
  return roles;
}

/** Roles of the wrappers still in scope. */
function pick(roles: Record<string, WrapperRole>, routes: RouteEntry[]): Record<string, WrapperRole> {
  const kept = new Set(routes.flatMap((r) => [...r.wrappers, r.file]));
  return Object.fromEntries(Object.entries(roles).filter(([id]) => kept.has(id)));
}
