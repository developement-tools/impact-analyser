import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { FRAMEWORKS, type FrameworkName } from './framework.js';

export const LANGUAGES = ['en', 'fr'] as const;
export type Lang = (typeof LANGUAGES)[number];

export const EDITORS = ['vscode', 'cursor', 'webstorm', 'idea', 'zed', 'none'] as const;
export type Editor = (typeof EDITORS)[number];

export interface ImpactAnalyserConfig {
  /** Language of the CLI and the UI. Default: from the system locale, else `en`. */
  lang?: Lang;
  /** Editor opened by the "Open in editor" links of the UI. Default: `vscode`. */
  editor?: Editor;
  /** URL of the running app, for the "Open page" links of the UI. Default: `http://localhost:3000`. */
  appUrl?: string;
  /** Same as `pageExtensions` in next.config. */
  pageExtensions?: string[];
  /** Port of `impact-analyser ui`. Default: 4321. */
  port?: number;
  /**
   * Files to analyse, as .gitignore-like globs relative to the project root. Default: `["*"]` (everything).
   * A pattern without a slash matches a name at any depth (`*.generated.ts`), with a slash it is anchored (`src/legacy/**`).
   */
  include?: string[];
  /** Files to ignore, even when included. Same syntax as `include`. Default: `[]`. */
  exclude?: string[];
  /** `next` or `nuxt`. Default: detected from package.json. */
  framework?: FrameworkName;
  /**
   * `impact-analyser ui` only: extra host names allowed to reach the UI server (forwarded domain of a Codespace / VM).
   * Default: localhost, 127.0.0.1 and [::1] only (DNS rebinding protection).
   */
  allowedHosts?: string[];
  /** `impact-analyser generate`: where the AI-oriented map is written. Default: `docs/impact-map.md` (relative to the project root). */
  output?: { dir?: string; file?: string };
}

/** Typing helper for `impact-analyser.config.mjs`: `export default defineConfig({ lang: 'fr' })`. */
export const defineConfig = (config: ImpactAnalyserConfig): ImpactAnalyserConfig => config;

export const CONFIG_FILES = ['impact-analyser.config.json', 'impact-analyser.config.mjs', 'impact-analyser.config.js'];

export interface LoadedConfig {
  config: ImpactAnalyserConfig;
  /** File the config was read from (absolute), if any. */
  file?: string;
}

function validate(config: unknown, file: string): ImpactAnalyserConfig {
  if (!config || typeof config !== 'object') throw new Error(`${file}: the config must be an object`);
  const c = config as ImpactAnalyserConfig;
  if (c.lang !== undefined && !LANGUAGES.includes(c.lang)) {
    throw new Error(`${file}: "lang" must be one of ${LANGUAGES.join(', ')} (got "${String(c.lang)}")`);
  }
  if (c.editor !== undefined && !EDITORS.includes(c.editor)) {
    throw new Error(`${file}: "editor" must be one of ${EDITORS.join(', ')} (got "${String(c.editor)}")`);
  }
  if (c.framework !== undefined && !FRAMEWORKS.includes(c.framework)) {
    throw new Error(`${file}: "framework" must be one of ${FRAMEWORKS.join(', ')} (got "${String(c.framework)}")`);
  }
  if (c.output !== undefined) {
    const ok =
      typeof c.output === 'object' &&
      c.output !== null &&
      !Array.isArray(c.output) &&
      Object.entries(c.output).every(([k, v]) => (k === 'dir' || k === 'file') && typeof v === 'string' && v.trim() !== '');
    if (!ok) throw new Error(`${file}: "output" must be { "dir"?: string, "file"?: string } (e.g. { "dir": "docs", "file": "impact-map.md" })`);
  }
  for (const key of ['include', 'exclude', 'pageExtensions', 'allowedHosts'] as const) {
    const value = c[key];
    if (value !== undefined && (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || !v.trim()))) {
      throw new Error(`${file}: "${key}" must be an array of non-empty strings`);
    }
  }
  return c;
}

/** Reads `impact-analyser.config.{json,mjs,js}` or the `impactAnalyser` key of package.json. */
export async function loadConfig(root: string): Promise<LoadedConfig> {
  for (const name of CONFIG_FILES) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    if (name.endsWith('.json')) {
      try {
        return { config: validate(JSON.parse(fs.readFileSync(file, 'utf8')), name), file };
      } catch (error) {
        if (error instanceof SyntaxError) throw new Error(`${name}: invalid JSON (${error.message})`);
        throw error;
      }
    }
    const mod = (await import(pathToFileURL(file).href)) as { default?: unknown };
    return { config: validate(mod.default ?? mod, name), file };
  }

  const pkgFile = path.join(root, 'package.json');
  if (fs.existsSync(pkgFile)) {
    const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8')) as { impactAnalyser?: unknown };
    if (pkg.impactAnalyser) return { config: validate(pkg.impactAnalyser, 'package.json#impactAnalyser'), file: pkgFile };
  }
  return { config: {} };
}

/** `--lang` flag > config > system locale (LANG, LC_ALL…) > en. */
export function resolveLang(flag: string | undefined, config: ImpactAnalyserConfig, env = process.env): Lang {
  if (flag !== undefined) {
    if (!LANGUAGES.includes(flag as Lang)) throw new Error(`--lang must be one of ${LANGUAGES.join(', ')}`);
    return flag as Lang;
  }
  if (config.lang) return config.lang;
  const locale = env.LC_ALL || env.LC_MESSAGES || env.LANG || Intl.DateTimeFormat().resolvedOptions().locale;
  return /^fr\b|^fr[_-]/i.test(locale ?? '') ? 'fr' : 'en';
}
