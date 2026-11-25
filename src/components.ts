import path from 'node:path';
import type { ComponentInfo, ModuleCategory, ModuleNode, RouteEntry } from './types.js';

const ALL = '*';
const JSX_FILE = /\.[cm]?[jt]sx$|\.m?js$|\.vue$/;
const isPascalCase = (name: string) => /^[A-Z][A-Za-z0-9]*$/.test(name);
const isHookName = (name: string) => /^use[A-Z0-9]/.test(name);

/**
 * Follows re-exports to the module that really defines `name`:
 * `ui/index.ts#Button` -> `ui/Button.tsx#Button`.
 */
export function resolveExport(
  modules: Record<string, ModuleNode>,
  moduleId: string,
  name: string,
  seen = new Set<string>(),
): { module: string; name: string } {
  const key = `${moduleId}#${name}`;
  const mod = modules[moduleId];
  if (!mod || seen.has(key)) return { module: moduleId, name };
  seen.add(key);

  const stars: string[] = [];
  for (const edge of mod.imports) {
    if (edge.kind !== 'reexport') continue;
    for (let i = 0; i < edge.names.length; i++) {
      const original = edge.names[i]!;
      const alias = edge.aliases?.[i] ?? null;
      if (original === ALL && !alias) stars.push(edge.to);
      else if ((alias ?? original) === name && original !== ALL) return resolveExport(modules, edge.to, original, seen);
    }
  }
  // Not a named re-export: declared here, or coming from an `export *`.
  if (mod.exports.includes(name) || stars.length === 0) return { module: moduleId, name };
  for (const star of stars) {
    const resolved = resolveExport(modules, star, name, seen);
    if (modules[resolved.module]?.exports.includes(resolved.name)) return resolved;
  }
  return { module: moduleId, name };
}

/** Names re-exported by a module (as opposed to declared in it). */
function reexportedNames(mod: ModuleNode): Set<string> {
  const names = new Set<string>();
  for (const edge of mod.imports) {
    if (edge.kind !== 'reexport') continue;
    edge.names.forEach((n, i) => {
      const exported = edge.aliases?.[i] ?? n;
      if (exported !== ALL) names.add(exported);
    });
  }
  return names;
}

/** `Button`, or for a default export: its declared name, else the file / folder name in PascalCase. */
export function exportDisplayName(mod: ModuleNode, exportName: string): string {
  if (exportName !== 'default') return exportName;
  if (mod.defaultName) return mod.defaultName;
  const base = path.posix.basename(mod.id).replace(/\.[^.]+$/, '');
  const stem = base === 'index' ? path.posix.basename(path.posix.dirname(mod.id)) : base;
  return stem.replace(/(^|[-_.\s]+)(\w)/g, (_, __, c: string) => c.toUpperCase());
}

function componentExports(mod: ModuleNode): string[] {
  if (!JSX_FILE.test(mod.id)) return [];
  const reexported = reexportedNames(mod);
  return mod.exports.filter((name) => !reexported.has(name) && isPascalCase(exportDisplayName(mod, name)));
}

function categorize(mod: ModuleNode, routeFiles: Set<string>): ModuleCategory {
  if (mod.kind === 'style') return 'style';
  if (mod.kind === 'asset') return 'asset';
  if (routeFiles.has(mod.id)) return 'route';
  const reexported = reexportedNames(mod);
  const own = mod.exports.filter((n) => !reexported.has(n));
  const hasStar = mod.imports.some((e) => e.kind === 'reexport' && e.names.includes(ALL) && !e.aliases);
  if (own.length === 0 && (reexported.size > 0 || hasStar)) return 'barrel';
  if (componentExports(mod).length > 0) return 'component';
  if (own.length > 0 && own.every(isHookName)) return 'hook';
  return 'util';
}

/**
 * Sets `category` on every module, resolves JSX usages through barrels
 * and builds the component index.
 */
export function buildComponents(modules: Record<string, ModuleNode>, routes: RouteEntry[]): Record<string, ComponentInfo> {
  const routeFiles = new Set(routes.flatMap((r) => [r.file, ...r.wrappers]));
  for (const mod of Object.values(modules)) mod.category = categorize(mod, routeFiles);

  const components: Record<string, ComponentInfo> = {};
  const ensure = (moduleId: string, exportName: string): ComponentInfo | undefined => {
    const id = `${moduleId}#${exportName}`;
    const mod = modules[moduleId];
    if (!mod || mod.category === 'route') return undefined;
    components[id] ??= {
      id,
      name: exportDisplayName(mod, exportName),
      module: moduleId,
      export: exportName,
      client: mod.client,
      usages: [],
    };
    return components[id];
  };

  for (const mod of Object.values(modules)) {
    for (const name of componentExports(mod)) if (mod.category === 'component') ensure(mod.id, name);
  }

  for (const mod of Object.values(modules)) {
    for (const usage of mod.usages) {
      const hash = usage.component.lastIndexOf('#');
      const resolved = resolveExport(modules, usage.component.slice(0, hash), usage.component.slice(hash + 1));
      usage.component = `${resolved.module}#${resolved.name}`;
      ensure(resolved.module, resolved.name)?.usages.push({
        module: mod.id,
        line: usage.line,
        tag: usage.tag,
        props: usage.props,
      });
    }
  }

  return Object.fromEntries(Object.keys(components).sort().map((id) => [id, components[id]!]));
}

