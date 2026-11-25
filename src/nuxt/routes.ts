// Nuxt routes: pages/ (nested routes, layouts, middleware), app.vue, error page, plugins, server routes.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { toId } from '../paths.js';
import type { RouteEntry, WrapperRole } from '../types.js';
import { kebabCase, stripModeSuffix } from './naming.js';
import type { NuxtContext } from './project.js';

const require = createRequire(import.meta.url);
const sfc = require('@vue/compiler-sfc') as typeof import('@vue/compiler-sfc');

const PAGE_EXT = /\.(?:vue|[jt]sx|[cm]?[jt]s)$/;
const SERVER_EXT = /\.(?:[cm]?[jt]s)$/;
const HTTP_METHOD = /\.(?:get|post|put|patch|delete|head|options|connect|trace)$/;
const ROUTE_GROUP = /^\(.*\)$/;

const read = (file: string) => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
};
const listDir = (dir: string): fs.Dirent[] => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
};

interface PageMeta {
  layout?: string | false;
  middleware?: string[];
}

/** Script content of a page (both blocks of a .vue file). */
function scriptsOf(file: string): string[] {
  const text = read(file);
  if (!file.endsWith('.vue')) return [text];
  try {
    const { descriptor } = sfc.parse(text, { filename: file });
    return [descriptor.script?.content, descriptor.scriptSetup?.content].filter((s): s is string => Boolean(s));
  } catch {
    return [];
  }
}

const stringsOf = (node: ts.Expression | undefined): string[] | undefined => {
  if (!node) return undefined;
  if (ts.isStringLiteralLike(node)) return [node.text];
  if (ts.isArrayLiteralExpression(node)) return node.elements.filter(ts.isStringLiteralLike).map((e) => e.text);
  return undefined;
};

/**
 * Layout and middleware of a page:
 * Nuxt 3/4 `definePageMeta({ layout: 'x' | false, middleware: 'auth' })`,
 * Nuxt 2 `export default { layout: 'x', middleware: ['auth'] }`.
 */
export function readPageMeta(file: string): PageMeta {
  const meta: PageMeta = {};
  const readObject = (obj: ts.ObjectLiteralExpression) => {
    for (const prop of obj.properties) {
      if (!ts.isPropertyAssignment(prop) || !(ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))) continue;
      const key = prop.name.text;
      const value = prop.initializer;
      if (key === 'layout') {
        if (value.kind === ts.SyntaxKind.FalseKeyword) meta.layout = false;
        else if (ts.isStringLiteralLike(value)) meta.layout = value.text;
      } else if (key === 'middleware') {
        const names = stringsOf(value);
        if (names) meta.middleware = names;
      }
    }
  };
  for (const content of scriptsOf(file)) {
    const sf = ts.createSourceFile('page.ts', content, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'definePageMeta') {
        const [arg] = node.arguments;
        if (arg && ts.isObjectLiteralExpression(arg)) readObject(arg);
      }
      if (ts.isExportAssignment(node)) {
        let expr = node.expression;
        // export default defineComponent({...}) / Vue.extend({...})
        if (ts.isCallExpression(expr) && expr.arguments[0]) expr = expr.arguments[0];
        if (ts.isObjectLiteralExpression(expr)) readObject(expr);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return meta;
}

/** URL segment of a file / folder name: `[id]`, `[[opt]]`, `[...slug]`; Nuxt 2 `_id` -> `[id]`, `_` -> `[...all]`. */
function segmentOf(name: string, major: number): string {
  if (name === 'index') return '';
  if (major === 2) {
    if (name === '_') return '[...all]';
    if (name.startsWith('_')) return `[${name.slice(1)}]`;
  }
  return name;
}

export interface NuxtRoutes {
  routes: RouteEntry[];
  roles: Record<string, WrapperRole>;
}

export function collectNuxtRoutes(ctx: NuxtContext): NuxtRoutes {
  const { rootDir, srcDir, major } = ctx;
  const id = (abs: string) => toId(rootDir, abs);
  const routes: RouteEntry[] = [];
  const roles: Record<string, WrapperRole> = {};

  // ------------------------------------------------------------ global wrappers
  const globalWrappers: string[] = [];
  for (const file of ctx.plugins) {
    roles[id(file)] = { role: 'plugin', name: stripModeSuffix(path.basename(file).replace(/\.[^.]+$/, '')).stem };
    globalWrappers.push(id(file));
  }
  for (const file of ctx.globalCss) {
    roles[id(file)] = { role: 'style', name: path.basename(file) };
    globalWrappers.push(id(file));
  }
  for (const [name, mw] of ctx.middleware) {
    if (!mw.global) continue;
    roles[id(mw.file)] = { role: 'middleware', name, global: true };
    globalWrappers.push(id(mw.file));
  }
  // Server (Nitro) plugins and middleware run for every request: pages and API routes.
  const serverWrappers: string[] = [];
  for (const file of ctx.serverPlugins) {
    roles[id(file)] = { role: 'server-plugin', name: path.basename(file).replace(/\.[^.]+$/, '') };
    serverWrappers.push(id(file));
  }
  for (const file of ctx.serverMiddleware) {
    roles[id(file)] = { role: 'server-middleware', name: path.basename(file).replace(/\.[^.]+$/, '') };
    serverWrappers.push(id(file));
  }
  globalWrappers.unshift(...serverWrappers);

  // app.vue / error.vue: from the app, else from the first layer providing one.
  const srcDirs = ctx.layers.map((l) => l.srcDir);
  const firstFile = (names: string[]) => srcDirs.flatMap((d) => names.map((n) => path.join(d, n))).find((f) => fs.existsSync(f));
  const appVue = major > 2 ? firstFile(['app.vue', 'app.tsx', 'app.jsx']) : undefined;
  if (appVue) {
    roles[id(appVue)] = { role: 'app' };
    globalWrappers.push(id(appVue));
  }
  const errorPage = major === 2 ? path.join(srcDir, 'layouts', 'error.vue') : firstFile(['error.vue', 'error.tsx']);
  if (errorPage && fs.existsSync(errorPage)) {
    roles[id(errorPage)] = { role: 'error' };
    globalWrappers.push(id(errorPage));
  }
  for (const [name, file] of ctx.layouts) roles[id(file)] = { role: 'layout', name };

  // Nuxt 3+: layouts are rendered only by <NuxtLayout> (the default app.vue has one).
  const layoutsEnabled = major === 2 || !appVue || /<(?:NuxtLayout|nuxt-layout)\b/.test(read(appVue));

  const wrappersFor = (chain: string[]): string[] => {
    const meta: PageMeta = {};
    for (const file of chain) {
      const own = readPageMeta(file);
      if (own.layout !== undefined) meta.layout = own.layout; // children override their parents
      if (own.middleware) meta.middleware = [...(meta.middleware ?? []), ...own.middleware];
    }
    const wrappers = [...globalWrappers];
    for (const name of meta.middleware ?? []) {
      const mw = ctx.middleware.get(major === 2 ? name : kebabCase(name)) ?? ctx.middleware.get(name);
      if (mw && !mw.global) {
        roles[id(mw.file)] = { role: 'middleware', name };
        wrappers.push(id(mw.file));
      }
    }
    if (layoutsEnabled && meta.layout !== false) {
      const layout = ctx.layouts.get(meta.layout ? kebabCase(meta.layout) : 'default') ?? (meta.layout ? ctx.layouts.get(meta.layout) : undefined);
      if (layout) wrappers.push(id(layout));
    }
    for (const parent of chain.slice(0, -1)) wrappers.push(id(parent));
    return wrappers;
  };

  // ------------------------------------------------------------ pages/
  const urlOf = (segments: string[]) => '/' + segments.filter(Boolean).join('/');
  const walk = (dir: string, segments: string[], parents: string[]): void => {
    const entries = listDir(dir);
    const dirs = new Set(entries.filter((e) => e.isDirectory()).map((e) => e.name));
    const handledDirs = new Set<string>();

    for (const entry of entries) {
      if (!entry.isFile() || !PAGE_EXT.test(entry.name) || entry.name.endsWith('.d.ts')) continue;
      const full = path.join(dir, entry.name);
      const raw = entry.name.replace(/\.[^.]+$/, '');
      const { stem } = stripModeSuffix(raw);
      const routeSegments = [...segments, segmentOf(stem, major)];

      if (dirs.has(stem)) {
        // pages/parent.vue + pages/parent/: parent wraps its children (<NuxtPage /> / <NuxtChild />).
        handledDirs.add(stem);
        const childDir = path.join(dir, stem);
        const hasIndex = listDir(childDir).some((e) => e.isFile() && PAGE_EXT.test(e.name) && stripModeSuffix(e.name.replace(/\.[^.]+$/, '')).stem === 'index');
        roles[id(full)] = { role: 'parent', name: urlOf(routeSegments) };
        if (!hasIndex) routes.push({ router: 'nuxt', kind: 'page', path: urlOf(routeSegments), file: id(full), wrappers: wrappersFor([...parents, full]) });
        walk(childDir, routeSegments, [...parents, full]);
      } else {
        routes.push({ router: 'nuxt', kind: 'page', path: urlOf(routeSegments), file: id(full), wrappers: wrappersFor([...parents, full]) });
      }
    }
    for (const name of dirs) {
      if (handledDirs.has(name) || name.startsWith('.') || name === 'node_modules') continue;
      // (group) folders organise pages without adding a URL segment.
      walk(path.join(dir, name), ROUTE_GROUP.test(name) ? segments : [...segments, segmentOf(name, major)], parents);
    }
  };
  // Pages of every layer; for the same URL, the layer with the highest priority wins.
  for (const dir of ctx.pagesDirs) {
    const before = routes.length;
    walk(dir, [], []);
    const added = routes.splice(before);
    const taken = new Set(routes.map((r) => `${r.kind}|${r.path}`));
    for (const r of added) if (!taken.has(`${r.kind}|${r.path}`)) routes.push(r);
  }
  if (ctx.pagesDirs.length === 0 && appVue) {
    // No pages/: app.vue is the only page.
    routes.push({ router: 'nuxt', kind: 'page', path: '/', file: id(appVue), wrappers: globalWrappers.filter((w) => w !== id(appVue)) });
  }

  // ------------------------------------------------------------ server/api, server/routes
  for (const serverDir of ctx.serverDirs) {
    const walkServer = (dir: string, segments: string[]): void => {
      for (const entry of listDir(dir)) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walkServer(full, [...segments, entry.name]);
        else if (entry.isFile() && SERVER_EXT.test(entry.name) && !entry.name.endsWith('.d.ts')) {
          const stem = entry.name.replace(/\.[^.]+$/, '').replace(HTTP_METHOD, '');
          const url = urlOf([...segments, stem === 'index' ? '' : stem]);
          // Same API route in several layers: the first (highest priority) wins.
          if (!routes.some((r) => r.kind === 'api' && r.path === url)) routes.push({ router: 'nuxt', kind: 'api', path: url, file: id(full), wrappers: [...serverWrappers] });
        }
      }
    };
    walkServer(path.join(serverDir, 'api'), ['api']);
    walkServer(path.join(serverDir, 'routes'), []);
  }

  return { routes, roles };
}
