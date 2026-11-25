// Nuxt 2 / 3 / 4 project layout: directories, aliases, auto-imported components and composables.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import type { FrameworkInfo } from '../framework.js';
import { componentName, camelCase, kebabCase, stripModeSuffix } from './naming.js';

export interface NuxtComponent {
  /** PascalCase name used in templates: `BaseButton`. */
  name: string;
  /** Absolute path of the component file. */
  file: string;
}

export interface NuxtAutoImport {
  /** Absolute path of the module exporting it. */
  file: string;
  /** Export name in that module (`default` for a default export). */
  export: string;
}

/** A Nuxt layer: the app itself, a folder of `layers/`, or a local `extends` entry. */
export interface NuxtLayer {
  /** Folder name (`base` for layers/base), `app` for the project itself. */
  name: string;
  rootDir: string;
  srcDir: string;
  /** Contents of its nuxt.config (read statically). */
  config: string;
}

export interface NuxtContext {
  /** 2, 3 or 4. Unknown versions are treated as 3. */
  major: number;
  rootDir: string;
  srcDir: string;
  /** Layers by priority: the app first, then `layers/*`, then `extends`. */
  layers: NuxtLayer[];
  /** `extends` entries that are not local folders (npm packages, git repositories): not analysed. */
  remoteLayers: string[];
  /** Layer folders outside the project root (local `extends: ['../base']`). */
  extraRoots: string[];
  /** pages/ folders of every layer, by priority. */
  pagesDirs: string[];
  /** server/ folders of every layer (Nitro: api, routes, middleware, plugins, utils). */
  serverDirs: string[];
  /** pages/ folder of the app (or of the first layer having one). */
  pagesDir?: string;
  /** Auto-imported components by name (Lazy* variants excluded). */
  components: Map<string, NuxtComponent>;
  /** Component name of each component file. */
  componentNames: Map<string, string>;
  /** Auto-imported composables / utils by name (project files only). */
  imports: Map<string, NuxtAutoImport>;
  /** Layouts by name (`default`, `dashboard`, `desktop-default`…). */
  layouts: Map<string, string>;
  /** Route middleware by name; `global` ones run on every route. */
  middleware: Map<string, { file: string; global: boolean }>;
  /** Plugins, run on every route. */
  plugins: string[];
  /** Global stylesheets of nuxt.config `css: [...]`, loaded on every route. */
  globalCss: string[];
  /** Nitro auto-imports (server/utils, shared/utils), available in server files only. */
  serverImports: Map<string, NuxtAutoImport>;
  /** Nitro middleware (server/middleware): run on every request. */
  serverMiddleware: string[];
  /** Nitro plugins (server/plugins): run when the server starts, for every request. */
  serverPlugins: string[];
  /** `.nuxt` type files were found: names come from Nuxt itself rather than from conventions. */
  generated: boolean;
}

const COMPONENT_EXT = /\.(?:vue|[jt]sx)$/;
const SCRIPT_EXT = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const RESOLVE_EXT = ['', '.ts', '.js', '.mjs', '.mts', '.tsx', '.jsx', '.vue', '/index.ts', '/index.js', '/index.mjs'];

const isDir = (p: string) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};
const isFile = (p: string) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};
const read = (p: string) => {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return undefined;
  }
};

function walkFiles(dir: string, out: string[] = []): string[] {
  if (!isDir(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/** A local project file: not in node_modules, inside the project or one of its local layers. */
const isProjectFile = (roots: string | string[], file: string) =>
  !file.includes(`${path.sep}node_modules${path.sep}`) && [roots].flat().some((root) => !path.relative(root, file).startsWith('..'));

function resolveWithExtensions(base: string): string | undefined {
  for (const ext of RESOLVE_EXT) if (isFile(base + ext)) return base + ext;
  return undefined;
}

function findConfig(rootDir: string): string | undefined {
  for (const name of ['nuxt.config.ts', 'nuxt.config.js', 'nuxt.config.mjs', 'nuxt.config.mts', 'nuxt.config.cjs']) {
    const file = path.join(rootDir, name);
    if (isFile(file)) return read(file);
  }
  return undefined;
}

/** `srcDir` of the project: explicit in nuxt.config, `app/` in Nuxt 4, the root before. */
function resolveSrcDir(rootDir: string, major: number, config: string): string {
  const explicit = config.match(/\bsrcDir\s*:\s*['"`]([^'"`]+)['"`]/)?.[1];
  if (explicit) return path.resolve(rootDir, explicit);
  const app = path.join(rootDir, 'app');
  const v4 = major >= 4 || /compatibilityVersion\s*:\s*4/.test(config);
  const looksLikeSrc = ['pages', 'components', 'layouts'].some((d) => isDir(path.join(app, d))) || isFile(path.join(app, 'app.vue'));
  if (v4 && looksLikeSrc) return app;
  // Version unknown: app/ holds the code only when the root does not.
  if (major !== 2 && looksLikeSrc && !isDir(path.join(rootDir, 'pages')) && !isFile(path.join(rootDir, 'app.vue'))) return app;
  return rootDir;
}

// ------------------------------------------------------------------ components

/** Parses .nuxt/components.d.ts (Nuxt 3/4) or .nuxt/components/index.js (Nuxt 2). */
function readGeneratedComponents(rootDir: string | string[], buildDir: string): Map<string, NuxtComponent> | undefined {
  const sources = [
    path.join(buildDir, 'components.d.ts'),
    path.join(buildDir, 'types', 'components.d.ts'),
    path.join(buildDir, 'components', 'index.js'),
  ];
  const patterns = [
    // export const BaseButton: typeof import("../components/base/Button.vue")['default']
    // 'BaseButton': typeof import("../components/base/Button.vue")['default']
    /['"]?(\w+)['"]?\s*:\s*(?:LazyComponent<\s*)?(?:IslandComponent<\s*)?typeof\s+import\(\s*["']([^"']+)["']\s*\)/g,
    // Nuxt 2: export const BaseButton = () => import('../../components/base/Button.vue' /* … */)
    /export\s+const\s+(\w+)\s*=\s*\(\)\s*=>\s*import\(\s*['"]([^'"]+)['"]/g,
    // Nuxt 2 (non lazy): export { default as BaseButton } from '../../components/base/Button.vue'
    /export\s*\{\s*default\s+as\s+(\w+)\s*\}\s*from\s*['"]([^'"]+)['"]/g,
  ];
  for (const source of sources) {
    const text = read(source);
    if (!text) continue;
    const found = new Map<string, NuxtComponent>();
    for (const pattern of patterns) {
      for (const [, name, spec] of text.matchAll(pattern)) {
        if (!name || !spec || !spec.startsWith('.')) continue;
        const file = resolveWithExtensions(path.resolve(path.dirname(source), spec));
        if (!file || !isProjectFile(rootDir, file)) continue;
        if (!found.has(name)) found.set(name, { name, file });
      }
    }
    // Lazy* entries point to the same files: the Lazy prefix is handled when resolving a tag.
    for (const [name, comp] of found) {
      if (name.startsWith('Lazy') && found.get(name.slice(4))?.file === comp.file) found.delete(name);
    }
    if (found.size > 0) return found;
  }
  return undefined;
}

/** Components registered by convention: every file of components/, named after its path. */
function conventionComponents(srcDir: string, pathPrefix: boolean): Map<string, NuxtComponent> {
  const dir = path.join(srcDir, 'components');
  const found = new Map<string, NuxtComponent>();
  for (const file of walkFiles(dir)) {
    if (!COMPONENT_EXT.test(file)) continue;
    const name = componentName(path.relative(dir, file).split(path.sep).join('/'), pathPrefix);
    if (name && !found.has(name)) found.set(name, { name, file });
  }
  return found;
}

// ------------------------------------------------------------------ auto-imports

/** Parses .nuxt/imports.d.ts: `export { useCart, a as b } from '../composables/useCart'`. */
function readGeneratedImports(rootDir: string | string[], buildDir: string): Map<string, NuxtAutoImport> | undefined {
  const source = path.join(buildDir, 'imports.d.ts');
  const text = read(source);
  if (!text) return undefined;
  const sf = ts.createSourceFile(source, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const found = new Map<string, NuxtAutoImport>();
  for (const statement of sf.statements) {
    if (!ts.isExportDeclaration(statement) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const spec = statement.moduleSpecifier.text;
    if (!spec.startsWith('.') || !statement.exportClause || !ts.isNamedExports(statement.exportClause)) continue;
    const file = resolveWithExtensions(path.resolve(path.dirname(source), spec));
    if (!file || !isProjectFile(rootDir, file)) continue;
    for (const el of statement.exportClause.elements) {
      found.set(el.name.text, { file, export: (el.propertyName ?? el.name).text });
    }
  }
  return found;
}

/** .nuxt/types/nitro-imports.d.ts: `const useDb: typeof import('../../server/utils/db').useDb`. */
function readGeneratedServerImports(roots: string[], buildDir: string): Map<string, NuxtAutoImport> | undefined {
  const source = path.join(buildDir, 'types', 'nitro-imports.d.ts');
  const text = read(source);
  if (!text) return undefined;
  const found = new Map<string, NuxtAutoImport>();
  for (const [, name, spec, exported] of text.matchAll(/const\s+(\w+)\s*:\s*typeof\s+import\(\s*['"]([^'"]+)['"]\s*\)\s*(?:\.(\w+)|\[['"](\w+)['"]\])/g)) {
    if (!name || !spec || !spec.startsWith('.')) continue;
    const file = resolveWithExtensions(path.resolve(path.dirname(source), spec));
    if (file && isProjectFile(roots, file)) found.set(name, { file, export: exported ?? name });
  }
  return found;
}

/** Runtime exports of a script file (types excluded), for the conventional auto-imports. */
function scriptExports(file: string): string[] {
  const text = read(file);
  if (!text) return [];
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false);
  const names: string[] = [];
  for (const s of sf.statements) {
    const exported = ts.canHaveModifiers(s) && ts.getModifiers(s)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (ts.isExportAssignment(s)) names.push('default');
    else if (exported && ts.getModifiers(s)?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) names.push('default');
    else if (exported && ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name)) names.push(d.name.text);
    } else if (exported && (ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s)) && s.name) names.push(s.name.text);
    else if (ts.isExportDeclaration(s) && !s.isTypeOnly && s.exportClause && ts.isNamedExports(s.exportClause)) {
      for (const el of s.exportClause.elements) if (!el.isTypeOnly) names.push(el.name.text);
    }
  }
  return names;
}

/** composables/ and utils/: top-level files and `<folder>/index.*` (Nuxt 3+ defaults). */
function conventionImports(dirs: string[]): Map<string, NuxtAutoImport> {
  const found = new Map<string, NuxtAutoImport>();
  for (const dir of dirs) {
    if (!isDir(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      const file = entry.isDirectory() ? resolveWithExtensions(path.join(full, 'index')) : entry.isFile() && SCRIPT_EXT.test(entry.name) && !entry.name.endsWith('.d.ts') ? full : undefined;
      if (!file) continue;
      const stem = entry.isDirectory() ? entry.name : entry.name.replace(/\.[^.]+$/, '');
      for (const name of scriptExports(file)) {
        const local = name === 'default' ? camelCase(stem) : name;
        if (!found.has(local)) found.set(local, { file, export: name });
      }
    }
  }
  return found;
}

// ------------------------------------------------------------------ layouts, middleware, plugins

function layoutsOf(layoutsDir: string | undefined, major: number): Map<string, string> {
  const layouts = new Map<string, string>();
  if (!layoutsDir) return layouts;
  for (const file of walkFiles(layoutsDir)) {
    if (!COMPONENT_EXT.test(file)) continue;
    const rel = path.relative(layoutsDir, file).split(path.sep).join('/').replace(/\.[^.]+$/, '');
    const name = rel
      .split('/')
      .map((p) => kebabCase(p))
      .join('-')
      .replace(/-index$/, '');
    // Nuxt 2: layouts/error.vue is the error page, not a layout.
    if (major === 2 && name === 'error') continue;
    layouts.set(name, file);
  }
  return layouts;
}

function middlewareOf(dir: string, major: number, config: string): Map<string, { file: string; global: boolean }> {
  const found = new Map<string, { file: string; global: boolean }>();
  if (!isDir(dir)) return found;
  // Nuxt 2: global middleware are listed in nuxt.config `router: { middleware: [...] }`.
  const configGlobal = new Set(
    major === 2 ? [...(config.match(/router\s*:\s*\{[\s\S]*?middleware\s*:\s*(\[[^\]]*\]|['"][^'"]+['"])/)?.[1] ?? '').matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]!) : [],
  );
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const file = entry.isDirectory() ? resolveWithExtensions(path.join(full, 'index')) : entry.isFile() && SCRIPT_EXT.test(entry.name) ? full : undefined;
    if (!file) continue;
    const { stem, mode } = stripModeSuffix(entry.isDirectory() ? entry.name : entry.name.replace(/\.[^.]+$/, ''));
    const name = major === 2 ? stem : kebabCase(stem);
    found.set(name, { file, global: mode === 'global' || configGlobal.has(stem) });
  }
  return found;
}

function pluginsOf(srcDir: string, rootDir: string, major: number, config: string): string[] {
  if (major === 2) {
    // Nuxt 2: plugins are declared in nuxt.config, e.g. plugins: ['~/plugins/toast.js', { src: '~/plugins/x', mode: 'client' }]
    const block = config.match(/\bplugins\s*:\s*\[([\s\S]*?)\]/)?.[1] ?? '';
    return [...block.matchAll(/['"]((?:~~?|@@?|\.)?\/?[^'"]*plugins\/[^'"]+)['"]/g)]
      .map((m) => m[1]!.replace(/^(?:~~|@@)\//, `${rootDir}/`).replace(/^[~@]\//, `${srcDir}/`))
      .map((p) => resolveWithExtensions(path.resolve(rootDir, p)))
      .filter((f): f is string => Boolean(f));
  }
  const dir = path.join(srcDir, 'plugins');
  if (!isDir(dir)) return [];
  const plugins: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    const file = entry.isDirectory() ? resolveWithExtensions(path.join(full, 'index')) : entry.isFile() && SCRIPT_EXT.test(entry.name) ? full : undefined;
    if (file) plugins.push(file);
  }
  return plugins;
}

/** nuxt.config `css: ['~/assets/main.css', '@/assets/x.scss']`: project files only (npm packages are skipped). */
function globalCssOf(srcDir: string, rootDir: string, config: string): string[] {
  const block = config.match(/\bcss\s*:\s*\[([\s\S]*?)\]/)?.[1] ?? '';
  return [...block.matchAll(/['"`]([^'"`]+)['"`]/g)]
    .map((m) => m[1]!)
    .filter((p) => /^(?:~~?|@@?)\/|^\.\.?\//.test(p))
    .map((p) => p.replace(/^(?:~~|@@)\//, `${rootDir}/`).replace(/^[~@]\//, `${srcDir}/`))
    .map((p) => resolveWithExtensions(path.resolve(rootDir, p)))
    .filter((f): f is string => Boolean(f));
}

// ------------------------------------------------------------------ compiler options

const ALIAS_KEYS = ['~', '@', '~~', '@@', '#shared'];

/** tsconfig generated by Nuxt (.nuxt/tsconfig*.json), else the project's, plus Nuxt's default aliases. */
export function nuxtCompilerOptions(ctx: { rootDir: string; srcDir: string; layers?: NuxtLayer[] }, buildDir: string, fallback: ts.CompilerOptions): ts.CompilerOptions {
  let options: ts.CompilerOptions = { ...fallback };
  for (const name of ['tsconfig.app.json', 'tsconfig.json']) {
    const file = path.join(buildDir, name);
    if (!isFile(file)) continue;
    const { config } = ts.readConfigFile(file, ts.sys.readFile);
    if (!config) continue;
    const parsed = ts.parseJsonConfigFileContent(config, ts.sys, buildDir, undefined, file);
    options = { ...options, ...parsed.options, allowJs: true };
    break;
  }
  // Absolute targets, so they do not depend on pathsBasePath.
  const targets: Record<string, string> = { '~': ctx.srcDir, '@': ctx.srcDir, '~~': ctx.rootDir, '@@': ctx.rootDir, '#shared': path.join(ctx.rootDir, 'shared') };
  const paths = { ...(options.paths ?? {}) };
  const base = (options as { pathsBasePath?: string }).pathsBasePath ?? options.baseUrl ?? ctx.rootDir;
  // Make existing targets absolute too: aliases from several sources share one base.
  for (const [key, list] of Object.entries(paths)) paths[key] = list.map((t) => path.resolve(base, t));
  for (const alias of ALIAS_KEYS) {
    paths[alias] ??= [targets[alias]!];
    paths[`${alias}/*`] ??= [`${targets[alias]!}/*`];
  }
  // Nuxt 3.16+: `#layers/<name>` points to the root of each layer.
  for (const layer of ctx.layers?.slice(1) ?? []) {
    paths[`#layers/${layer.name}`] ??= [layer.rootDir];
    paths[`#layers/${layer.name}/*`] ??= [`${layer.rootDir}/*`];
  }
  return { ...options, paths, pathsBasePath: ctx.rootDir } as ts.CompilerOptions;
}

// ------------------------------------------------------------------ entry

/** `extends: '../base'` / `extends: ['./a', 'github:org/b', '@acme/layer']` of a nuxt.config. */
function extendsOf(config: string): string[] {
  const value = config.match(/\bextends\s*:\s*(\[[\s\S]*?\]|['"`][^'"`]+['"`])/)?.[1] ?? '';
  return [...value.matchAll(/['"`]([^'"`]+)['"`]/g)].map((m) => m[1]!);
}
const isLocalLayer = (entry: string) => /^(?:\.{1,2}\/|\/|~~\/|@@\/)/.test(entry);

/** App, then `layers/*` (Nuxt 3.12+, alphabetical), then local `extends` entries (recursively). */
function discoverLayers(rootDir: string, major: number, appConfig: string): { layers: NuxtLayer[]; remote: string[] } {
  const layers: NuxtLayer[] = [];
  const remote: string[] = [];
  const seen = new Set<string>();
  const add = (dir: string, name: string, config: string) => {
    const real = path.resolve(dir);
    if (seen.has(real)) return false;
    seen.add(real);
    layers.push({ name, rootDir: real, srcDir: resolveSrcDir(real, major, config), config });
    return true;
  };
  const visitExtends = (layer: NuxtLayer) => {
    for (const entry of extendsOf(layer.config)) {
      if (!isLocalLayer(entry)) {
        remote.push(entry);
        continue;
      }
      const dir = path.resolve(layer.rootDir, entry.replace(/^(?:~~|@@)\//, `${rootDir}/`));
      if (!isDir(dir)) continue;
      if (add(dir, path.basename(dir), findConfig(dir) ?? '')) visitExtends(layers[layers.length - 1]!);
    }
  };

  add(rootDir, 'app', appConfig);
  if (major > 2) {
    const auto = path.join(rootDir, 'layers');
    if (isDir(auto)) {
      for (const entry of fs.readdirSync(auto, { withFileTypes: true }).filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
        const dir = path.join(auto, entry.name);
        if (add(dir, entry.name, findConfig(dir) ?? '')) visitExtends(layers[layers.length - 1]!);
      }
    }
  }
  visitExtends(layers[0]!);
  return { layers, remote };
}

/** Same name in several layers: the layer with the highest priority (first) wins. */
function mergeByPriority<T>(layers: NuxtLayer[], read: (layer: NuxtLayer) => Map<string, T>): Map<string, T> {
  const merged = new Map<string, T>();
  for (const layer of layers) for (const [key, value] of read(layer)) if (!merged.has(key)) merged.set(key, value);
  return merged;
}

const serverDirOf = (layer: NuxtLayer) => [path.join(layer.rootDir, 'server'), path.join(layer.srcDir, 'server')].find(isDir);
const topLevelScripts = (dir: string) => {
  if (!isDir(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => (e.isDirectory() ? resolveWithExtensions(path.join(dir, e.name, 'index')) : e.isFile() && SCRIPT_EXT.test(e.name) && !e.name.endsWith('.d.ts') ? path.join(dir, e.name) : undefined))
    .filter((f): f is string => Boolean(f));
};

export function loadNuxtContext(rootDir: string, framework: FrameworkInfo): NuxtContext {
  const config = findConfig(rootDir) ?? '';
  const major = framework.major && framework.major >= 2 ? framework.major : /compatibilityVersion\s*:\s*4/.test(config) ? 4 : 3;
  const { layers, remote } = discoverLayers(rootDir, major, config);
  const app = layers[0]!;
  const srcDir = app.srcDir;
  const roots = layers.map((l) => l.rootDir);
  const extraRoots = roots.filter((r) => path.relative(rootDir, r).startsWith('..'));
  const buildDir = path.join(rootDir, config.match(/\bbuildDir\s*:\s*['"`]([^'"`]+)['"`]/)?.[1] ?? '.nuxt');

  // Nuxt 2 registers components only with `components: true` (2.13+); folder prefixes since 2.15.
  const nuxt2Components = /\bcomponents\s*:\s*(?:true|\{|\[)/.test(config);
  const [, minor] = (framework.version?.match(/(\d+)\.(\d+)/) ?? []).map(Number);
  const pathPrefix = major > 2 || (minor ?? 15) >= 15;

  const generatedComponents = readGeneratedComponents(roots, buildDir);
  const components = new Map<string, NuxtComponent>();
  if (major > 2 || nuxt2Components || generatedComponents) {
    for (const [name, comp] of generatedComponents ?? []) components.set(name, comp);
    // Conventions complete the generated list: files added since the last `nuxt prepare` / `nuxt dev`.
    const known = new Set([...components.values()].map((c) => c.file));
    for (const [name, comp] of mergeByPriority(layers, (l) => conventionComponents(l.srcDir, pathPrefix))) {
      if (!components.has(name) && !known.has(comp.file)) components.set(name, comp);
    }
  }
  const componentNames = new Map<string, string>();
  for (const comp of components.values()) if (!componentNames.has(comp.file)) componentNames.set(comp.file, comp.name);

  const generatedImports = major > 2 ? readGeneratedImports(roots, buildDir) : undefined;
  const imports = new Map<string, NuxtAutoImport>(generatedImports ?? []);
  if (major > 2) {
    const conventional = mergeByPriority(layers, (l) =>
      conventionImports([path.join(l.srcDir, 'composables'), path.join(l.srcDir, 'utils'), path.join(l.rootDir, 'shared', 'utils'), path.join(l.rootDir, 'shared', 'types')]),
    );
    for (const [name, entry] of conventional) if (!imports.has(name)) imports.set(name, entry);
  }

  // Nitro (server/): auto-imported utils, middleware and plugins of every layer.
  const serverDirs = layers.map(serverDirOf).filter((d): d is string => Boolean(d));
  const serverImports = new Map<string, NuxtAutoImport>(major > 2 ? (readGeneratedServerImports(roots, buildDir) ?? []) : []);
  if (major > 2) {
    const conventional = mergeByPriority(layers, (l) => {
      const server = serverDirOf(l);
      return conventionImports([...(server ? [path.join(server, 'utils')] : []), path.join(l.rootDir, 'shared', 'utils')]);
    });
    for (const [name, entry] of conventional) if (!serverImports.has(name)) serverImports.set(name, entry);
  }

  const pagesDirs = layers.map((l) => path.join(l.srcDir, 'pages')).filter(isDir);
  const layouts = mergeByPriority(layers, (l) => layoutsOf(isDir(path.join(l.srcDir, 'layouts')) ? path.join(l.srcDir, 'layouts') : undefined, major));
  const middleware = mergeByPriority(layers, (l) => middlewareOf(path.join(l.srcDir, 'middleware'), major, l.config));
  const plugins = [...new Set(layers.flatMap((l) => pluginsOf(l.srcDir, l.rootDir, major, l.config)))];
  const globalCss = [...new Set(layers.flatMap((l) => globalCssOf(l.srcDir, l.rootDir, l.config)))];

  return {
    major,
    rootDir,
    srcDir,
    layers,
    remoteLayers: remote,
    extraRoots,
    pagesDirs,
    serverDirs,
    ...(pagesDirs[0] && { pagesDir: pagesDirs[0] }),
    components,
    componentNames,
    imports,
    layouts,
    middleware,
    plugins,
    globalCss,
    serverImports,
    serverMiddleware: serverDirs.flatMap((d) => topLevelScripts(path.join(d, 'middleware'))),
    serverPlugins: serverDirs.flatMap((d) => topLevelScripts(path.join(d, 'plugins'))),
    generated: Boolean(generatedComponents || generatedImports),
  };
}
