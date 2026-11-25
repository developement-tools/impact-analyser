# impact-analyser

[English](README.md) · **Français** · [Documentation complète](docs/index.html?lang=fr)

Cartographie les routes et les composants d’une app **Next.js** ou **Nuxt** : où chaque composant est utilisé, avec quelles variantes, et quelles pages une modification peut affecter — avant de la faire.

- **Next.js 9 → 16** (App Router et Pages Router) · **Nuxt 2, 3, 4** · Node.js ≥ 20
- Analyse statique : lit le code source, n’exécute jamais l’app, ne lui ajoute rien
- Explorateur visuel, impact d’un fichier ou d’une branche, résumés de pull request, **carte pour assistants IA**, code mort

## Installation

Installez-le en **dépendance de développement** de l’app (c’est un outil de développement, rien ne part en production) :

```bash
npm install --save-dev impact-analyser
# pnpm add -D impact-analyser · yarn add -D impact-analyser · bun add -d impact-analyser
```

```json
// package.json de l’app
"scripts": {
  "analyse:ui": "impact-analyser ui --open",
  "analyse:generate": "impact-analyser generate",
  "analyse:impact": "impact-analyser impact --since main"
}
```

Le framework, sa version et les dossiers sources sont détectés depuis le `package.json`. Aucune configuration n’est nécessaire.

## Prise en main

```bash
npx impact-analyser ui --open                          # explorateur visuel : http://127.0.0.1:4321
npx impact-analyser impact src/components/ui/Button.tsx # pages impactées par un fichier
npx impact-analyser impact --since main                 # pages impactées par la branche en cours
npx impact-analyser generate                            # docs/impact-map.md pour les assistants IA
npx impact-analyser routes                              # toutes les routes avec leurs layouts
```

## Configuration globale

Facultative, commune à toutes les commandes et à l’explorateur. Premier fichier trouvé à la racine de l’app : `impact-analyser.config.json`, `impact-analyser.config.mjs` / `.js` (export par défaut, `defineConfig` pour les types), ou la clé `"impactAnalyser"` du `package.json`.

```json
{
  "lang": "fr",
  "editor": "vscode",
  "appUrl": "http://localhost:3000",
  "port": 4321,
  "include": ["*"],
  "exclude": ["src/legacy/**", "*.generated.ts"],
  "output": { "dir": "docs", "file": "impact-map.md" }
}
```

| Option | Valeurs | Défaut | Description |
|---|---|---|---|
| `lang` | `en`, `fr` | langue du système, sinon `en` | Langue des commandes et de l’explorateur |
| `editor` | `vscode`, `cursor`, `webstorm`, `idea`, `zed`, `none` | `vscode` | Cible des liens « Ouvrir dans l’éditeur » |
| `appUrl` | chaîne | `http://localhost:3000` | App lancée, pour les liens « Ouvrir dans l’app » |
| `port` | nombre | `4321` | Port de l’explorateur (le suivant libre s’il est pris) |
| `include` | globs | `["*"]` | Fichiers à analyser (`*` = tout le projet) |
| `exclude` | globs | `[]` | Fichiers à ignorer, même s’ils sont inclus |
| `output` | `{ dir, file }` | `{ "dir": "docs", "file": "impact-map.md" }` | Emplacement de la carte IA écrite par `generate` |
| `framework` | `next`, `nuxt` | détecté | Force le framework |
| `pageExtensions` | string[] | défaut du framework | Extensions des fichiers de pages (Next.js) |
| `allowedHosts` | string[] | `[]` | Noms d’hôte supplémentaires autorisés à joindre l’explorateur (Codespaces, VM) |

- **Globs** (`include` / `exclude`) : règles proches de `.gitignore`. Sans `/`, un nom correspond à n’importe quelle profondeur (`__mocks__`, `*.generated.ts`) ; avec `/`, le motif part de la racine (`src/legacy/**`) ; un dossier couvre son contenu. Un fichier hors périmètre n’est ni analysé, ni suivi, ni signalé comme code mort.
- **Priorité :** les options de ligne de commande (`--lang`, `--include`, `--exclude`, `--port`, `--out`) remplacent le fichier pour une commande.
- **Rechargement à chaud :** pendant que `impact-analyser ui` tourne, sauvegarder la config relance l’analyse (sauf `port`).

## Configuration par framework

<details open>
<summary><strong>Next.js</strong> — 9 à 16, App Router et Pages Router</summary>

```json
{ "appUrl": "http://localhost:3000", "exclude": ["src/**/__mocks__"] }
```

| Option | Défaut | Quand la définir |
|---|---|---|
| `pageExtensions` | lu dans `next.config.*`, sinon `["tsx", "ts", "jsx", "js"]` | Seulement si `next.config` la calcule : elle est lue statiquement depuis un tableau littéral (`['page.tsx', 'page.ts']` → seuls les fichiers `*.page.tsx` sont des routes, `layout.page.tsx` compris) |
| `appUrl` | `http://localhost:3000` | Si `next dev` tourne sur un autre port ou domaine |
| `framework` | `next` | Seulement si `next` n’est pas déclaré dans le `package.json` du dossier analysé |

Analysé : `app/` et `pages/` à la racine ou dans `src/` ; layouts, templates, `error` / `loading` / `not-found` / `forbidden` / `unauthorized` / `global-error`, groupes de routes, routes parallèles, handlers ; `_app`, `_document`, `_error`, `pages/api`, `_middleware` de Next 12 ; `middleware.ts` / `proxy.ts` (appliqué à toutes les routes, son `matcher` n’est pas évalué) ; `paths` et `baseUrl` du `tsconfig` / `jsconfig`, fichiers barrel, `next/dynamic`, `React.lazy` ; composants en fonction, en classe ou enveloppés dans un HOC ; `"use client"`.

</details>

<details>
<summary><strong>Nuxt</strong> — 2, 3 et 4</summary>

Nuxt écrit la résolution des composants et composables auto-importés dans `.nuxt/` ; impact-analyser la lit pour utiliser exactement les noms de Nuxt. La plupart des projets Nuxt 3/4 la génèrent déjà après l’installation :

```json
"scripts": { "postinstall": "nuxt prepare", "analyse:generate": "impact-analyser generate" }
```

```json
{ "appUrl": "http://localhost:3000", "exclude": ["layers/**"] }
```

| Option | Défaut | Quand la définir |
|---|---|---|
| `appUrl` | `http://localhost:3000` | Si `nuxt dev` tourne sur un autre port |
| `framework` | `nuxt` | Seulement si `nuxt` n’est pas déclaré dans le `package.json` du dossier analysé |

Sans `.nuxt/`, les noms suivent les conventions de Nuxt et un avertissement s’affiche : lancez `nuxi prepare` (Nuxt 3/4) ou `nuxt dev` (Nuxt 2). Lus dans `nuxt.config` (valeurs statiques) : `srcDir`, `buildDir`, `css`, `compatibilityVersion`, et pour Nuxt 2 `components`, `plugins`, `router.middleware`.

Analysé : `app/` (Nuxt 4) ou la racine ; `pages/` avec `[id]`, `[...slug]`, `(groupe)`, routes imbriquées, `_id` de Nuxt 2 ; `app.vue`, page d’erreur, layouts (`definePageMeta({ layout })`, `layout: false`, hérité), middleware de route, plugins, CSS globales ; `server/api` et `server/routes` ; templates `.vue` et leurs props (`:prop`, `@event`, `v-model`, balises en kebab-case) ; composants auto-importés (`base/Button.vue` → `<BaseButton>`, `Lazy`, `.client`), composables et utils ; alias `~`, `@`, `~~`, `@@`, `#shared`. Pas encore couverts : layers, auto-imports de `server/utils`, `<component :is>`, Pug.

</details>

## Carte pour assistants IA

`impact-analyser generate` écrit `docs/impact-map.md` (dossier créé si besoin, fichier remplacé à chaque exécution) : résumé, composants et modules à fort impact, routes et leurs enveloppes, un bloc `### <Composant>` par composant (fichier, pages impactées, props et valeurs, chaque utilisation en `fichier:ligne` + code), modules partagés et code mort. Déterministe (sans horodatage) et compacte : les assistants lisent un bloc au lieu du fichier entier. La carte est écrite en anglais, langue de travail habituelle des assistants.

```bash
npx impact-analyser generate --watch   # régénère à chaque sauvegarde
npx impact-analyser generate --check   # CI / pre-commit : échoue si absente ou obsolète
```

Référencez-la dans les instructions de votre assistant (`AGENTS.md`, `CLAUDE.md`, `.cursor/rules`, `.github/copilot-instructions.md`) :

> Before changing a component or module, read docs/impact-map.md (components, usages, impacted pages).

## Commandes

| Commande | Description |
|---|---|
| `ui [dossier]` | Explorateur visuel sur 127.0.0.1 (`--open`, `-p <port>`, `--no-watch`) |
| `impact <fichier…>` | Routes impactées par des fichiers (`--format text\|json\|md`, `--types`) |
| `impact --since <ref>` | Routes impactées par une branche (merge-base, fichiers non commités inclus) |
| `generate [dossier]` | Carte IA (`--watch`, `--check`, `--out <chemin>`) |
| `routes [dossier]` | Routes avec leurs enveloppes (`--json`) |
| `tree <route>` | Arbre des dépendances d’une route (`--depth <n>`) |
| `analyze [dossier]` | Graphe complet en JSON (`-o <fichier>`) |

Toutes les commandes acceptent `-d <dossier>`, `--lang en|fr`, `--include` / `--exclude` et `--help`.

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

const graph = analyze('chemin/vers/app');
impact(graph, ['src/components/ui/Card.tsx']).routes;             // [{ route, entry, chain }]
componentImpact(graph, 'src/components/ui/Button.tsx#Button').routes;
formatImpactMap(graph);                                           // Markdown de docs/impact-map.md
```

## Sécurité

- Rien ne part en production : aucun plugin, middleware ou route n’est ajouté à l’app, aucun script d’installation ; installé en dépendance de développement, `npm ci --omit=dev` ne l’installe pas.
- L’explorateur n’écoute que sur `127.0.0.1`, est en lecture seule, ne fait aucun appel externe, refuse les requêtes adressées à d’autres noms d’hôte (rebinding DNS) et les appels d’API venant d’autres sites, et envoie une Content-Security-Policy stricte. Utilisez `allowedHosts` pour un environnement distant redirigé.
- Ces règles ne concernent que le serveur d’impact-analyser, jamais l’app ni les API qu’elle appelle.
- Ne publiez pas la sortie d’`analyze` ni la carte IA dans un dossier public : elles contiennent des chemins et des extraits de code.

## Licence

MIT
