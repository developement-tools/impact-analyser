import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { collectJsx, type JsxInfo } from './jsx.js';
import { fromId, toId } from './paths.js';
import { parseNuxtScript, parseVueFile, resolveNuxtVirtual } from './nuxt/vue.js';
import { isFile, type ProjectLayout } from './project.js';
import type { EdgeKind, ImportEdge, JsxUsage, ModuleKind, ModuleNode, UnresolvedImport } from './types.js';

const SOURCE_EXT = /\.(?:[cm]?[jt]sx?|vue)$/;
const STYLE_EXT = /\.(?:css|scss|sass|less|styl)$/;

export function moduleKindOf(file: string): ModuleKind {
  if (SOURCE_EXT.test(file)) return 'source';
  if (STYLE_EXT.test(file)) return 'style';
  return 'asset';
}

function scriptKindOf(file: string): ts.ScriptKind {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (/\.[cm]?ts$/.test(file)) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

export interface ParsedImport {
  specifier: string;
  kind: EdgeKind;
  /** See {@link ImportEdge.names}. */
  names: string[];
  aliases?: (string | null)[];
}

export interface ParsedModule {
  client: boolean;
  imports: ParsedImport[];
  exports: string[];
  jsx: JsxInfo;
  /** Identifiers used but neither declared nor imported (Nuxt auto-imports), with `identifiers: true`. */
  freeIdentifiers?: string[];
  /** Names declared or imported in the file, with `identifiers: true`. */
  declaredNames?: string[];
}

export interface ParseOptions {
  /** Also collect free identifiers (needed for auto-imports). */
  identifiers?: boolean;
}

/** Name declared by a declaration node (`const x`, `function f`, `import x`, parameter…). */
function isDeclarationName(node: ts.Identifier): boolean {
  const p = node.parent;
  if (ts.isImportClause(p) || ts.isImportSpecifier(p) || ts.isNamespaceImport(p) || ts.isImportEqualsDeclaration(p)) return p.name === node;
  if (ts.isBindingElement(p)) return p.name === node;
  if (ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) || ts.isClassDeclaration(p) || ts.isClassExpression(p) || ts.isEnumDeclaration(p)) {
    return p.name === node;
  }
  return false;
}

/** Identifiers referenced in value positions but not declared in the file, and the declared ones. */
export function collectIdentifiers(sf: ts.SourceFile): { free: string[]; declared: string[] } {
  const declared = new Set<string>();
  const used = new Set<string>();
  const visit = (node: ts.Node): void => {
    // Types never create runtime dependencies.
    if (ts.isTypeNode(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) return;
    if (ts.isIdentifier(node)) {
      const p = node.parent;
      if (isDeclarationName(node)) declared.add(node.text);
      else if (ts.isPropertyAccessExpression(p) && p.name === node) {
        /* obj.name */
      } else if ((ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p) || ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p) || ts.isEnumMember(p)) && p.name === node) {
        /* { name: … } */
      } else if (ts.isBindingElement(p) && p.propertyName === node) {
        /* const { name: alias } */
      } else if (ts.isExportSpecifier(p) || ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p) || ts.isJsxAttribute(p)) {
        /* not a reference */
      } else used.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { free: [...used].filter((n) => !declared.has(n)), declared: [...declared] };
}

const ALL = '*';
const moduleName = (n: ts.ModuleExportName): string => n.text;

/** Runtime names imported by an import declaration (type-only bindings are dropped). */
function importedNames(node: ts.ImportDeclaration): string[] {
  const clause = node.importClause;
  if (!clause) return [ALL]; // side-effect import executes the whole module
  if (clause.isTypeOnly) return [];
  const names: string[] = [];
  if (clause.name) names.push('default');
  const bindings = clause.namedBindings;
  if (bindings && ts.isNamespaceImport(bindings)) names.push(ALL);
  if (bindings && ts.isNamedImports(bindings)) {
    for (const el of bindings.elements) {
      if (!el.isTypeOnly) names.push(moduleName(el.propertyName ?? el.name));
    }
  }
  return names;
}

function bindingNames(name: ts.BindingName, out: string[]): void {
  if (ts.isIdentifier(name)) out.push(name.text);
  else for (const el of name.elements) if (!ts.isOmittedExpression(el)) bindingNames(el.name, out);
}

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind): boolean =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((m) => m.kind === kind) ?? false);

/** Names exported by top-level declarations (`export function`, `export const`, `export default`…). */
function declaredExports(statement: ts.Statement): string[] {
  if (ts.isExportAssignment(statement)) return ['default'];
  if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) return [];
  if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) return ['default'];
  if (ts.isVariableStatement(statement)) {
    const names: string[] = [];
    for (const decl of statement.declarationList.declarations) bindingNames(decl.name, names);
    return names;
  }
  if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) {
    return [statement.name.text];
  }
  return []; // interfaces, type aliases, namespaces: types only
}

/** Extracts the `"use client"` directive, imports and exports of a JS/TS module. */
export function parseModule(file: string, text: string, options: ParseOptions = {}): ParsedModule {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKindOf(file));

  let client = false;
  for (const statement of sf.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
    if (statement.expression.text === 'use client') client = true;
  }

  const exports = new Set<string>();
  for (const statement of sf.statements) for (const name of declaredExports(statement)) exports.add(name);

  const imports: ParsedImport[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const names = importedNames(node);
      const typeOnly = names.length === 0;
      imports.push({ specifier: node.moduleSpecifier.text, kind: typeOnly ? 'type' : 'static', names: typeOnly ? [ALL] : names });
    } else if (ts.isExportDeclaration(node)) {
      const clause = node.exportClause;
      const specifier = node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : undefined;
      if (node.isTypeOnly) {
        if (specifier) imports.push({ specifier, kind: 'type', names: [ALL] });
      } else if (!clause) {
        // export * from '…'
        if (specifier) imports.push({ specifier, kind: 'reexport', names: [ALL] });
      } else if (ts.isNamespaceExport(clause)) {
        // export * as ns from '…'
        exports.add(moduleName(clause.name));
        if (specifier) imports.push({ specifier, kind: 'reexport', names: [ALL], aliases: [moduleName(clause.name)] });
      } else {
        const elements = clause.elements.filter((el) => !el.isTypeOnly);
        for (const el of elements) exports.add(moduleName(el.name));
        if (specifier && elements.length > 0) {
          const names = elements.map((el) => moduleName(el.propertyName ?? el.name));
          const aliases = elements.map((el) => (el.propertyName ? moduleName(el.name) : null));
          imports.push({ specifier, kind: 'reexport', names, ...(aliases.some(Boolean) && { aliases }) });
        }
      }
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      imports.push({ specifier: node.moduleReference.expression.text, kind: node.isTypeOnly ? 'type' : 'static', names: [ALL] });
    } else if (ts.isCallExpression(node)) {
      const [arg] = node.arguments;
      if (arg && ts.isStringLiteralLike(arg)) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          imports.push({ specifier: arg.text, kind: 'dynamic', names: [ALL] });
        } else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
          imports.push({ specifier: arg.text, kind: 'static', names: [ALL] });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  narrowNamespaceImports(sf, imports);
  const parsed: ParsedModule = { client, imports, exports: [...exports], jsx: collectJsx(sf) };
  if (options.identifiers) {
    const { free, declared } = collectIdentifiers(sf);
    parsed.freeIdentifiers = free;
    parsed.declaredNames = declared;
  }
  return parsed;
}

/**
 * `import * as Icons from './icons'` uses the whole module, unless `Icons` only appears
 * as `Icons.Cart` / `<Icons.User />`: then only those names are used.
 */
function narrowNamespaceImports(sf: ts.SourceFile, imports: ParsedImport[]): void {
  const namespaces = new Map<string, ParsedImport>();
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamespaceImport(bindings) || statement.importClause?.isTypeOnly) continue;
    const specifier = statement.moduleSpecifier.text;
    const parsed = imports.find((i) => i.specifier === specifier && i.kind === 'static');
    if (parsed) namespaces.set(bindings.name.text, parsed);
  }
  if (namespaces.size === 0) return;

  const members = new Map<string, Set<string> | null>(); // null = used as a whole
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && namespaces.has(node.text) && !ts.isNamespaceImport(node.parent)) {
      const parent = node.parent;
      const current = members.get(node.text);
      if (current !== null) {
        if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
          (current ?? members.set(node.text, new Set()).get(node.text)!).add(parent.name.text);
        } else if (!(ts.isPropertyAccessExpression(parent) && parent.name === node)) {
          members.set(node.text, null);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  for (const [local, parsed] of namespaces) {
    const used = members.get(local);
    if (!used) continue; // whole namespace used, or never used
    parsed.names = [...parsed.names.filter((n) => n !== ALL), ...used];
  }
}

/** `@scope/pkg/sub` -> `@scope/pkg`, `next/link` -> `next`. */
export function packageNameOf(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? specifier);
}

type Resolution = { file: string } | { external: string } | { unresolved: true };

class Resolver {
  private readonly options: ts.CompilerOptions;
  private readonly cache: ts.ModuleResolutionCache;
  private readonly aliases: Array<{ prefix: string; exact: boolean; targets: string[] }>;

  constructor(private readonly project: ProjectLayout) {
    this.options = project.compilerOptions;
    this.cache = ts.createModuleResolutionCache(project.root, (f) => f, this.options);
    // `pathsBasePath` is set by parseJsonConfigFileContent (directory of the tsconfig declaring `paths`).
    const base =
      (this.options as { pathsBasePath?: string }).pathsBasePath ?? this.options.baseUrl ?? project.root;
    this.aliases = Object.entries(this.options.paths ?? {}).map(([pattern, targets]) => ({
      prefix: pattern.endsWith('*') ? pattern.slice(0, -1) : pattern,
      exact: !pattern.endsWith('*'),
      targets: targets.map((t) => path.resolve(base, t)),
    }));
  }

  private matchAlias(specifier: string): string[] | undefined {
    for (const alias of this.aliases) {
      if (alias.exact ? specifier === alias.prefix : specifier.startsWith(alias.prefix)) {
        const rest = specifier.slice(alias.prefix.length);
        return alias.targets.map((t) => t.replace('*', rest));
      }
    }
    return undefined;
  }

  /** Resolution of non-JS files (css, images…) that TypeScript does not resolve. */
  private resolveFileOnDisk(specifier: string, fromFile: string): string | undefined {
    const clean = specifier.replace(/[?#].*$/, '');
    const candidates = clean.startsWith('.')
      ? [path.resolve(path.dirname(fromFile), clean)]
      : (this.matchAlias(clean) ?? []);
    return candidates.find(isFile);
  }

  resolve(specifier: string, fromFile: string): Resolution {
    // Nuxt auto-imports (#components/X, #imports/x) point to project files.
    const nuxt = this.project.nuxt;
    if (nuxt) {
      const virtual = resolveNuxtVirtual(specifier, nuxt);
      if (virtual) return { file: virtual };
    }
    const resolved = ts.resolveModuleName(specifier, fromFile, this.options, ts.sys, this.cache).resolvedModule;
    if (resolved) {
      const file = path.resolve(resolved.resolvedFileName);
      if (resolved.isExternalLibraryImport || file.includes(`${path.sep}node_modules${path.sep}`)) {
        return { external: packageNameOf(specifier) };
      }
      // A `.d.ts` is types only (e.g. typed CSS modules): look for the real file instead.
      if (!file.endsWith('.d.ts')) return { file };
    }

    const onDisk = this.resolveFileOnDisk(specifier, fromFile);
    if (onDisk) return { file: onDisk };

    // Nuxt virtual modules (#app, #imports, #build…) are part of the framework.
    if (nuxt && specifier.startsWith('#') && !this.matchAlias(specifier)) return { external: 'nuxt' };
    const isLocal = specifier.startsWith('.') || specifier.startsWith('/') || this.matchAlias(specifier);
    return isLocal ? { unresolved: true } : { external: packageNameOf(specifier) };
  }
}

export interface ModuleGraph {
  modules: Record<string, ModuleNode>;
  unresolved: UnresolvedImport[];
  /** Project files imported by analysed code but left out by include / exclude. */
  excluded: string[];
}

/** Walks every module reachable from the entry files (project-relative ids). */
export function buildModuleGraph(project: ProjectLayout, entryIds: string[], inScope: (id: string) => boolean = () => true): ModuleGraph {
  const { root } = project;
  const resolver = new Resolver(project);
  const modules: Record<string, ModuleNode> = {};
  const unresolved: UnresolvedImport[] = [];
  const excluded = new Set<string>();
  const queue = entryIds.map((id) => fromId(root, id));

  while (queue.length > 0) {
    const abs = queue.pop()!;
    const id = toId(root, abs);
    if (modules[id]) continue;

    const node: ModuleNode = {
      id,
      kind: moduleKindOf(abs),
      category: 'util', // refined by the analysis once the whole graph is known
      client: false,
      imports: [],
      exports: [],
      externals: [],
      usages: [],
    };
    modules[id] = node;
    if (node.kind !== 'source') continue;

    let text: string;
    try {
      text = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }

    const parsed = project.nuxt
      ? abs.endsWith('.vue')
        ? parseVueFile(abs, text, project.nuxt)
        : parseNuxtScript(abs, text, project.nuxt)
      : parseModule(abs, text);
    node.client = parsed.client;
    node.exports = parsed.exports;
    if (parsed.jsx.defaultName) node.defaultName = parsed.jsx.defaultName;
    const externals = new Set<string>();
    const edges = new Map<string, ImportEdge>();
    const resolvedSpecifiers = new Map<string, string>();

    for (const imp of parsed.imports) {
      const res = resolver.resolve(imp.specifier, abs);
      if ('external' in res) {
        externals.add(res.external);
        continue;
      }
      if ('unresolved' in res) {
        unresolved.push({ from: id, specifier: imp.specifier });
        continue;
      }
      const to = toId(root, res.file);
      if (to.startsWith('..')) continue; // outside of the project
      if (!inScope(to)) {
        // Out of the analysis scope (include / exclude): not followed, not linked.
        excluded.add(to);
        continue;
      }
      resolvedSpecifiers.set(imp.specifier, to);
      // Merge `import { A } from './x'` + `import { B } from './x'` into one edge.
      const key = `${to}|${imp.kind}`;
      const existing = edges.get(key);
      if (existing && imp.kind !== 'reexport') {
        for (const name of imp.names) if (!existing.names.includes(name)) existing.names.push(name);
        continue;
      }
      const edge: ImportEdge = { to, kind: imp.kind, specifier: imp.specifier, names: [...imp.names] };
      if (imp.aliases) edge.aliases = imp.aliases;
      if (!existing) edges.set(key, edge);
      node.imports.push(edge);
      if (!modules[to]) queue.push(res.file);
    }
    node.externals = [...externals].sort();
    node.usages = resolveUsages(node, parsed, resolvedSpecifiers);
  }

  return { modules, unresolved, excluded: [...excluded].sort() };
}

/** Links each JSX tag to `module#export` (barrels are resolved later, see `resolveExport`). */
function resolveUsages(node: ModuleNode, parsed: ParsedModule, resolvedSpecifiers: Map<string, string>): JsxUsage[] {
  const usages: JsxUsage[] = [];
  for (const usage of parsed.jsx.usages) {
    let component: string | undefined;
    if ('specifier' in usage.source) {
      const to = resolvedSpecifiers.get(usage.source.specifier);
      if (to) component = `${to}#${usage.source.name}`;
    } else {
      // Component declared in the same file: only exported ones are tracked.
      const local = usage.source.local;
      const exported = parsed.exports.includes(local) ? local : node.defaultName === local ? 'default' : undefined;
      if (exported) component = `${node.id}#${exported}`;
    }
    if (component) usages.push({ component, tag: usage.tag, line: usage.line, props: usage.props });
  }
  return usages;
}

export function reverseIndex(modules: Record<string, ModuleNode>): Record<string, string[]> {
  const importedBy: Record<string, Set<string>> = {};
  for (const mod of Object.values(modules)) {
    for (const edge of mod.imports) (importedBy[edge.to] ??= new Set()).add(mod.id);
  }
  return Object.fromEntries(
    Object.keys(importedBy)
      .sort()
      .map((id) => [id, [...importedBy[id]!].sort()]),
  );
}
