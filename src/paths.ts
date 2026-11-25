import path from 'node:path';

export const toPosix = (p: string): string => p.split(path.sep).join('/');

/** Absolute path -> project-relative POSIX id. */
export const toId = (root: string, abs: string): string => toPosix(path.relative(root, abs));

/** Project-relative POSIX id -> absolute path. */
export const fromId = (root: string, id: string): string => path.join(root, ...id.split('/'));
