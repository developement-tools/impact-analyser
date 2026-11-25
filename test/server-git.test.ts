import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyze, changedFilesSince, classifyChanges, formatImpactMarkdown, impact, rankModules, serve, type UiServer } from '../src/index.js';

const NEXT16 = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/next16');

describe('ui server', () => {
  let server: UiServer;
  beforeAll(async () => {
    server = await serve({ root: NEXT16, port: 0, watch: false });
  });
  afterAll(() => server.close());

  it('serves the UI and the graph', async () => {
    const page = await fetch(server.url);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<script type="module" src="/js/main.js">');
    expect((await fetch(`${server.url}/js/main.js`)).status).toBe(200);
    expect((await fetch(`${server.url}/js/views/components.js`)).status).toBe(200);
    // Readable app URLs are routed in the browser: the server returns the app for deep links.
    for (const deep of ['/components/Button?tab=variants', '/routes/app/dashboard/settings', '/files/src/components/ui/index.ts', '/reference/barrel']) {
      const res = await fetch(`${server.url}${deep}`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('<script type="module" src="/js/main.js">');
    }
    expect(await (await fetch(`${server.url}/api/config`)).json()).toEqual({ lang: 'en', editor: 'vscode', appUrl: 'http://localhost:3000' });

    const { graph, version } = await (await fetch(`${server.url}/api/graph`)).json();
    expect(version).toBe(1);
    expect(graph.routes.length).toBeGreaterThan(5);
  });

  it('computes impact and ranking', async () => {
    const result = await (await fetch(`${server.url}/api/impact?file=src/components/ui/Modal.tsx`)).json();
    expect(result.routes.map((r: { route: { path: string } }) => r.route.path)).toEqual(['/dashboard/settings']);
    expect(result.edges).toContainEqual({ from: 'src/features/settings/SettingsPanel.tsx', to: 'src/components/ui/Modal.tsx' });

    const ranking = await (await fetch(`${server.url}/api/ranking`)).json();
    // Editing the ui barrel itself hits every importer: the 9 App Router routes (Header) + /legacy.
    expect(ranking[0]).toMatchObject({ id: 'src/components/ui/index.ts', routes: 10 });
  });

  it('describes a component with its usages and the pages showing each of them', async () => {
    const id = encodeURIComponent('src/components/ui/Modal.tsx#default');
    const data = await (await fetch(`${server.url}/api/component?id=${id}`)).json();
    expect(data.component.name).toBe('Modal');
    expect(data.impact.routes.map((r: { route: { path: string } }) => r.route.path)).toEqual(['/dashboard/settings']);
    expect(Object.keys(data.routesByFile)).toEqual(['src/features/settings/SettingsPanel.tsx']);
    expect((await fetch(`${server.url}/api/component?id=nope`)).status).toBe(404);
  });

  it('does not serve files outside the UI folder', async () => {
    // No file outside ui/ can be read: traversal attempts get the app page (or a 404 for assets).
    for (const attempt of ['/../package.json', '/%2e%2e/package.json', '/js/../../package.json', '/js/%2e%2e/%2e%2e/package.json']) {
      const res = await fetch(`${server.url}${attempt}`);
      expect(await res.text()).not.toContain('"name": "impact-analyser"');
    }
    expect((await fetch(`${server.url}/js/nope.js`)).status).toBe(404);
  });
});

describe('rankModules', () => {
  it('puts the files impacting the most routes first', () => {
    const ranking = rankModules(analyze(NEXT16));
    const button = ranking.find((m) => m.id === 'src/components/ui/Button.tsx')!;
    const card = ranking.find((m) => m.id === 'src/components/ui/Card.tsx')!;
    expect(button.routes).toBe(9); // root layout header: every App Router page
    expect(card.routes).toBe(7);
    expect(ranking.indexOf(button)).toBeLessThan(ranking.indexOf(card));
  });
});

describe('impact --since', () => {
  let repo: string;
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' }).toString();
  const write = (file: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), content);
  };

  beforeAll(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'impact-analyser-git-'));
    git('init', '-q');
    git('symbolic-ref', 'HEAD', 'refs/heads/main');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'test');
    write('web/app/page.tsx', `import { Title } from '../components/Title';\nexport default () => <Title />;`);
    write('web/app/about/page.tsx', `export default () => <p>About</p>;`);
    write('web/components/Title.tsx', `export const Title = () => <h1>Hi</h1>;`);
    write('web/README.md', 'readme');
    git('add', '.');
    git('commit', '-q', '-m', 'init');
    git('checkout', '-q', '-b', 'feature');
    write('web/components/Title.tsx', `export const Title = () => <h1>Hello</h1>;`); // uncommitted change
    write('web/package.json', '{}'); // untracked global file
    write('web/README.md', 'changed');
  });
  afterAll(() => fs.rmSync(repo, { recursive: true, force: true }));

  it('finds the changed files and the impacted routes', () => {
    const root = path.join(repo, 'web');
    const graph = analyze(root);
    const changes = classifyChanges(graph, changedFilesSince('main', root));
    expect(changes).toEqual({
      inGraph: ['components/Title.tsx'],
      global: ['package.json'],
      unused: ['README.md'],
    });
    const result = impact(graph, changes.inGraph, { cwd: root });
    expect(result.routes.map((r) => r.route.path)).toEqual(['/']);

    const md = formatImpactMarkdown(graph, result, { changes, since: 'main' });
    expect(md).toContain('### impact-analyser — 1 impacted route');
    expect(md).toContain('`package.json` changed');
    expect(md).toContain('| App Router | `/` | page.tsx → Title.tsx |');
  });

  it('fails clearly on an unknown ref', () => {
    expect(() => changedFilesSince('does-not-exist', repo)).toThrow('Unknown git ref "does-not-exist"');
  });
});

describe('ui server hot reload', () => {
  const waitFor = async <T>(read: () => Promise<T>, ok: (value: T) => boolean, timeout = 4000): Promise<T> => {
    const end = Date.now() + timeout;
    for (;;) {
      const value = await read();
      if (ok(value) || Date.now() > end) return value;
      await new Promise((r) => setTimeout(r, 50));
    }
  };

  it('re-reads impact-analyser.config.json when it changes, and survives an invalid edit', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'impact-analyser-hot-'));
    fs.mkdirSync(path.join(dir, 'src/app'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'src/legacy'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src/app/page.tsx'), 'export default function Page() { return null; }\n');
    fs.writeFileSync(path.join(dir, 'src/legacy/Old.tsx'), 'export function Old() { return null; }\n');
    const configFile = path.join(dir, 'impact-analyser.config.json');
    fs.writeFileSync(configFile, JSON.stringify({ editor: 'vscode' }));

    const server = await serve({ root: dir, port: 0, config: { editor: 'vscode' } });
    const graph = async () => (await (await fetch(`${server.url}/api/graph`)).json()) as { graph: { unreachable: string[]; scope: { exclude: string[] } }; configError?: string };
    try {
      expect((await graph()).graph.unreachable).toContain('src/legacy/Old.tsx');

      fs.writeFileSync(configFile, JSON.stringify({ editor: 'cursor', exclude: ['src/legacy'] }));
      const updated = await waitFor(graph, (g) => g.graph.scope.exclude.length > 0);
      expect(updated.graph.scope.exclude).toEqual(['src/legacy']);
      expect(updated.graph.unreachable).not.toContain('src/legacy/Old.tsx');
      expect(await (await fetch(`${server.url}/api/config`)).json()).toMatchObject({ editor: 'cursor' });

      // Half-typed JSON: the error is reported, the previous config stays active.
      fs.writeFileSync(configFile, '{ "exclude": [');
      const broken = await waitFor(graph, (g) => Boolean(g.configError));
      expect(broken.configError).toMatch(/impact-analyser config/);
      expect(broken.graph.scope.exclude).toEqual(['src/legacy']);

      fs.writeFileSync(configFile, JSON.stringify({ exclude: [] }));
      const fixed = await waitFor(graph, (g) => !g.configError && g.graph.scope.exclude.length === 0);
      expect(fixed.configError).toBeUndefined();
      expect(fixed.graph.unreachable).toContain('src/legacy/Old.tsx');
    } finally {
      await server.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('ui server security (only the UI server, never the analysed app)', () => {
  let server: UiServer;
  let port: string;
  beforeAll(async () => {
    server = await serve({ root: NEXT16, port: 0, watch: false, allowedHosts: ['my-codespace.example.dev'] });
    port = new URL(server.url).port;
  });
  afterAll(() => server.close());

  /** fetch() cannot forge Host / Origin: use node:http directly. */
  const request = (pathname: string, headers: Record<string, string>) =>
    new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: Number(port), path: pathname, headers }, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      });
      req.on('error', reject);
      req.end();
    });

  it('refuses requests addressed to another host name (DNS rebinding)', async () => {
    expect((await request('/api/graph', { host: `evil.example.com:${port}` })).status).toBe(403);
    expect((await request('/', { host: 'attacker.test' })).status).toBe(403);
    // Local names, on this server's port only.
    expect((await request('/api/config', { host: `localhost:${port}` })).status).toBe(200);
    expect((await request('/api/config', { host: `127.0.0.1:${port}` })).status).toBe(200);
    expect((await request('/api/config', { host: `[::1]:${port}` })).status).toBe(200);
    expect((await request('/api/config', { host: 'localhost:9999' })).status).toBe(403);
    // allowedHosts (e.g. a forwarded Codespaces domain, any port behind its proxy).
    expect((await request('/api/config', { host: 'my-codespace.example.dev' })).status).toBe(200);
  });

  it('refuses API calls from another site, accepts same-origin calls', async () => {
    const host = `localhost:${port}`;
    expect((await request('/api/graph', { host, origin: 'https://evil.example.com' })).status).toBe(403);
    expect((await request('/api/events', { host, origin: 'http://localhost:3000' })).status).toBe(403); // the app itself has no reason to read it
    expect((await request('/api/config', { host, origin: `http://${host}` })).status).toBe(200);
    expect((await request('/api/config', { host })).status).toBe(200);
  });

  it('sends security headers on the UI responses', async () => {
    const res = await request('/', { host: `localhost:${port}` });
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });
});
