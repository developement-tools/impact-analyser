import ts from 'typescript';
import type { PropUsage } from './types.js';

/** Where the component of a JSX tag comes from, before module resolution. */
export type UsageSource =
  | { specifier: string; name: string } // imported (name = imported export, `default`…)
  | { local: string }; // declared in the same file

export interface RawUsage {
  tag: string;
  line: number;
  props: PropUsage[];
  source: UsageSource;
}

export interface JsxInfo {
  usages: RawUsage[];
  defaultName?: string;
}

const MAX_EXPRESSION = 60;
const isComponentName = (name: string) => /^[A-Z]/.test(name);

const truncate = (text: string) => {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > MAX_EXPRESSION ? `${oneLine.slice(0, MAX_EXPRESSION - 1)}…` : oneLine;
};

/** `dynamic(() => import('./X'))`, `lazy(() => import('./X'))`, `import('./X').then((m) => m.Named)`. */
function findDynamicImport(node: ts.Node): { specifier: string; name: string } | undefined {
  let found: { specifier: string; name: string } | undefined;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(n)) {
      // import('x').then((m) => m.Named)
      if (
        ts.isPropertyAccessExpression(n.expression) &&
        n.expression.name.text === 'then' &&
        ts.isCallExpression(n.expression.expression) &&
        n.expression.expression.expression.kind === ts.SyntaxKind.ImportKeyword
      ) {
        const [spec] = n.expression.expression.arguments;
        const [callback] = n.arguments;
        if (spec && ts.isStringLiteralLike(spec)) {
          let name = 'default';
          if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
            const body = callback.body;
            if (ts.isPropertyAccessExpression(body)) name = body.name.text;
            else if (ts.isParenthesizedExpression(body) && ts.isPropertyAccessExpression(body.expression)) {
              name = body.expression.name.text;
            }
          }
          found = { specifier: spec.text, name };
          return;
        }
      }
      if (n.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const [spec] = n.arguments;
        if (spec && ts.isStringLiteralLike(spec)) {
          found = { specifier: spec.text, name: 'default' };
          return;
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

function propValue(init: ts.JsxAttributeValue | undefined): Omit<PropUsage, 'name'> {
  if (!init) return { kind: 'literal', value: 'true', type: 'boolean' }; // <Button disabled />
  if (ts.isStringLiteral(init)) return { kind: 'literal', value: init.text, type: 'string' };
  if (ts.isJsxExpression(init)) {
    const expr = init.expression;
    if (!expr) return { kind: 'literal', value: 'true', type: 'boolean' };
    if (ts.isStringLiteralLike(expr)) return { kind: 'literal', value: expr.text, type: 'string' };
    if (ts.isNumericLiteral(expr)) return { kind: 'literal', value: expr.text, type: 'number' };
    if (
      ts.isPrefixUnaryExpression(expr) &&
      expr.operator === ts.SyntaxKind.MinusToken &&
      ts.isNumericLiteral(expr.operand)
    ) {
      return { kind: 'literal', value: `-${expr.operand.text}`, type: 'number' };
    }
    if (expr.kind === ts.SyntaxKind.TrueKeyword) return { kind: 'literal', value: 'true', type: 'boolean' };
    if (expr.kind === ts.SyntaxKind.FalseKeyword) return { kind: 'literal', value: 'false', type: 'boolean' };
    if (expr.kind === ts.SyntaxKind.NullKeyword) return { kind: 'literal', value: 'null', type: 'null' };
    return { kind: 'expression', value: truncate(expr.getText()) };
  }
  return { kind: 'expression', value: truncate(init.getText()) };
}

function collectProps(attributes: ts.JsxAttributes): PropUsage[] {
  const props: PropUsage[] = [];
  for (const attr of attributes.properties) {
    if (ts.isJsxSpreadAttribute(attr)) {
      props.push({ name: '...', kind: 'spread', value: truncate(attr.expression.getText()) });
    } else {
      props.push({ name: attr.name.getText(), ...propValue(attr.initializer) });
    }
  }
  return props;
}

/** Collects the components rendered in JSX, with their props, and the name of the default export. */
export function collectJsx(sf: ts.SourceFile): JsxInfo {
  const bindings = new Map<string, { specifier: string; name: string }>();
  const locals = new Set<string>();
  let defaultName: string | undefined;

  for (const statement of sf.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const clause = statement.importClause;
      if (!clause || clause.isTypeOnly) continue;
      const specifier = statement.moduleSpecifier.text;
      if (clause.name) bindings.set(clause.name.text, { specifier, name: 'default' });
      const nb = clause.namedBindings;
      if (nb && ts.isNamespaceImport(nb)) bindings.set(nb.name.text, { specifier, name: '*' });
      if (nb && ts.isNamedImports(nb)) {
        for (const el of nb.elements) {
          if (!el.isTypeOnly) bindings.set(el.name.text, { specifier, name: (el.propertyName ?? el.name).text });
        }
      }
    } else if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue;
        const dynamicImport = decl.initializer && findDynamicImport(decl.initializer);
        if (dynamicImport) bindings.set(decl.name.text, dynamicImport);
        else locals.add(decl.name.text);
      }
    } else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) {
      locals.add(statement.name.text);
      const mods = ts.getModifiers(statement) ?? [];
      if (mods.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) defaultName = statement.name.text;
    } else if (ts.isExportAssignment(statement) && !statement.isExportEquals && ts.isIdentifier(statement.expression)) {
      defaultName = statement.expression.text;
    }
  }

  const usages: RawUsage[] = [];
  const record = (tagName: ts.JsxTagNameExpression, attributes: ts.JsxAttributes, node: ts.Node) => {
    let source: UsageSource | undefined;
    if (ts.isIdentifier(tagName)) {
      const name = tagName.text;
      if (!isComponentName(name)) return; // <div>, <button>…
      source = bindings.get(name) ?? (locals.has(name) ? { local: name } : undefined);
    } else if (ts.isPropertyAccessExpression(tagName) && ts.isIdentifier(tagName.expression)) {
      // <Icons.Cart /> (namespace import) or <Tabs.Panel /> (compound component)
      const base = bindings.get(tagName.expression.text);
      if (base) source = base.name === '*' ? { specifier: base.specifier, name: tagName.name.text } : base;
      else if (locals.has(tagName.expression.text)) source = { local: tagName.expression.text };
    }
    if (!source) return; // e.g. <Component {...pageProps} /> received as a prop
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    usages.push({ tag: tagName.getText(sf), line, props: collectProps(attributes), source });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      record(node.tagName, node.attributes, node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  return { usages, defaultName };
}
