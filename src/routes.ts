import fs from 'node:fs';
import path from 'node:path';
import { toId } from './paths.js';
import type { ProjectLayout } from './project.js';
import type { RouteEntry } from './types.js';

/** App Router files wrapping the children of their segment, in nesting order. */
const APP_WRAPPERS = ['layout', 'template', 'error', 'loading', 'not-found', 'forbidden', 'unauthorized'];
/** App Router files that only make sense at the root of app/. */
const APP_ROOT_WRAPPERS = ['global-error', 'global-not-found'];

const ROUTE_GROUP = /^\([^.)][^)]*\)$/; // (marketing) — but not intercepting routes like (.)photo

const listDir = (dir: string): fs.Dirent[] =>
  fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));

/** Longest extensions first: with ['tsx', 'page.tsx'], `index.page.tsx` is `index` + `page.tsx`. */
const byLength = (exts: string[]) => [...exts].sort((a, b) => b.length - a.length);

function findSpecialFile(entries: fs.Dirent[], dir: string, name: string, exts: string[]): string | undefined {
  for (const ext of byLength(exts)) {
    const fileName = `${name}.${ext}`;
    if (entries.some((e) => e.isFile() && e.name === fileName)) return path.join(dir, fileName);
  }
  return undefined;
}

/**
 * `middleware.ts` (Next 12.2+) / `proxy.ts` (Next 16), next to app/ and pages/ (project root or src/).
 * It runs before every matched request; its `matcher` is not evaluated, so it is applied to every route.
 */
export function findMiddleware(project: ProjectLayout): string | undefined {
  const entries = listDir(project.srcDir);
  const exts = [...new Set([...project.pageExtensions, 'ts', 'js', 'mts', 'mjs'])];
  for (const name of ['middleware', 'proxy']) {
    const file = findSpecialFile(entries, project.srcDir, name, exts);
    if (file) return file;
  }
  return undefined;
}

export function collectAppRoutes(project: ProjectLayout): RouteEntry[] {
  const { appDir, root, pageExtensions: exts } = project;
  if (!appDir) return [];
  const routes: RouteEntry[] = [];
  const id = (abs: string) => toId(root, abs);

  const walk = (dir: string, segments: string[], inherited: string[], slot?: string) => {
    const entries = listDir(dir);
    const own: string[] = [];
    const wrapperNames = dir === appDir ? [...APP_ROOT_WRAPPERS, ...APP_WRAPPERS] : APP_WRAPPERS;
    for (const name of wrapperNames) {
      const file = findSpecialFile(entries, dir, name, exts);
      if (file) own.push(id(file));
    }
    const wrappers = [...inherited, ...own];
    const urlPath = '/' + segments.join('/');
    const withSlot = slot ? { slot } : {};

    const page = findSpecialFile(entries, dir, 'page', exts);
    if (page) routes.push({ router: 'app', kind: 'page', path: urlPath, file: id(page), wrappers, ...withSlot });

    const fallback = findSpecialFile(entries, dir, 'default', exts);
    if (fallback) {
      routes.push({ router: 'app', kind: 'default', path: urlPath, file: id(fallback), wrappers, ...withSlot });
    }

    // Route handlers are not wrapped by layouts.
    const handler = findSpecialFile(entries, dir, 'route', exts);
    if (handler) routes.push({ router: 'app', kind: 'api', path: urlPath, file: id(handler), wrappers: [] });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      // _folder = private folder, excluded from routing.
      if (name.startsWith('_') || name === 'node_modules') continue;
      const child = path.join(dir, name);
      if (ROUTE_GROUP.test(name)) walk(child, segments, wrappers, slot);
      else if (name.startsWith('@')) walk(child, segments, wrappers, name.slice(1));
      else walk(child, [...segments, name], wrappers, slot);
    }
  };

  walk(appDir, [], []);
  return routes;
}

export function collectPagesRoutes(project: ProjectLayout): RouteEntry[] {
  const { pagesDir, root, pageExtensions } = project;
  if (!pagesDir) return [];
  const exts = byLength(pageExtensions);
  const routes: RouteEntry[] = [];
  const id = (abs: string) => toId(root, abs);
  const baseOf = (fileName: string) => {
    if (fileName.endsWith('.d.ts')) return undefined;
    const ext = exts.find((x) => fileName.endsWith(`.${x}`));
    return ext ? fileName.slice(0, -(ext.length + 1)) : undefined;
  };

  // _document and _app wrap every page; _error replaces the page when it fails (like an error boundary).
  const rootEntries = listDir(pagesDir);
  const special = (name: string) => findSpecialFile(rootEntries, pagesDir, name, exts);
  const documentAndApp = ['_document', '_app'].map(special).filter((f): f is string => Boolean(f)).map(id);
  const errorPage = special('_error');
  const ROOT_SPECIAL = new Set(['_app', '_document', '_error']);

  /** `middleware`: Next 12.0-12.1 `_middleware` files of the folder and its parents, outermost first. */
  const walk = (dir: string, segments: string[], middleware: string[]) => {
    const entries = listDir(dir);
    const own = entries.find((e) => e.isFile() && baseOf(e.name) === '_middleware');
    const scoped = own ? [...middleware, id(path.join(dir, own.name))] : middleware;
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(full, [...segments, entry.name], scoped);
        continue;
      }
      const base = baseOf(entry.name);
      if (!base || base === '_middleware') continue;
      if (segments.length === 0 && ROOT_SPECIAL.has(base)) continue;

      const parts = base === 'index' ? segments : [...segments, base];
      const isApi = segments[0] === 'api';
      routes.push({
        router: 'pages',
        kind: isApi ? 'api' : 'page',
        path: '/' + parts.join('/'),
        file: id(full),
        wrappers: isApi ? scoped : [...scoped, ...documentAndApp, ...(errorPage ? [id(errorPage)] : [])],
      });
    }
  };

  walk(pagesDir, [], []);
  return routes;
}
