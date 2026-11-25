import type { Lang } from './config.js';

type Plural = { one: string; other: string };
type Message = string | Plural;

const en = {
  'n.route': { one: '{n} route', other: '{n} routes' },
  'n.module': { one: '{n} module', other: '{n} modules' },
  'n.component': { one: '{n} component', other: '{n} components' },
  'n.unusedFile': { one: '{n} unused file', other: '{n} unused files' },
  'n.file': { one: '{n} file', other: '{n} files' },
  'n.changedFile': { one: '{n} changed file', other: '{n} changed files' },
  'n.directImporter': { one: '{n} direct importer', other: '{n} direct importers' },
  'n.dependent': { one: '{n} dependent module', other: '{n} dependent modules' },
  'n.impactedRoute': { one: '{n} impacted route', other: '{n} impacted routes' },

  'tree.noRoute': 'No route "{path}". Run `impact-analyser routes` to list them.',

  'impact.changesSince': 'Changes since {ref}',
  'impact.inProject': '— {files} in this project',
  'impact.globalChanged': '⚠ {file} changed: it can impact the whole app',
  'impact.unusedChanged': '{files} not used by any route: {list}',
  'impact.none': 'No route is impacted.',
  'impact.notInGraph': '⚠ {file} is not used by any route (unused file, or outside the project).',
  'impact.of': 'Impact of',
  'impact.directlyImportedBy': 'Directly imported by',

  'md.globalWarning': '{files} changed: the whole app may be impacted.',
  'md.changedFiles': 'Changed files',
  'md.since': 'since {ref}',
  'md.noneUsed': '_none used by a route_',
  'md.headers': '| Router | Route | Import chain |',
  'md.unusedSummary': '{files} not used by any route',

  'cli.help': `impact-analyser — map a Next.js or Nuxt app and see what a change impacts

Usage
  impact-analyser ui [dir]                  Open the interactive explorer in the browser
  impact-analyser routes [dir]              List the routes (App Router + Pages Router)
  impact-analyser tree <route> [-d dir]     Dependency tree of a route, e.g. /dashboard
  impact-analyser impact <file...> [-d dir] Routes and modules impacted by changed files
  impact-analyser impact --since <ref>      Routes impacted by the changes since a git ref (e.g. main)
  impact-analyser analyze [dir] [-o file]   Full graph as JSON
  impact-analyser generate [dir]            Write the AI-oriented map (docs/impact-map.md)

Options
  -d, --dir <dir>    Next.js project directory (default: .)
  -o, --out <file>   Output file for "analyze" (default: stdout)
      --lang <lang>  Language: en or fr (default: config, then system locale)
      --since <ref>  "impact": use the files changed since this git ref
      --format <f>   "impact": text (default), json or md (Markdown, for PR comments)
      --json         Same as --format json
  -p, --port <n>     "ui": port (default: 4321)
      --open         "ui": open the browser
      --no-watch     "ui": do not re-analyse when files change
      --watch        "generate": regenerate on every save
      --check        "generate": fail if the map is missing or outdated (CI)
      --types        Also follow "import type" edges
      --include <g>  Files to analyse, glob (repeatable; default: config, then "*")
      --exclude <g>  Files to ignore, glob (repeatable; default: config)
      --depth <n>    Max depth for "tree"
  -h, --help         Show this help

Configuration: impact-analyser.config.json (or .mjs / .js, or "impactAnalyser" in package.json)
  { "lang": "fr", "editor": "vscode", "appUrl": "http://localhost:3000",
    "include": ["*"], "exclude": ["src/legacy/**", "*.generated.ts"] }
`,
  'cli.missingRoute': 'Missing route, e.g. `impact-analyser tree /dashboard`',
  'cli.missingFiles': 'Missing file(s) or --since, e.g. `impact-analyser impact src/components/Button.tsx`',
  'cli.unknownFormat': 'Unknown format "{format}" (text, json, md)',
  'cli.unknownCommand': 'Unknown command "{command}". Run `impact-analyser --help`.',
  'cli.graphWritten': 'Graph written to {file} ({routes}, {modules})',
  'cli.analysed': '✓ Analysed in {ms} ms',
  'cli.analysisFailed': '✗ Analysis failed: {error}',
  'cli.uiFor': 'impact-analyser UI for {root}',
  'cli.stop': '(Ctrl+C to stop)',
  'cli.config': 'Config: {file}',
  'cli.mapCreated': '✓ {file} created in {ms} ms ({size})',
  'cli.mapUpdated': '✓ {file} updated in {ms} ms ({size})',
  'cli.mapUnchanged': '✓ {file} already up to date ({ms} ms)',
  'cli.mapSize': '{kb} KB, ~{tokens} tokens',
  'cli.mapUpToDate': '✓ {file} is up to date',
  'cli.mapOutdated': '✗ {file} is missing or outdated: run `impact-analyser generate`',
  'cli.mapWatching': 'Watching for changes (Ctrl+C to stop)',
  'cli.mapHint': 'Tip: tell your AI assistant to read it, e.g. in AGENTS.md / CLAUDE.md / .cursor/rules:\n  "Before changing a component or module, read {file} (components, usages, impacted pages)."',
  'cli.configReloaded': '↻ Config reloaded',
} satisfies Record<string, Message>;

export type MessageKey = keyof typeof en;

const fr: Record<MessageKey, Message> = {
  'n.route': { one: '{n} route', other: '{n} routes' },
  'n.module': { one: '{n} module', other: '{n} modules' },
  'n.component': { one: '{n} composant', other: '{n} composants' },
  'n.unusedFile': { one: '{n} fichier inutilisé', other: '{n} fichiers inutilisés' },
  'n.file': { one: '{n} fichier', other: '{n} fichiers' },
  'n.changedFile': { one: '{n} fichier modifié', other: '{n} fichiers modifiés' },
  'n.directImporter': { one: '{n} importeur direct', other: '{n} importeurs directs' },
  'n.dependent': { one: '{n} module dépendant', other: '{n} modules dépendants' },
  'n.impactedRoute': { one: '{n} route impactée', other: '{n} routes impactées' },

  'tree.noRoute': 'Aucune route "{path}". Lancez `impact-analyser routes` pour les lister.',

  'impact.changesSince': 'Changements depuis {ref}',
  'impact.inProject': '— {files} dans ce projet',
  'impact.globalChanged': '⚠ {file} modifié : peut impacter toute l’application',
  'impact.unusedChanged': '{files} utilisé(s) par aucune route : {list}',
  'impact.none': 'Aucune route n’est impactée.',
  'impact.notInGraph': '⚠ {file} n’est utilisé par aucune route (fichier inutilisé, ou hors du projet).',
  'impact.of': 'Impact de',
  'impact.directlyImportedBy': 'Importé directement par',

  'md.globalWarning': '{files} modifié(s) : toute l’application peut être impactée.',
  'md.changedFiles': 'Fichiers modifiés',
  'md.since': 'depuis {ref}',
  'md.noneUsed': '_aucun n’est utilisé par une route_',
  'md.headers': '| Router | Route | Chaîne d’imports |',
  'md.unusedSummary': '{files} utilisé(s) par aucune route',

  'cli.help': `impact-analyser — cartographie une app Next.js ou Nuxt et montre ce qu’un changement impacte

Utilisation
  impact-analyser ui [dossier]                 Ouvre l’explorateur interactif dans le navigateur
  impact-analyser routes [dossier]             Liste les routes (App Router + Pages Router)
  impact-analyser tree <route> [-d dossier]    Arbre des dépendances d’une route, ex. /dashboard
  impact-analyser impact <fichier...>          Routes et modules impactés par des fichiers modifiés
  impact-analyser impact --since <ref>         Routes impactées par les changements depuis une ref git (ex. main)
  impact-analyser analyze [dossier] [-o fich]  Graphe complet en JSON
  impact-analyser generate [dossier]           Écrit la carte destinée à l’IA (docs/impact-map.md)

Options
  -d, --dir <dossier>  Dossier du projet Next.js (défaut : .)
  -o, --out <fichier>  Fichier de sortie pour "analyze" (défaut : sortie standard)
      --lang <langue>  Langue : en ou fr (défaut : config, puis langue du système)
      --since <ref>    "impact" : utilise les fichiers modifiés depuis cette ref git
      --format <f>     "impact" : text (défaut), json ou md (Markdown, pour les commentaires de PR)
      --json           Équivaut à --format json
  -p, --port <n>       "ui" : port (défaut : 4321)
      --open           "ui" : ouvre le navigateur
      --no-watch       "ui" : ne ré-analyse pas quand un fichier change
      --watch          "generate" : régénère à chaque sauvegarde
      --check          "generate" : échoue si la carte est absente ou obsolète (CI)
      --types          Suit aussi les "import type"
      --include <g>    Fichiers à analyser, glob (répétable ; défaut : config, puis "*")
      --exclude <g>    Fichiers à ignorer, glob (répétable ; défaut : config)
      --depth <n>      Profondeur max pour "tree"
  -h, --help           Affiche cette aide

Configuration : impact-analyser.config.json (ou .mjs / .js, ou "impactAnalyser" dans package.json)
  { "lang": "fr", "editor": "vscode", "appUrl": "http://localhost:3000",
    "include": ["*"], "exclude": ["src/legacy/**", "*.generated.ts"] }
`,
  'cli.missingRoute': 'Route manquante, ex. `impact-analyser tree /dashboard`',
  'cli.missingFiles': 'Fichier(s) ou --since manquant(s), ex. `impact-analyser impact src/components/Button.tsx`',
  'cli.unknownFormat': 'Format inconnu "{format}" (text, json, md)',
  'cli.unknownCommand': 'Commande inconnue "{command}". Lancez `impact-analyser --help`.',
  'cli.graphWritten': 'Graphe écrit dans {file} ({routes}, {modules})',
  'cli.analysed': '✓ Analysé en {ms} ms',
  'cli.analysisFailed': '✗ Échec de l’analyse : {error}',
  'cli.uiFor': 'Interface impact-analyser pour {root}',
  'cli.stop': '(Ctrl+C pour arrêter)',
  'cli.config': 'Configuration : {file}',
  'cli.mapCreated': '✓ {file} créé en {ms} ms ({size})',
  'cli.mapUpdated': '✓ {file} mis à jour en {ms} ms ({size})',
  'cli.mapUnchanged': '✓ {file} déjà à jour ({ms} ms)',
  'cli.mapSize': '{kb} Ko, ~{tokens} tokens',
  'cli.mapUpToDate': '✓ {file} est à jour',
  'cli.mapOutdated': '✗ {file} est absent ou obsolète : lancez `impact-analyser generate`',
  'cli.mapWatching': 'Surveillance des modifications (Ctrl+C pour arrêter)',
  'cli.mapHint': 'Astuce : indiquez à votre assistant IA de le lire, par ex. dans AGENTS.md / CLAUDE.md / .cursor/rules :\n  "Before changing a component or module, read {file} (components, usages, impacted pages)."',
  'cli.configReloaded': '↻ Configuration rechargée',
};

const MESSAGES: Record<Lang, Record<MessageKey, Message>> = { en, fr };

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** `t('n.route', { n: 3 })` -> "3 routes" ; French uses the singular for 0 and 1. */
export function createTranslator(lang: Lang = 'en'): Translate {
  const messages = MESSAGES[lang];
  return (key, vars = {}) => {
    const message = messages[key] ?? en[key];
    let text: string;
    if (typeof message === 'string') {
      text = message;
    } else {
      const n = Number(vars.n ?? 0);
      const singular = lang === 'fr' ? Math.abs(n) < 2 : n === 1;
      text = singular ? message.one : message.other;
    }
    return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
  };
}
