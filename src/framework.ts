import fs from 'node:fs';
import path from 'node:path';

export const FRAMEWORKS = ['next', 'nuxt'] as const;
export type FrameworkName = (typeof FRAMEWORKS)[number];

export interface FrameworkInfo {
  name: FrameworkName;
  /** Installed version (node_modules), else the range declared in package.json. */
  version?: string;
  /** Major version: Nuxt 2 / 3 / 4, Next 13 / 14 / 15… */
  major?: number;
}

const PACKAGES: Record<FrameworkName, string[]> = {
  next: ['next'],
  // nuxt3 / nuxt-edge: names used by early Nuxt 3 and nightly releases.
  nuxt: ['nuxt', 'nuxt3', 'nuxt-edge', 'nuxt-nightly'],
};
const CONFIG_FILES: Record<FrameworkName, RegExp> = {
  next: /^next\.config\.(?:[cm]?js|[cm]?ts)$/,
  nuxt: /^nuxt\.config\.(?:[cm]?js|[cm]?ts)$/,
};

function readJson(file: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** Version installed in node_modules, looked up from the project up to the filesystem root (monorepos hoist). */
function installedVersion(root: string, pkg: string): string | undefined {
  let dir = root;
  for (;;) {
    const version = readJson(path.join(dir, 'node_modules', pkg, 'package.json'))?.version;
    if (typeof version === 'string') return version;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

const majorOf = (version: string | undefined): number | undefined => {
  const match = version?.match(/(\d+)(?:\.\d+)?/);
  return match ? Number(match[1]) : undefined;
};

function declared(root: string): Map<string, string> {
  const pkg = readJson(path.join(root, 'package.json')) ?? {};
  const deps = new Map<string, string>();
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    for (const [name, range] of Object.entries((pkg[field] as Record<string, string> | undefined) ?? {})) deps.set(name, range);
  }
  return deps;
}

function info(root: string, name: FrameworkName, deps: Map<string, string>): FrameworkInfo {
  for (const pkg of PACKAGES[name]) {
    const range = deps.get(pkg);
    const installed = installedVersion(root, pkg);
    if (range === undefined && installed === undefined) continue;
    // A version installed higher up (hoisted in a monorepo) may belong to another project:
    // trust it only when it matches the range declared by this project.
    const rangeMajor = majorOf(range?.replace(/^[^\d]*/, ''));
    const version = installed && (rangeMajor === undefined || majorOf(installed) === rangeMajor) ? installed : (range ?? installed);
    // nuxt3 / nuxt-edge packages are Nuxt 3 whatever their own version number says.
    const major = pkg === 'nuxt3' ? 3 : majorOf(version?.replace(/^[^\d]*/, ''));
    return { name, ...(version && { version }), ...(major !== undefined && { major }) };
  }
  return { name };
}

/**
 * Next.js or Nuxt? `forced` (config `framework`) wins; then the dependencies of package.json;
 * then the presence of next.config.* / nuxt.config.*; Next.js by default.
 */
export function detectFramework(root: string, forced?: FrameworkName): FrameworkInfo {
  const deps = declared(root);
  if (forced) return info(root, forced, deps);
  for (const name of ['nuxt', 'next'] as const) {
    if (PACKAGES[name].some((pkg) => deps.has(pkg))) return info(root, name, deps);
  }
  let files: string[] = [];
  try {
    files = fs.readdirSync(root);
  } catch {
    /* missing directory: reported by the project loader */
  }
  for (const name of ['nuxt', 'next'] as const) {
    if (files.some((f) => CONFIG_FILES[name].test(f))) return info(root, name, deps);
  }
  return info(root, 'next', deps);
}
