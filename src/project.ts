import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { detectFramework, type FrameworkInfo, type FrameworkName } from './framework.js';
import { loadNuxtContext, nuxtCompilerOptions, type NuxtContext } from './nuxt/project.js';

export const DEFAULT_PAGE_EXTENSIONS = ['tsx', 'ts', 'jsx', 'js'];

export interface LoadProjectOptions {
  /** Same as `pageExtensions` in next.config. Defaults to tsx, ts, jsx, js. */
  pageExtensions?: string[];
  /** Force the framework instead of detecting it from package.json. */
  framework?: FrameworkName;
}

export interface ProjectLayout {
  root: string;
  /** Directory holding app/ and pages/: the root itself, or `<root>/src`. */
  srcDir: string;
  appDir?: string;
  pagesDir?: string;
  pageExtensions: string[];
  compilerOptions: ts.CompilerOptions;
  framework: FrameworkInfo;
  /** Nuxt projects only: directories, auto-imported components and composables. */
  nuxt?: NuxtContext;
}

export const isDir = (p: string): boolean => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

export const isFile = (p: string): boolean => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

export function loadProject(rootInput: string, options: LoadProjectOptions = {}): ProjectLayout {
  const root = path.resolve(rootInput);
  if (!isDir(root)) throw new Error(`Project directory not found: ${root}`);
  const framework = detectFramework(root, options.framework);

  if (framework.name === 'nuxt') {
    const nuxt = loadNuxtContext(root, framework);
    if (!nuxt.pagesDir && !fs.existsSync(path.join(nuxt.srcDir, 'app.vue'))) {
      throw new Error(`No pages/ directory nor app.vue found in ${nuxt.srcDir}`);
    }
    return {
      root,
      srcDir: nuxt.srcDir,
      ...(nuxt.pagesDir && { pagesDir: nuxt.pagesDir }),
      pageExtensions: options.pageExtensions ?? ['vue', 'tsx', 'jsx', 'ts', 'js'],
      compilerOptions: nuxtCompilerOptions(nuxt, path.join(root, '.nuxt'), readCompilerOptions(root)),
      framework,
      nuxt,
    };
  }

  // Next.js ignores src/ when app/ or pages/ exist at the root.
  const atRoot = isDir(path.join(root, 'app')) || isDir(path.join(root, 'pages'));
  const srcDir = atRoot ? root : path.join(root, 'src');
  const appDir = isDir(path.join(srcDir, 'app')) ? path.join(srcDir, 'app') : undefined;
  const pagesDir = isDir(path.join(srcDir, 'pages')) ? path.join(srcDir, 'pages') : undefined;
  if (!appDir && !pagesDir) {
    throw new Error(`No app/ or pages/ directory found in ${root} (nor in ${path.join(root, 'src')})`);
  }

  return {
    root,
    srcDir,
    appDir,
    pagesDir,
    // impact-analyser config > next.config `pageExtensions` > Next.js defaults.
    pageExtensions: options.pageExtensions ?? readNextPageExtensions(root) ?? DEFAULT_PAGE_EXTENSIONS,
    compilerOptions: readCompilerOptions(root),
    framework,
  };
}

/**
 * `pageExtensions` declared in next.config.* (static array of strings only: the config is not executed).
 * e.g. `pageExtensions: ['page.tsx', 'page.ts']`.
 */
export function readNextPageExtensions(root: string): string[] | undefined {
  for (const name of ['next.config.js', 'next.config.mjs', 'next.config.cjs', 'next.config.ts', 'next.config.mts']) {
    const file = path.join(root, name);
    if (!isFile(file)) continue;
    const block = fs.readFileSync(file, 'utf8').match(/\bpageExtensions\s*:\s*\[([^\]]*)\]/)?.[1];
    if (block === undefined) return undefined;
    const exts = [...block.matchAll(/['"`]\.?([\w.-]+)['"`]/g)].map((m) => m[1]!);
    return exts.length > 0 ? exts : undefined;
  }
  return undefined;
}

function readCompilerOptions(root: string): ts.CompilerOptions {
  const defaults: ts.CompilerOptions = {
    allowJs: true,
    jsx: ts.JsxEmit.Preserve,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    resolveJsonModule: true,
  };

  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    const file = path.join(root, name);
    if (!isFile(file)) continue;
    const { config, error } = ts.readConfigFile(file, ts.sys.readFile);
    if (error) {
      throw new Error(`Cannot read ${file}: ${ts.flattenDiagnosticMessageText(error.messageText, '\n')}`);
    }
    const parsed = ts.parseJsonConfigFileContent(config, ts.sys, root, undefined, file);
    return { ...defaults, ...parsed.options, allowJs: true };
  }
  return defaults;
}
