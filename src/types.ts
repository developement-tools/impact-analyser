import type { FrameworkInfo } from './framework.js';

/** `app` / `pages`: Next.js App Router / Pages Router. `nuxt`: Nuxt pages/ (and server/ routes). */
export type RouterKind = 'app' | 'pages' | 'nuxt';

/**
 * Role of a file wrapping routes:
 * - Next.js: `layout`, `template`, `error`, `loading`, `not-found`…, `_app`, `_document`
 * - Nuxt: `app` (app.vue), `layout` (layouts/), `parent` (parent page of nested routes), `error` (error page),
 *   `middleware` (route middleware), `plugin` (plugins/)
 */
export interface WrapperRole {
  role: string;
  /** Layout / middleware / plugin name, or URL of a parent page. */
  name?: string;
  /** Middleware run on every route. */
  global?: boolean;
}

/**
 * - `page`: a page rendered for a URL (`page.tsx` in App Router, any page file in Pages Router)
 * - `default`: fallback of a parallel-route slot (`default.tsx`)
 * - `api`: route handler (`route.ts`) or Pages Router API route (`pages/api/*`)
 */
export type RouteKind = 'page' | 'default' | 'api';

export interface RouteEntry {
  router: RouterKind;
  kind: RouteKind;
  /** URL pattern, e.g. `/blog/[slug]`. Route groups and slots are removed. */
  path: string;
  /** Project-relative POSIX path of the page / handler file. */
  file: string;
  /**
   * Files that wrap this route, outermost first: layouts, templates, error/loading/not-found
   * boundaries (App Router), `_document` and `_app` (Pages Router).
   */
  wrappers: string[];
  /** Name of the parallel-route slot (`@analytics` -> `analytics`), if any. */
  slot?: string;
}

/**
 * - `static`: `import x from '…'`, `require('…')`
 * - `dynamic`: `import('…')` (including `next/dynamic(() => import('…'))`)
 * - `reexport`: `export … from '…'` (barrel files)
 * - `type`: `import type` / `export type` — no runtime impact
 */
export type EdgeKind = 'static' | 'dynamic' | 'reexport' | 'type';

export interface ImportEdge {
  /** Project-relative POSIX path of the imported module. */
  to: string;
  kind: EdgeKind;
  /** Specifier as written in the source (`@/components/ui`, `./Card`…). */
  specifier: string;
  /**
   * Names taken from `to`: `default`, `Button`… `*` means the whole module
   * (namespace import, side-effect import, `import()`, `export * from`).
   */
  names: string[];
  /** Reexport edges only: name under which each entry of `names` is exported (when renamed). */
  aliases?: (string | null)[];
}

export type ModuleKind = 'source' | 'style' | 'asset';

/**
 * What a file is, for humans:
 * - `route`: a Next.js file (page, layout, error, `_app`…)
 * - `component`: exports React components
 * - `hook`: exports `useXxx` functions only
 * - `barrel`: only re-exports other modules (`index.ts`)
 * - `util`: anything else (helpers, data, constants…)
 */
export type ModuleCategory = 'route' | 'component' | 'hook' | 'barrel' | 'util' | 'style' | 'asset';

/** A prop passed to a component in JSX: `variant="primary"`, `size={2}`, `onClick={fn}`, `{...rest}`. */
export interface PropUsage {
  /** Prop name, `...` for a spread. */
  name: string;
  /** `literal`: a static value; `expression`: computed at runtime; `spread`: `{...props}`. */
  kind: 'literal' | 'expression' | 'spread';
  /** Literal value (`primary`, `2`, `true`) or source text of the expression (truncated). */
  value: string;
  /** Type of a literal value. */
  type?: 'string' | 'number' | 'boolean' | 'null';
}

export interface JsxUsage {
  /** Component key `module#export` (resolved through barrels). */
  component: string;
  /** Tag as written in the source: `Button`, `Icons.Cart`. */
  tag: string;
  line: number;
  props: PropUsage[];
}

export interface ModuleNode {
  id: string;
  kind: ModuleKind;
  category: ModuleCategory;
  /** File starts with the `"use client"` directive. */
  client: boolean;
  imports: ImportEdge[];
  /** Runtime names exported by the module (excluding `export *`). */
  exports: string[];
  /** Name of the default export when it is named (`export default function Modal`). */
  defaultName?: string;
  /** npm packages imported by this module (`next/link` -> `next`). */
  externals: string[];
  /** Project components rendered by this module (`<Button variant="primary" />`). */
  usages: JsxUsage[];
}

export interface ComponentUsage {
  /** Module rendering the component. */
  module: string;
  line: number;
  tag: string;
  props: PropUsage[];
}

export interface ComponentInfo {
  /** `module#export`, e.g. `src/components/ui/Button.tsx#Button`. */
  id: string;
  /** Display name: `Button`, or the default export's name. */
  name: string;
  module: string;
  export: string;
  client: boolean;
  /** Every JSX usage of the component in the project. */
  usages: ComponentUsage[];
}

export interface UnresolvedImport {
  from: string;
  specifier: string;
}

export interface ProjectGraph {
  version: 1;
  /** Framework of the project (Next.js or Nuxt) and its version. */
  framework: FrameworkInfo;
  /** Absolute path of the analysed project. */
  root: string;
  /** Directory holding the application code (`src`, Nuxt 4 `app`…), relative to root; `''` for the root itself. */
  srcDir: string;
  appDir?: string;
  pagesDir?: string;
  routes: RouteEntry[];
  modules: Record<string, ModuleNode>;
  /** React components of the project (exported PascalCase functions of .tsx/.jsx files, and anything rendered in JSX). */
  components: Record<string, ComponentInfo>;
  /** Reverse index: module id -> ids of the modules importing it. */
  importedBy: Record<string, string[]>;
  /** Local imports that could not be resolved. */
  unresolved: UnresolvedImport[];
  /** Source / style files of the project not reachable from any route (dead code candidates). */
  unreachable: string[];
  /** Analysis scope as configured (`include` defaults to `["*"]`). */
  scope: { include: string[]; exclude: string[] };
  /** Files imported by analysed code but left out of the scope (not analysed, impact not propagated through them). */
  excluded: string[];
  /** Role of every file wrapping routes (layouts, app.vue, middleware…). */
  roles: Record<string, WrapperRole>;
  /** Nuxt only. `generated`: names read from .nuxt (nuxi prepare / dev); otherwise inferred from Nuxt conventions. */
  nuxt?: { generated: boolean };
}
