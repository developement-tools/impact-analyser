# impact-analyser

**English** · [Français](README.fr.md) · [Full documentation](docs/index.html)

Map the routes and components of a **Next.js** or **Nuxt** app: where every component is used, with which variants, and which pages a change can affect — before you change it.

- **Next.js 9 → 16** (App Router and Pages Router) · **Nuxt 2, 3, 4** · Node.js ≥ 20
- Static analysis: reads your source code, never runs your app, adds nothing to it
- Visual explorer, impact of a file or a branch, pull request summaries, **map for AI assistants**, dead code

## Installation

Install it as a **dev dependency** of the app (it is a development tool, nothing ships to production):

```bash
npm install --save-dev impact-analyser
# pnpm add -D impact-analyser · yarn add -D impact-analyser · bun add -d impact-analyser
```

```json
// package.json of the app
"scripts": {
  "analyse:ui": "impact-analyser ui --open",
  "analyse:generate": "impact-analyser generate",
  "analyse:impact": "impact-analyser impact --since main"
}
```

The framework, its version and the source folders are detected from `package.json`. No configuration is required.

## Quick start

```bash
npx impact-analyser ui --open                          # visual explorer: http://127.0.0.1:4321
npx impact-analyser impact src/components/ui/Button.tsx # pages impacted by a file
npx impact-analyser impact --since main                 # pages impacted by the current branch
npx impact-analyser generate                            # docs/impact-map.md for AI assistants
npx impact-analyser routes                              # every route with its layouts
```

## Global configuration

Optional, shared by every command and by the explorer. First file found at the app root: `impact-analyser.config.json`, `impact-analyser.config.mjs` / `.js` (default export, `defineConfig` for types), or the `"impactAnalyser"` key of `package.json`.

```json
{
  "lang": "en",
  "editor": "vscode",
  "appUrl": "http://localhost:3000",
  "port": 4321,
  "include": ["*"],
  "exclude": ["src/legacy/**", "*.generated.ts"],
  "output": { "dir": "docs", "file": "impact-map.md" }
}
```

| Option | Values | Default | Description |
|---|---|---|---|
| `lang` | `en`, `fr` | system locale, else `en` | Language of the commands and of the explorer |
| `editor` | `vscode`, `cursor`, `webstorm`, `idea`, `zed`, `none` | `vscode` | Target of the “Open in editor” links |
| `appUrl` | string | `http://localhost:3000` | Running app, for the “Open in app” links |
| `port` | number | `4321` | Explorer port (next free one if taken) |
| `include` | globs | `["*"]` | Files to analyse (`*` = whole project) |
| `exclude` | globs | `[]` | Files to ignore, even when included |
| `output` | `{ dir, file }` | `{ "dir": "docs", "file": "impact-map.md" }` | Location of the AI map written by `generate` |
| `framework` | `next`, `nuxt` | detected | Forces the framework |
| `pageExtensions` | string[] | framework default | Page file extensions (Next.js) |
| `allowedHosts` | string[] | `[]` | Extra host names allowed to reach the explorer (Codespaces, VM) |

- **Globs** (`include` / `exclude`) follow `.gitignore` rules: without a slash a name matches at any depth (`__mocks__`, `*.generated.ts`); with a slash it is anchored at the root (`src/legacy/**`); a folder covers its content. An out-of-scope file is not analysed, not followed and not reported as dead code.
- **Priority:** command-line flags (`--lang`, `--include`, `--exclude`, `--port`, `--out`) override the file for one command.
- **Live reload:** while `impact-analyser ui` runs, saving the config re-runs the analysis (except `port`).

## Framework-specific configuration

<details open>
<summary><strong>Next.js</strong> — 9 to 16, App Router and Pages Router</summary>

```json
{ "appUrl": "http://localhost:3000", "exclude": ["src/**/__mocks__"] }
```

| Option | Default | When to set it |
|---|---|---|
| `pageExtensions` | read from `next.config.*`, else `["tsx", "ts", "jsx", "js"]` | Only if `next.config` computes it: it is read statically from a literal array (`['page.tsx', 'page.ts']` → only `*.page.tsx` files are routes, `layout.page.tsx` included) |
| `appUrl` | `http://localhost:3000` | If `next dev` runs on another port or domain |
| `framework` | `next` | Only if `next` is not declared in the analysed folder’s `package.json` |

Analysed: `app/` and `pages/` at the root or in `src/`; layouts, templates, `error` / `loading` / `not-found` / `forbidden` / `unauthorized` / `global-error`, route groups, parallel routes, route handlers; `_app`, `_document`, `_error`, `pages/api`, Next 12 `_middleware`; `middleware.ts` / `proxy.ts` (applied to every route, its `matcher` is not evaluated); `tsconfig` / `jsconfig` `paths` and `baseUrl`, barrel files, `next/dynamic`, `React.lazy`; function, class and HOC-wrapped components; `"use client"`.

</details>

<details>
<summary><strong>Nuxt</strong> — 2, 3 and 4</summary>

Nuxt writes the resolution of auto-imported components and composables in `.nuxt/`; impact-analyser reads it to use exactly Nuxt’s names. Most Nuxt 3/4 projects already generate it after install:

```json
"scripts": { "postinstall": "nuxt prepare", "analyse:generate": "impact-analyser generate" }
```

```json
{ "appUrl": "http://localhost:3000", "exclude": ["layers/**"] }
```

| Option | Default | When to set it |
|---|---|---|
| `appUrl` | `http://localhost:3000` | If `nuxt dev` runs on another port |
| `framework` | `nuxt` | Only if `nuxt` is not declared in the analysed folder’s `package.json` |

Without `.nuxt/`, names follow Nuxt conventions and a warning is shown: run `nuxi prepare` (Nuxt 3/4) or `nuxt dev` (Nuxt 2). Read from `nuxt.config` (static values): `srcDir`, `buildDir`, `css`, `compatibilityVersion`, and for Nuxt 2 `components`, `plugins`, `router.middleware`.

Analysed: `app/` (Nuxt 4) or the root; `pages/` with `[id]`, `[...slug]`, `(group)`, nested routes, Nuxt 2 `_id`; `app.vue`, error page, layouts (`definePageMeta({ layout })`, `layout: false`, inherited), route middleware, plugins, global CSS; `server/api` and `server/routes`; `.vue` templates and their props (`:prop`, `@event`, `v-model`, kebab-case tags); auto-imported components (`base/Button.vue` → `<BaseButton>`, `Lazy`, `.client`), composables and utils; aliases `~`, `@`, `~~`, `@@`, `#shared`. Not covered yet: layers, `server/utils` auto-imports, `<component :is>`, Pug.

</details>

## Map for AI assistants

`impact-analyser generate` writes `docs/impact-map.md` (folder created if needed, file replaced on each run): summary, high-impact components and modules, routes and their wrappers, one `### <Component>` block per component (file, impacted pages, props and values, every usage as `file:line` + code), shared modules and dead code. Deterministic (no timestamp) and compact, so assistants read one block instead of the whole file.

```bash
npx impact-analyser generate --watch   # regenerate on every save
npx impact-analyser generate --check   # CI / pre-commit: fail if missing or outdated
```

Reference it in your assistant’s instructions (`AGENTS.md`, `CLAUDE.md`, `.cursor/rules`, `.github/copilot-instructions.md`):

> Before changing a component or module, read docs/impact-map.md (components, usages, impacted pages).

## Commands

| Command | Description |
|---|---|
| `ui [dir]` | Visual explorer on 127.0.0.1 (`--open`, `-p <port>`, `--no-watch`) |
| `impact <file…>` | Routes impacted by files (`--format text\|json\|md`, `--types`) |
| `impact --since <ref>` | Routes impacted by a branch (merge-base, uncommitted files included) |
| `generate [dir]` | AI map (`--watch`, `--check`, `--out <path>`) |
| `routes [dir]` | Routes with their wrappers (`--json`) |
| `tree <route>` | Dependency tree of a route (`--depth <n>`) |
| `analyze [dir]` | Full graph as JSON (`-o <file>`) |

Every command accepts `-d <dir>`, `--lang en|fr`, `--include` / `--exclude` and `--help`.

## CI

```yaml
- uses: actions/checkout@v4
  with: { fetch-depth: 0 }
- run: npm ci
- run: npx impact-analyser impact --since origin/${{ github.base_ref }} --format md > impact.md
- run: gh pr comment ${{ github.event.number }} --body-file impact.md
  env: { GH_TOKEN: ${{ github.token }} }
```

## API

```ts
import { analyze, impact, componentImpact, formatImpactMap } from 'impact-analyser';

const graph = analyze('path/to/app');
impact(graph, ['src/components/ui/Card.tsx']).routes;             // [{ route, entry, chain }]
componentImpact(graph, 'src/components/ui/Button.tsx#Button').routes;
formatImpactMap(graph);                                           // Markdown of docs/impact-map.md
```

## Security

- Nothing ships to production: no plugin, middleware or route is added to your app, no install script; installed as a dev dependency, `npm ci --omit=dev` skips it.
- The explorer listens on `127.0.0.1` only, is read-only, makes no external request, rejects requests addressed to other host names (DNS rebinding) and cross-site API calls, and sends a strict Content-Security-Policy. Use `allowedHosts` for forwarded remote environments.
- These rules apply to the impact-analyser server only, never to your app or the APIs it calls.
- Do not publish `analyze` output or the AI map in a public folder: they contain paths and code excerpts.

## License

MIT
