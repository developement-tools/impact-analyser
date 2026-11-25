import fs from 'node:fs';

/** Generated folders and dependencies: their changes never require a new analysis. */
export const WATCH_IGNORED = /(?:^|[\\/])(?:node_modules|\.next|\.nuxt|\.output|\.data|\.git|\.turbo|\.impact-analyser|dist|out|coverage)(?:[\\/]|$)/;

/**
 * Calls `onChange` (debounced) when a file of the project changes.
 * `ignore` skips paths (relative to root) such as the generated impact map itself.
 */
export function watchProject(root: string, onChange: (files: string[]) => void, ignore: (relative: string) => boolean = () => false): fs.FSWatcher {
  let timer: NodeJS.Timeout | undefined;
  let pending: string[] = [];
  return fs.watch(root, { recursive: true }, (_event, filename) => {
    const name = filename?.toString();
    if (!name || WATCH_IGNORED.test(name) || ignore(name.split('\\').join('/'))) return;
    pending.push(name);
    clearTimeout(timer);
    timer = setTimeout(() => {
      const files = pending;
      pending = [];
      onChange(files);
    }, 150);
  });
}
