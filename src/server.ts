import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze, type AnalyzeOptions } from './analyze.js';
import { CONFIG_FILES, loadConfig, type ImpactAnalyserConfig } from './config.js';
import {
  componentImpact,
  impact,
  rankComponents,
  rankModules,
  type RankedComponent,
  type RankedModule,
} from './impact.js';
import { loadProject } from './project.js';
import type { ProjectGraph } from './types.js';
import { WATCH_IGNORED } from './watch.js';

export interface ServeOptions extends AnalyzeOptions {
  /** Next.js project directory. */
  root: string;
  /** Default 4321; the next free port is used if it is taken. 0 = random port. */
  port?: number;
  /** Default 127.0.0.1: the UI is only reachable from this machine. */
  host?: string;
  /**
   * Extra host names accepted in the `Host` header (e.g. a Codespaces / VM forwarded domain).
   * By default only localhost, 127.0.0.1 and [::1] are accepted (DNS rebinding protection).
   */
  allowedHosts?: string[];
  /** Re-analyse when a file changes and refresh the browser (default true). */
  watch?: boolean;
  /** Open the browser. */
  open?: boolean;
  /** Settings exposed to the UI (language, editor, app URL). */
  config?: ImpactAnalyserConfig;
  /**
   * Re-reads the config when impact-analyser.config.* or package.json changes (hot reload).
   * Default: loadConfig(root), keeping the current language when the file sets none.
   */
  reloadConfig?: () => Promise<ImpactAnalyserConfig>;
  /** Called after each (re)analysis. `configReloaded` is set when a config change triggered it. */
  onAnalyze?: (info: { durationMs: number; error?: string; configReloaded?: boolean }) => void;
}

export interface UiServer {
  url: string;
  close(): Promise<void>;
}

const UI_DIR = fileURLToPath(new URL('../ui/', import.meta.url));
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};
/**
 * Security headers of the UI server only (they never apply to the analysed app).
 * The UI loads nothing from outside: its own scripts and styles, data: favicon, same-origin API.
 */
const SECURITY_HEADERS = {
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
};

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** `localhost:4321` -> { name: 'localhost', port: '4321' }; `[::1]:4321` -> { name: '[::1]', port: '4321' }. */
function parseHost(value: string | undefined): { name: string; port: string } | undefined {
  const match = value?.trim().toLowerCase().match(/^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/);
  return match ? { name: match[1]!, port: match[2] ?? '80' } : undefined;
}


export async function serve(options: ServeOptions): Promise<UiServer> {
  const project = loadProject(options.root, options);
  const state: {
    graph?: ProjectGraph;
    error?: string;
    version: number;
    analyzedAt?: string;
    ranking?: RankedModule[];
    componentRanking?: RankedComponent[];
  } = { version: 0 };
  let config: ImpactAnalyserConfig = options.config ?? {};
  /** Error of the last config reload: the previous config stays active until the file is fixed. */
  let configError: string | undefined;
  const uiConfig = () => ({
    lang: config.lang ?? 'en',
    editor: config.editor ?? 'vscode',
    appUrl: config.appUrl ?? 'http://localhost:3000',
  });
  const clients = new Set<http.ServerResponse>();

  const runAnalysis = (configReloaded = false) => {
    const start = performance.now();
    try {
      state.graph = analyze(project.root, {
        pageExtensions: config.pageExtensions ?? options.pageExtensions,
        include: config.include ?? options.include,
        exclude: config.exclude ?? options.exclude,
        framework: config.framework ?? options.framework,
      });
      state.error = undefined;
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
    }
    state.version++;
    state.analyzedAt = new Date().toISOString();
    state.ranking = undefined;
    state.componentRanking = undefined;
    const durationMs = Math.round(performance.now() - start);
    options.onAnalyze?.({ durationMs, error: state.error ?? configError, ...(configReloaded && { configReloaded }) });
    for (const client of clients) client.write(`event: graph\ndata: ${state.version}\n\n`);
  };
  runAnalysis();

  const reloadConfig =
    options.reloadConfig ??
    (async () => {
      const { config: next } = await loadConfig(project.root);
      return { ...next, lang: next.lang ?? config.lang };
    });
  const applyConfigChange = async () => {
    try {
      config = await reloadConfig();
      configError = undefined;
    } catch (error) {
      configError = `impact-analyser config: ${error instanceof Error ? error.message : String(error)}`;
    }
    runAnalysis(true);
  };

  // Hot reload: source files re-run the analysis, config files re-read the config first.
  const CONFIG_NAMES = new Set([...CONFIG_FILES, 'package.json']);
  const watchers: fs.FSWatcher[] = [];
  if (options.watch !== false) {
    let timer: NodeJS.Timeout | undefined;
    let configChanged = false;
    const schedule = (isConfig: boolean) => {
      configChanged ||= isConfig;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const withConfig = configChanged;
        configChanged = false;
        if (withConfig) void applyConfigChange();
        else runAnalysis();
      }, 150);
    };
    // The whole project: src/, Nuxt 4 app/ + server/ + shared/, and the config files at the root.
    watchers.push(
      fs.watch(project.root, { recursive: true }, (_event, filename) => {
        const name = filename?.toString();
        if (name && WATCH_IGNORED.test(name)) return;
        schedule(name !== undefined && CONFIG_NAMES.has(name));
      }),
    );
  }

  const sendJson = (res: http.ServerResponse, status: number, data: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(data));
  };

  const handleApi = (url: URL, res: http.ServerResponse) => {
    if (url.pathname === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(`event: graph\ndata: ${state.version}\n\n`);
      clients.add(res);
      res.on('close', () => clients.delete(res));
      return;
    }
    if (url.pathname === '/api/config') return sendJson(res, 200, uiConfig());
    if (!state.graph || state.error) return sendJson(res, 500, { error: state.error ?? 'No graph' });
    const graph = state.graph;
    const includeTypeOnly = url.searchParams.get('types') === '1';

    switch (url.pathname) {
      case '/api/graph':
        return sendJson(res, 200, { version: state.version, analyzedAt: state.analyzedAt, graph, ...(configError && { configError }) });
      case '/api/impact': {
        const files = url.searchParams.getAll('file');
        if (files.length === 0) return sendJson(res, 400, { error: 'Missing ?file=' });
        return sendJson(res, 200, impact(graph, files, { cwd: graph.root, includeTypeOnly }));
      }
      case '/api/ranking':
        state.ranking ??= rankModules(graph);
        return sendJson(res, 200, state.ranking);
      case '/api/components/ranking':
        state.componentRanking ??= rankComponents(graph);
        return sendJson(res, 200, state.componentRanking);
      case '/api/component': {
        const id = url.searchParams.get('id') ?? '';
        const component = graph.components[id];
        if (!component) return sendJson(res, 404, { error: `Unknown component ${id}` });
        // Pages showing each usage: the routes impacted by the file that renders it.
        const routesByFile: Record<string, number[]> = {};
        for (const file of new Set(component.usages.map((u) => u.module))) {
          const fileImpact = impact(graph, [file], { cwd: graph.root, includeTypeOnly });
          routesByFile[file] = fileImpact.routes.map((r) => graph.routes.indexOf(r.route));
        }
        return sendJson(res, 200, {
          component,
          impact: componentImpact(graph, id, { includeTypeOnly }),
          routesByFile,
        });
      }
      default:
        return sendJson(res, 404, { error: 'Not found' });
    }
  };

  const allowedNames = new Set([...LOOPBACK, ...(options.allowedHosts ?? []).map((h) => h.toLowerCase())]);
  if (options.host && !['0.0.0.0', '::'].includes(options.host)) allowedNames.add(options.host.toLowerCase());
  /**
   * DNS rebinding protection: a web page whose domain resolves to 127.0.0.1 could otherwise read the API
   * from the developer's browser. Only requests addressed to this server by a local name are answered.
   */
  const isAllowedHost = (value: string | undefined): boolean => {
    const host = parseHost(value);
    if (!host || !allowedNames.has(host.name)) return false;
    const address = server.address();
    const port = typeof address === 'object' && address ? String(address.port) : undefined;
    // Custom allowedHosts may sit behind a proxy on another port; local names must use this server's port.
    return !LOOPBACK.has(host.name) || !port || host.port === port;
  };
  /** API calls from another site (`Origin: https://evil.example`) are refused; same-origin calls are allowed. */
  const isAllowedOrigin = (origin: string | undefined, host: string | undefined): boolean => {
    if (!origin) return true;
    try {
      return new URL(origin).host.toLowerCase() === host?.toLowerCase();
    } catch {
      return false;
    }
  };

  const server = http.createServer((req, res) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
    if (!isAllowedHost(req.headers.host)) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }).end('impact-analyser: host not allowed (see the allowedHosts option)');
      return;
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      if (!isAllowedOrigin(req.headers.origin, req.headers.host)) {
        res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }).end('impact-analyser: cross-origin request refused');
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { allow: 'GET' }).end();
        return;
      }
      return handleApi(url, res);
    }

    // UI assets live at /styles.css and /js/*; every other path is a page of the app (/components/Button…),
    // routed in the browser: serve index.html so that reloads and shared links work.
    const isAsset = url.pathname === '/styles.css' || url.pathname.startsWith('/js/');
    const file = path.join(UI_DIR, isAsset ? url.pathname : 'index.html');
    const type = CONTENT_TYPES[path.extname(file)];
    if (!file.startsWith(UI_DIR) || !type || !fs.existsSync(file)) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });

  const host = options.host ?? '127.0.0.1';
  const port = await listen(server, host, options.port ?? 4321);
  const url = `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`;
  if (options.open) openBrowser(url);

  return {
    url,
    close: () =>
      new Promise<void>((resolve) => {
        for (const w of watchers) w.close();
        for (const client of clients) client.end();
        server.close(() => resolve());
      }),
  };
}

function listen(server: http.Server, host: string, port: number, attempts = 10): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE' && port !== 0 && attempts > 1) {
        resolve(listen(server, host, port + 1, attempts - 1));
      } else {
        reject(error);
      }
    };
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : port);
    });
  });
}

function openBrowser(url: string): void {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  spawn(command, args as string[], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}
