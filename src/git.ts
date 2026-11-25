import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { toId } from './paths.js';
import type { ProjectGraph } from './types.js';

const git = (cwd: string, args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/**
 * Files changed since `ref`, as absolute paths: commits since the merge-base with `ref`
 * (what a pull request contains), plus uncommitted and untracked files.
 */
export function changedFilesSince(ref: string, cwd: string): string[] {
  let top: string;
  try {
    top = git(cwd, ['rev-parse', '--show-toplevel']).trim();
  } catch {
    throw new Error(`${cwd} is not inside a git repository`);
  }
  let base: string;
  try {
    base = git(top, ['merge-base', ref, 'HEAD']).trim();
  } catch {
    throw new Error(`Unknown git ref "${ref}"`);
  }
  const lines = [
    ...git(top, ['diff', '--name-only', base]).split('\n'),
    ...git(top, ['ls-files', '--others', '--exclude-standard']).split('\n'),
  ];
  // git returns real paths: express them with the caller's spelling of `cwd` (symlinks, /var -> /private/var).
  const realCwd = fs.realpathSync(cwd);
  return [...new Set(lines.map((l) => l.trim()).filter(Boolean))].map((file) =>
    path.resolve(cwd, path.relative(realCwd, path.join(top, file))),
  );
}

/** Files whose change can affect every route (dependencies, build config, middleware…). */
const GLOBAL_FILES =
  /^(?:src\/)?(?:package\.json|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|tsconfig\.json|jsconfig\.json|next\.config\.[cm]?[jt]s|middleware\.[jt]s|proxy\.[jt]s|instrumentation\.[jt]s|\.env.*|postcss\.config\.[cm]?[jt]s|tailwind\.config\.[cm]?[jt]s|nuxt\.config\.[cm]?[jt]s|\.nuxtrc|(?:app\/)?app\.config\.[cm]?[jt]s|(?:app\/)?router\.options\.[cm]?[jt]s)$/;

export interface ClassifiedChanges {
  /** Changed files that are part of the module graph. */
  inGraph: string[];
  /** Config files that may impact the whole app. */
  global: string[];
  /** Changed files of the project not used by any route (tests, docs, unused code…). */
  unused: string[];
}

/** Sorts changed files (absolute paths) of a project; files outside the project are dropped. */
export function classifyChanges(graph: ProjectGraph, files: string[]): ClassifiedChanges {
  const result: ClassifiedChanges = { inGraph: [], global: [], unused: [] };
  for (const file of files) {
    const id = toId(graph.root, file);
    if (id.startsWith('..') || path.isAbsolute(id)) continue;
    if (graph.modules[id]) result.inGraph.push(id);
    else if (GLOBAL_FILES.test(id)) result.global.push(id);
    else result.unused.push(id);
  }
  return result;
}
