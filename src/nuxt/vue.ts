// Parsing of Vue single-file components and Nuxt auto-imports.
import { createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { parseModule, type ParsedImport, type ParsedModule } from '../graph.js';
import type { RawUsage } from '../jsx.js';
import type { PropUsage } from '../types.js';
import { camelCase, pascalCase, stripModeSuffix } from './naming.js';
import type { NuxtContext } from './project.js';

// @vue/compiler-sfc is CommonJS: load it with require.
const require = createRequire(import.meta.url);
const sfc = require('@vue/compiler-sfc') as typeof import('@vue/compiler-sfc');

/** Virtual specifiers linking a file to an auto-imported component / composable. */
export const COMPONENTS_PREFIX = '#components/';
export const IMPORTS_PREFIX = '#imports/';

const MAX_EXPRESSION = 60;
const truncate = (text: string) => {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > MAX_EXPRESSION ? `${oneLine.slice(0, MAX_EXPRESSION - 1)}…` : oneLine;
};

// Template AST node types of @vue/compiler-core.
const ELEMENT = 1;
const INTERPOLATION = 5;
const ATTRIBUTE = 6;
const DIRECTIVE = 7;

interface TemplateNode {
  type: number;
  tag?: string;
  loc?: { start: { line: number } };
  props?: Array<{
    type: number;
    name: string;
    value?: { content: string };
    arg?: { content: string; isStatic?: boolean };
    exp?: { content: string };
  }>;
  children?: TemplateNode[];
  content?: { content?: string } | string;
}

/** `'sm'` -> literal string, `3` -> number, `true` -> boolean, anything else -> expression. */
function literalOf(expression: string): Pick<PropUsage, 'kind' | 'value' | 'type'> {
  const text = expression.trim();
  const quoted = text.match(/^(['"`])((?:(?!\1)[^\\$]|\\.)*)\1$/);
  if (quoted) return { kind: 'literal', value: quoted[2]!, type: 'string' };
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return { kind: 'literal', value: text, type: 'number' };
  if (text === 'true' || text === 'false') return { kind: 'literal', value: text, type: 'boolean' };
  if (text === 'null') return { kind: 'literal', value: text, type: 'null' };
  return { kind: 'expression', value: truncate(text) };
}

/** Template attributes -> props: `variant="primary"`, `:size="s"`, `@click="go"`, `v-bind="attrs"`, `v-model="x"`. */
function propsOf(node: TemplateNode): PropUsage[] {
  const props: PropUsage[] = [];
  for (const p of node.props ?? []) {
    if (p.type === ATTRIBUTE) {
      // Vue normalizes kebab-case props: `is-active` == `isActive`.
      const name = camelCase(p.name) || p.name;
      if (p.value === undefined) props.push({ name, kind: 'literal', value: 'true', type: 'boolean' });
      else props.push({ name, kind: 'literal', value: p.value.content, type: 'string' });
      continue;
    }
    if (p.type !== DIRECTIVE) continue;
    const exp = p.exp?.content ?? '';
    if (p.name === 'bind') {
      if (!p.arg) props.push({ name: '...', kind: 'spread', value: truncate(exp) });
      else if (p.arg.isStatic !== false) props.push({ name: camelCase(p.arg.content) || p.arg.content, ...literalOf(exp) });
    } else if (p.name === 'on' && p.arg?.isStatic !== false && p.arg) {
      props.push({ name: `on${pascalCase(p.arg.content)}`, kind: 'expression', value: truncate(exp) });
    } else if (p.name === 'model') {
      props.push({ name: p.arg ? `v-model:${p.arg.content}` : 'v-model', kind: 'expression', value: truncate(exp) });
    }
  }
  return props;
}

/** Identifiers read by template expressions: `{{ formatPrice(p) }}`, `:a="useX()"`, `v-for="p in products"`. */
function expressionIdentifiers(expression: string, out: Set<string>): void {
  for (const [name] of expression.matchAll(/(?<![.\w$])[A-Za-z_$][\w$]*/g)) out.add(name);
}

/** Local bindings of the scripts: `import BaseCard from '…'` -> BaseCard; Options API `components: { Foo }`. */
function scriptBindings(scripts: Array<{ content: string; lang: string }>): Map<string, { specifier: string; name: string }> {
  const bindings = new Map<string, { specifier: string; name: string }>();
  for (const script of scripts) {
    const sf = ts.createSourceFile(`x.${script.lang}`, script.content, ts.ScriptTarget.Latest, true);
    const aliases: Array<[string, string]> = [];
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.importClause && !node.importClause.isTypeOnly) {
        const specifier = node.moduleSpecifier.text;
        const clause = node.importClause;
        if (clause.name) bindings.set(clause.name.text, { specifier, name: 'default' });
        if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const el of clause.namedBindings.elements) {
            if (!el.isTypeOnly) bindings.set(el.name.text, { specifier, name: (el.propertyName ?? el.name).text });
          }
        }
      }
      // components: { Foo, 'my-bar': Bar }
      if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === 'components' && ts.isObjectLiteralExpression(node.initializer)) {
        for (const prop of node.initializer.properties) {
          if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.initializer)) {
            const key = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ? prop.name.text : undefined;
            if (key) aliases.push([key, prop.initializer.text]);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    for (const [alias, local] of aliases) {
      const target = bindings.get(local);
      if (target) bindings.set(pascalCase(alias), target);
    }
  }
  // Tags may be written in kebab-case: index the PascalCase form too.
  for (const [name, target] of [...bindings]) if (!bindings.has(pascalCase(name))) bindings.set(pascalCase(name), target);
  return bindings;
}

/** `<LazyBaseModal>` -> BaseModal (lazy), `<base-button>` -> BaseButton. */
function resolveAutoComponent(tag: string, ctx: NuxtContext): { name: string; lazy: boolean } | undefined {
  const name = pascalCase(tag);
  if (ctx.components.has(name)) return { name, lazy: false };
  if (name.startsWith('Lazy') && ctx.components.has(name.slice(4))) return { name: name.slice(4), lazy: true };
  return undefined;
}

/** Adds the edges created by auto-imported composables / utils used in a file. */
function addAutoImports(parsed: ParsedModule, identifiers: Iterable<string>, declared: Set<string>, ctx: NuxtContext, selfFile: string): void {
  const seen = new Set(parsed.imports.map((i) => i.specifier));
  for (const name of identifiers) {
    if (declared.has(name)) continue;
    const entry = ctx.imports.get(name);
    if (!entry || entry.file === selfFile) continue;
    const specifier = `${IMPORTS_PREFIX}${name}`;
    if (seen.has(specifier)) continue;
    seen.add(specifier);
    parsed.imports.push({ specifier, kind: 'static', names: [entry.export] });
  }
}

/**
 * Explicit `import { BaseButton } from '#components'` / `import { useCart } from '#imports'`:
 * one edge per name, pointing to the real file.
 */
function expandVirtualImports(parsed: ParsedModule, ctx: NuxtContext): void {
  const out: ParsedImport[] = [];
  for (const imp of parsed.imports) {
    if (imp.specifier === '#components') {
      for (const n of imp.names) {
        const comp = resolveAutoComponent(n, ctx);
        if (comp) out.push({ specifier: `${COMPONENTS_PREFIX}${comp.name}`, kind: comp.lazy ? 'dynamic' : imp.kind, names: ['default'] });
      }
    } else if (imp.specifier === '#imports' || imp.specifier === '#app') {
      for (const n of imp.names) {
        const entry = ctx.imports.get(n);
        if (entry) out.push({ specifier: `${IMPORTS_PREFIX}${n}`, kind: imp.kind, names: [entry.export] });
      }
    } else out.push(imp);
  }
  parsed.imports = out;
  for (const usage of parsed.jsx.usages) {
    if ('specifier' in usage.source && usage.source.specifier === '#components') {
      const comp = resolveAutoComponent(usage.source.name, ctx);
      if (comp) usage.source = { specifier: `${COMPONENTS_PREFIX}${comp.name}`, name: 'default' };
    }
  }
}

/** Script files of a Nuxt project (.ts, .js…): auto-imports added to the regular parse. */
export function parseNuxtScript(file: string, text: string, ctx: NuxtContext): ParsedModule {
  const parsed = parseModule(file, text, { identifiers: ctx.major > 2 });
  expandVirtualImports(parsed, ctx);
  if (ctx.major > 2) addAutoImports(parsed, parsed.freeIdentifiers ?? [], new Set(parsed.declaredNames), ctx, file);
  return parsed;
}

/** A .vue single-file component: imports of its scripts, components rendered by its template. */
export function parseVueFile(file: string, text: string, ctx: NuxtContext): ParsedModule {
  const { descriptor } = sfc.parse(text, { filename: file, ignoreEmpty: true });
  const scripts = [descriptor.script, descriptor.scriptSetup]
    .filter((s): s is NonNullable<typeof s> => Boolean(s))
    .map((s) => ({ content: s.content, lang: s.lang === 'ts' || s.lang === 'tsx' || s.lang === 'jsx' ? s.lang : 'js', setup: s === descriptor.scriptSetup }));

  const parsed: ParsedModule = { client: false, imports: [], exports: ['default'], jsx: { usages: [] } };
  const free = new Set<string>();
  const declared = new Set<string>();
  for (const script of scripts) {
    const part = parseModule(`${file}.${script.lang}`, script.content, { identifiers: true });
    parsed.imports.push(...part.imports);
    // <script setup> has no exports; a regular <script> may export helpers next to the component.
    if (!script.setup) for (const name of part.exports) if (!parsed.exports.includes(name)) parsed.exports.push(name);
    parsed.jsx.usages.push(...part.jsx.usages);
    for (const n of part.freeIdentifiers ?? []) free.add(n);
    for (const n of part.declaredNames ?? []) declared.add(n);
  }

  const { stem, mode } = stripModeSuffix(path.basename(file).replace(/\.vue$/, ''));
  parsed.client = mode === 'client';
  parsed.jsx.defaultName = ctx.componentNames.get(file) ?? pascalCase(stem === 'index' ? path.basename(path.dirname(file)) : stem);

  // Template: components rendered, with their props.
  const bindings = scriptBindings(scripts);
  const templateIds = new Set<string>();
  const usages: RawUsage[] = [];
  const autoEdges = new Map<string, ParsedImport>();
  const visit = (node: TemplateNode): void => {
    if (node.type === ELEMENT && node.tag) {
      const binding = bindings.get(node.tag) ?? bindings.get(pascalCase(node.tag));
      const auto = binding ? undefined : resolveAutoComponent(node.tag, ctx);
      if (binding || auto) {
        const source = binding ?? { specifier: `${COMPONENTS_PREFIX}${auto!.name}`, name: 'default' };
        usages.push({ tag: node.tag, line: node.loc?.start.line ?? 0, props: propsOf(node), source });
        if (auto) {
          const existing = autoEdges.get(auto.name);
          // Rendered both eagerly and lazily: the eager edge wins.
          if (!existing || (existing.kind === 'dynamic' && !auto.lazy)) {
            autoEdges.set(auto.name, { specifier: source.specifier, kind: auto.lazy ? 'dynamic' : 'static', names: ['default'] });
          }
        }
      }
      for (const p of node.props ?? []) {
        if (p.type === DIRECTIVE && p.exp?.content) expressionIdentifiers(p.exp.content, templateIds);
      }
    }
    if (node.type === INTERPOLATION && typeof node.content === 'object' && node.content?.content) expressionIdentifiers(node.content.content, templateIds);
    for (const child of node.children ?? []) visit(child);
  };
  const ast = descriptor.template?.ast as TemplateNode | undefined;
  if (ast) visit(ast);

  parsed.jsx.usages.push(...usages);
  parsed.imports.push(...autoEdges.values());
  expandVirtualImports(parsed, ctx);
  if (ctx.major > 2) addAutoImports(parsed, [...free, ...templateIds], declared, ctx, file);
  return parsed;
}

/** Resolution of the virtual specifiers created above. */
export function resolveNuxtVirtual(specifier: string, ctx: NuxtContext): string | undefined {
  if (specifier.startsWith(COMPONENTS_PREFIX)) return ctx.components.get(specifier.slice(COMPONENTS_PREFIX.length))?.file;
  if (specifier.startsWith(IMPORTS_PREFIX)) return ctx.imports.get(specifier.slice(IMPORTS_PREFIX.length))?.file;
  return undefined;
}

