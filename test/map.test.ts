import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { analyze, formatImpactMap, usageSnippet } from '../src/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NEXT16 = path.join(HERE, 'fixtures/next16');
const NUXT4 = path.join(HERE, 'fixtures/nuxt4');
const BIN = path.resolve(HERE, '../bin/impact-analyser.js');
const NEXT13 = path.join(HERE, 'fixtures/next13');

describe('impact map (Markdown for AI assistants)', () => {
  it('is deterministic: same project, same text (no timestamp)', () => {
    expect(formatImpactMap(analyze(NEXT16))).toBe(formatImpactMap(analyze(NEXT16)));
  });

  it('describes a Next.js app: summary, high impact, routes, components with usages, modules, dead code', () => {
    const map = formatImpactMap(analyze(NEXT16));
    expect(map).toContain('- Framework: Next.js');
    expect(map).toContain('(App Router + Pages Router)');
    expect(map).toContain('- `<Button>` component — 7/9 pages — `src/components/ui/Button.tsx`');
    expect(map).toContain('### <Button>');
    expect(map).toContain('- props: variant: "primary"×2 | "danger"×1 | "ghost"×1 | expr×1 | unset×2');
    expect(map).toContain('  - `src/components/layout/Header.tsx:19` `<Button variant="primary" size="sm" />`');
    expect(map).toContain('- `/legacy` [pages] → `src/pages/legacy/index.tsx` · wrappers: _app `src/pages/_app.tsx`');
    expect(map).toContain('- `src/lib/types.ts` (util)\n  - pages: none (types only, no runtime impact)');
    expect(map).toContain('- unreachable file: `src/components/UnusedWidget.tsx`');
    expect(map).toContain('- component never rendered: `<Avatar>`');
    // Sections in a fixed order.
    const order = ['## Summary', '## High impact', '## Routes', '## Layouts and wrappers', '## Components', '## Shared modules', '## Dead code'];
    expect(order.map((h) => map.indexOf(h))).toEqual([...order.map((h) => map.indexOf(h))].sort((a, b) => a - b));
  });

  it('describes a Nuxt app with Vue syntax, composables and wrappers shared by every page listed once', () => {
    const map = formatImpactMap(analyze(NUXT4));
    expect(map).toContain('- Framework: Nuxt 4');
    expect(map).toContain('Every page is also wrapped by: plugin toast `app/plugins/toast.ts`');
    expect(map).toContain('- `/checkout` → `app/pages/checkout.vue` · renders: <BaseButton>'); // layout: false, no own wrapper
    expect(map).toContain('`app/components/settings/SettingsPanel.client.vue:7` `<BaseButton variant="danger" @click="open = true" />`');
    expect(map).toContain('`useCart.ts` composable — 6/7 pages');
  });

  it('formats usages in JSX or Vue template syntax', () => {
    const props = [
      { name: 'variant', kind: 'literal', value: 'primary', type: 'string' },
      { name: 'size', kind: 'literal', value: '2', type: 'number' },
      { name: 'disabled', kind: 'literal', value: 'true', type: 'boolean' },
      { name: 'onClick', kind: 'expression', value: 'go' },
      { name: '...', kind: 'spread', value: 'rest' },
    ] as const;
    expect(usageSnippet('Button', [...props], false)).toBe('<Button variant="primary" size={2} disabled onClick={go} {...rest} />');
    expect(usageSnippet('BaseButton', [...props], true)).toBe('<BaseButton variant="primary" :size="2" disabled @click="go" v-bind="rest" />');
  });
});

describe('impact-analyser generate', () => {
  const tmps: string[] = [];
  afterEach(() => {
    for (const dir of tmps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });
  const copy = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'impact-analyser-generate-'));
    fs.cpSync(NEXT13, dir, { recursive: true });
    tmps.push(dir);
    return dir;
  };
  const run = (dir: string, ...args: string[]) => spawnSync(process.execPath, [BIN, 'generate', dir, '--lang', 'en', ...args], { encoding: 'utf8' });

  it('creates docs/impact-map.md (and docs/) by default, then replaces it', () => {
    const dir = copy();
    const file = path.join(dir, 'docs', 'impact-map.md');
    expect(fs.existsSync(path.join(dir, 'docs'))).toBe(false);

    const first = run(dir);
    expect(first.status).toBe(0);
    expect(first.stdout).toContain('created');
    expect(fs.readFileSync(file, 'utf8')).toContain('# Impact map');

    // An old or hand-edited file is replaced by the new map.
    fs.writeFileSync(file, 'stale content');
    const second = run(dir);
    expect(second.stdout).toContain('updated');
    expect(fs.readFileSync(file, 'utf8')).toBe(formatImpactMap(analyze(dir)));

    // Nothing changed: the file is not rewritten.
    const mtime = fs.statSync(file).mtimeMs;
    expect(run(dir).stdout).toContain('already up to date');
    expect(fs.statSync(file).mtimeMs).toBe(mtime);
  });

  it('writes to output.dir / output.file from the config', () => {
    const dir = copy();
    fs.writeFileSync(path.join(dir, 'impact-analyser.config.json'), JSON.stringify({ output: { dir: '.ai/context', file: 'app-map.md' } }));
    expect(run(dir).status).toBe(0);
    expect(fs.existsSync(path.join(dir, '.ai/context/app-map.md'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'docs'))).toBe(false);
  });

  it('--check fails when the map is missing or outdated, passes when up to date', () => {
    const dir = copy();
    expect(run(dir, '--check').status).toBe(1);
    run(dir);
    expect(run(dir, '--check').status).toBe(0);
    // A new page makes the map outdated.
    fs.mkdirSync(path.join(dir, 'src/app/new'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src/app/new/page.page.tsx'), 'export default function New() { return null; }\n');
    const outdated = run(dir, '--check');
    expect(outdated.status).toBe(1);
    expect(outdated.stderr).toContain('outdated');
  });

  it('rejects an invalid output config', () => {
    const dir = copy();
    fs.writeFileSync(path.join(dir, 'impact-analyser.config.json'), JSON.stringify({ output: 'docs' }));
    const result = run(dir);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('"output" must be');
  });
});

