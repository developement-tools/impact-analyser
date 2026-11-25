// Analysis scope: `include` / `exclude` glob patterns, with .gitignore-like semantics.
//
// - Paths are relative to the project root, with forward slashes: `src/components/Button.tsx`.
// - A pattern without a slash matches a file or folder name at any depth:
//   `*` matches everything, `__mocks__` every mocks folder, `*.generated.ts` every generated file.
// - A pattern with a slash is anchored at the project root: `src/legacy/**`, `src/app/(admin)`.
// - A pattern matching a folder matches everything inside it: `src/legacy` = `src/legacy/**`.
// - Wildcards: `*` (any characters except /), `**` (any number of folders), `?` (one character), `{a,b}` (either).

export interface ScopeOptions {
  /** Files to analyse. Default: `["*"]` (the whole project). */
  include?: string[];
  /** Files to ignore, even if included. Default: `[]`. */
  exclude?: string[];
}

export const DEFAULT_INCLUDE = ['*'];

/** Returns true when a project-relative path is part of the analysis. */
export type Scope = (id: string) => boolean;

function escape(char: string): string {
  return /[.+^${}()|[\]\\]/.test(char) ? `\\${char}` : char;
}

/** Glob -> regular expression source (no anchors). */
function globSource(glob: string): string {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**/` = zero or more folders, `**` at the end = anything.
        if (glob[i + 2] === '/') {
          out += '(?:[^/]*/)*';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
    } else if (c === '?') {
      out += '[^/]';
    } else if (c === '{') {
      const end = glob.indexOf('}', i);
      if (end === -1) {
        out += '\\{';
        continue;
      }
      out += `(?:${glob
        .slice(i + 1, end)
        .split(',')
        .map(globSource)
        .join('|')})`;
      i = end;
    } else {
      out += escape(c);
    }
  }
  return out;
}

export interface CompiledPattern {
  pattern: string;
  test: (id: string) => boolean;
}

export function compilePattern(raw: string): CompiledPattern {
  const pattern = raw.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (!pattern) throw new Error('empty pattern');
  const anchored = pattern.includes('/');
  const regex = new RegExp(`^${globSource(pattern)}$`);
  return {
    pattern: raw,
    test: (id) => {
      const parts = id.split('/');
      if (anchored) {
        // The file itself or one of its parent folders.
        for (let n = parts.length; n > 0; n--) if (regex.test(parts.slice(0, n).join('/'))) return true;
        return false;
      }
      return parts.some((part) => regex.test(part));
    },
  };
}

export function createScope(options: ScopeOptions = {}): Scope {
  const include = (options.include?.length ? options.include : DEFAULT_INCLUDE).map(compilePattern);
  const exclude = (options.exclude ?? []).map(compilePattern);
  const cache = new Map<string, boolean>();
  return (id) => {
    let inScope = cache.get(id);
    if (inScope === undefined) {
      inScope = include.some((p) => p.test(id)) && !exclude.some((p) => p.test(id));
      cache.set(id, inScope);
    }
    return inScope;
  };
}
