// Name conversions used by Nuxt (components, layouts, middleware, auto-imports).

/** `BaseButton` -> [Base, Button], `base-button` -> [base, button], `myAPIClient` -> [my, API, Client]. */
export function splitByCase(input: string): string[] {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s\-_./]+/)
    .filter(Boolean);
}

const capitalize = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

export const pascalCase = (input: string): string => splitByCase(input).map(capitalize).join('');
export const kebabCase = (input: string): string => splitByCase(input).map((p) => p.toLowerCase()).join('-');
export const camelCase = (input: string): string => {
  const pascal = pascalCase(input);
  return pascal ? pascal[0]!.toLowerCase() + pascal.slice(1) : pascal;
};

/** `.client`, `.server`, `.global` suffixes of Nuxt file names: `Panel.client.vue` -> { stem: Panel, mode: client }. */
export function stripModeSuffix(stem: string): { stem: string; mode?: 'client' | 'server' | 'global' } {
  const match = stem.match(/^(.*)\.(client|server|global)$/);
  return match ? { stem: match[1]!, mode: match[2] as 'client' | 'server' | 'global' } : { stem };
}

/**
 * Component name from its path under components/ (Nuxt `pathPrefix`), without repeating the folder:
 * `base/Button.vue` -> BaseButton, `base/BaseButton.vue` -> BaseButton, `product/ProductCard.vue` -> ProductCard,
 * `form/input/index.vue` -> FormInput.
 */
export function componentName(relativePath: string, pathPrefix = true): string {
  const parts = relativePath.split('/');
  const file = parts.pop()!;
  const { stem } = stripModeSuffix(file.replace(/\.[^.]+$/, ''));
  const dirs = parts.filter((p) => !/^\(.*\)$/.test(p)); // (group) folders do not prefix
  const fileParts = stem === 'index' ? [] : splitByCase(stem);
  if (!pathPrefix) return pascalCase(stem === 'index' ? (dirs[dirs.length - 1] ?? stem) : stem);

  // Same algorithm as Nuxt's resolveComponentNameSegments: drop the folders already spelled by the file name.
  const prefix = dirs.flatMap(splitByCase);
  const lowerFile = fileParts.map((p) => p.toLowerCase());
  let keep = prefix.length;
  for (let start = prefix.length - 1; start >= 0; start--) {
    const tail = prefix.slice(start).map((p) => p.toLowerCase());
    if (tail.every((p, i) => lowerFile[i] === p)) keep = start;
  }
  return [...prefix.slice(0, keep), ...fileParts].map(capitalize).join('');
}
