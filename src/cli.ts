#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { analyze } from './analyze.js';
import { loadConfig, resolveLang, type LoadedConfig } from './config.js';
import { formatImpact, formatImpactMarkdown, formatRoutes, formatTree, type ImpactContext } from './format.js';
import { changedFilesSince, classifyChanges } from './git.js';
import { createTranslator } from './i18n.js';
import { impact } from './impact.js';
import { DEFAULT_OUTPUT, formatImpactMap } from './map.js';
import { serve } from './server.js';
import { watchProject } from './watch.js';

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      dir: { type: 'string', short: 'd' },
      out: { type: 'string', short: 'o' },
      lang: { type: 'string' },
      json: { type: 'boolean', default: false },
      types: { type: 'boolean', default: false },
      depth: { type: 'string' },
      since: { type: 'string' },
      format: { type: 'string' },
      port: { type: 'string', short: 'p' },
      open: { type: 'boolean', default: false },
      'no-watch': { type: 'boolean', default: false },
      include: { type: 'string', multiple: true },
      exclude: { type: 'string', multiple: true },
      check: { type: 'boolean', default: false },
      watch: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  const [command, ...args] = positionals;
  // `routes`, `analyze`, `ui` and `generate` accept the project as a positional argument.
  const takesDirArg = command === 'routes' || command === 'analyze' || command === 'ui' || command === 'generate';
  const root = path.resolve(values.dir ?? (takesDirArg ? args[0] : undefined) ?? '.');
  const { config, file: configFile } = await loadConfig(root).catch((error: unknown): LoadedConfig => {
    // A broken config must not hide the help.
    if (!command || values.help) return { config: {}, file: undefined };
    throw error;
  });
  const lang = resolveLang(values.lang, config);
  const t = createTranslator(lang);

  if (!command || values.help) {
    console.log(t('cli.help'));
    return 0;
  }

  // --include / --exclude replace the config values (repeat the flag for several patterns).
  if (values.include?.length) config.include = values.include;
  if (values.exclude?.length) config.exclude = values.exclude;
  const analyzeProject = () => analyze(root, { pageExtensions: config.pageExtensions, include: config.include, exclude: config.exclude, framework: config.framework });

  switch (command) {
    case 'routes': {
      const graph = analyzeProject();
      console.log(values.json ? JSON.stringify(graph.routes, null, 2) : formatRoutes(graph, { lang }));
      return 0;
    }

    case 'tree': {
      const [route] = args;
      if (!route) throw new Error(t('cli.missingRoute'));
      const depth = values.depth ? Number(values.depth) : undefined;
      console.log(formatTree(analyzeProject(), route, { includeTypeOnly: values.types, depth, lang }));
      return 0;
    }

    case 'impact': {
      const format = values.json ? 'json' : (values.format ?? 'text');
      if (!['text', 'json', 'md'].includes(format)) throw new Error(t('cli.unknownFormat', { format }));
      if (args.length === 0 && !values.since) throw new Error(t('cli.missingFiles'));
      const graph = analyzeProject();
      const context: ImpactContext = { lang };
      let files = args;
      if (values.since) {
        context.since = values.since;
        context.changes = classifyChanges(graph, [
          ...changedFilesSince(values.since, graph.root),
          ...args.map((f) => path.resolve(f)),
        ]);
        files = context.changes.inGraph;
      }
      const result = impact(graph, files, { includeTypeOnly: values.types, cwd: values.since ? graph.root : undefined });
      if (format === 'json') console.log(JSON.stringify({ ...result, ...(context.changes && { changes: context.changes }) }, null, 2));
      else if (format === 'md') console.log(formatImpactMarkdown(graph, result, context));
      else console.log(formatImpact(graph, result, context));
      return 0;
    }

    case 'ui': {
      const port = values.port ? Number(values.port) : config.port;
      const server = await serve({
        root,
        port,
        open: values.open,
        ...(config.allowedHosts && { allowedHosts: config.allowedHosts }),
        watch: !values['no-watch'],
        config: { ...config, lang },
        // Hot reload of the config: the command-line flags keep priority over the file.
        reloadConfig: async () => {
          const { config: next } = await loadConfig(root);
          if (values.include?.length) next.include = values.include;
          if (values.exclude?.length) next.exclude = values.exclude;
          return { ...next, lang: resolveLang(values.lang, next) };
        },
        onAnalyze: ({ durationMs, error, configReloaded }) => {
          if (configReloaded) console.log(t('cli.configReloaded'));
          console.log(error ? t('cli.analysisFailed', { error }) : t('cli.analysed', { ms: durationMs }));
        },
      });
      console.log(`${t('cli.uiFor', { root })}\n→ ${server.url}\n${t('cli.stop')}`);
      if (configFile) console.log(t('cli.config', { file: path.relative(process.cwd(), configFile) || configFile }));
      await new Promise<void>((resolve) => process.once('SIGINT', resolve));
      await server.close();
      return 0;
    }

    case 'analyze': {
      const graph = analyzeProject();
      const json = JSON.stringify(graph, null, 2);
      if (!values.out) {
        console.log(json);
        return 0;
      }
      fs.mkdirSync(path.dirname(path.resolve(values.out)), { recursive: true });
      fs.writeFileSync(values.out, json + '\n');
      const routes = t('n.route', { n: graph.routes.length });
      const modules = t('n.module', { n: Object.keys(graph.modules).length });
      console.error(t('cli.graphWritten', { file: values.out, routes, modules }));
      return 0;
    }

    case 'generate': {
      // docs/impact-map.md by default; output.dir / output.file in the config; --out for one run.
      const target = values.out
        ? path.resolve(values.out)
        : path.resolve(root, config.output?.dir ?? DEFAULT_OUTPUT.dir, config.output?.file ?? DEFAULT_OUTPUT.file);
      const display = path.relative(process.cwd(), target) || target;
      const read = () => (fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : undefined);
      const size = (text: string) => t('cli.mapSize', { kb: (Buffer.byteLength(text) / 1024).toFixed(1), tokens: Math.round(text.length / 4).toLocaleString(lang) });

      if (values.check) {
        const expected = formatImpactMap(analyzeProject());
        if (read() === expected) {
          console.log(t('cli.mapUpToDate', { file: display }));
          return 0;
        }
        console.error(t('cli.mapOutdated', { file: display }));
        return 1;
      }

      const generate = (): void => {
        const start = performance.now();
        const text = formatImpactMap(analyzeProject());
        const existed = fs.existsSync(target);
        const ms = Math.round(performance.now() - start);
        if (read() === text) {
          console.log(t('cli.mapUnchanged', { file: display, ms }));
          return;
        }
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, text);
        console.log(t(existed ? 'cli.mapUpdated' : 'cli.mapCreated', { file: display, ms, size: size(text) }));
        if (!existed) console.log(t('cli.mapHint', { file: path.relative(root, target) }));
      };
      generate();
      if (!values.watch) return 0;

      // Regenerate on every save; the map itself (and other generated files) never triggers a run.
      const self = path.relative(root, target).split(path.sep).join('/');
      const watcher = watchProject(root, () => {
        try {
          generate();
        } catch (error) {
          console.error(t('cli.analysisFailed', { error: error instanceof Error ? error.message : String(error) }));
        }
      }, (relative) => relative === self);
      console.log(t('cli.mapWatching'));
      await new Promise<void>((resolve) => process.once('SIGINT', resolve));
      watcher.close();
      return 0;
    }

    default:
      throw new Error(t('cli.unknownCommand', { command }));
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(`impact-analyser: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  },
);
