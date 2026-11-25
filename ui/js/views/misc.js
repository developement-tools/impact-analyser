// Overview, file page, dead code, glossary.
import {
  basename,
  categoryLabel,
  clientBadge,
  componentTag,
  coverage,
  editorLink,
  emptyRow,
  fetchJson,
  filePath,
  folderOf,
  h,
  helpIcon,
  isLayoutRole,
  isNuxt,
  roleOf,
  kpi,
  loadComponentRanking,
  loadModuleRanking,
  moduleHref,
  pageKey,
  panel,
  PATHS,
  renderedRoutes,
  riskBadge,
  roleLabel,
  routeHref,
  routeLabel,
  routerLabel,
  state,
  tx,
  uniquePages,
  universalRendering,
} from '../core.js';
import { GLOSSARY, getLang, t } from '../i18n.js';
import { chainView } from './components.js';

const loadingRow = (colspan) => emptyRow(colspan, t('common.loading'));
const table = (head, tbody) => h('table', { class: 'table' }, h('thead', null, h('tr', null, head.map((c) => (typeof c === 'string' ? h('th', null, c) : c)))), tbody);
const num = (text) => h('th', { class: 'num' }, text);

// ------------------------------------------------------------------ overview

export function renderHome() {
  const g = state.graph;
  const comps = Object.values(g.components);
  const client = comps.filter((c) => c.client).length;
  const neverRendered = comps.filter((c) => c.usages.length === 0).length;
  const byRouter = (router) => uniquePages(g.routes.filter((r) => r.router === router)).length;
  const api = g.routes.filter((r) => r.kind === 'api').length;
  const packages = new Set(Object.values(g.modules).flatMap((m) => m.externals));

  // Top components
  const compBody = h('tbody', null, loadingRow(3));
  loadComponentRanking().then((ranking) => {
    const top = ranking.filter((r) => r.pages > 0).slice(0, 10);
    compBody.replaceChildren(
      ...(top.length
        ? top.map((r) => {
            const c = g.components[r.id];
            return h(
              'tr',
              null,
              h('td', null, h('div', { class: 'cell-main' }, componentTag(c), c.client && clientBadge(true)), h('div', { class: 'cell-sub' }, folderOf(c.module))),
              h('td', { class: 'num' }, r.usages),
              h('td', { class: 'num' }, coverage(r.pages)),
            );
          })
        : [emptyRow(3, t('common.none'))]),
    );
  });

  // Shared modules that are not components: hooks, utilities, styles.
  const modBody = h('tbody', null, loadingRow(4));
  loadModuleRanking().then((ranking) => {
    const top = ranking.filter((r) => r.pages > 0 && ['hook', 'util', 'style', 'asset'].includes(g.modules[r.id]?.category)).slice(0, 8);
    modBody.replaceChildren(
      ...(top.length
        ? top.map((r) =>
            h(
              'tr',
              null,
              h('td', null, filePath(r.id)),
              h('td', null, h('span', { class: 'chip' }, categoryLabel(g.modules[r.id].category))),
              h('td', { class: 'num' }, r.importers),
              h('td', { class: 'num' }, coverage(r.pages)),
            ),
          )
        : [emptyRow(4, t('common.none'))]),
    );
  });

  return h(
    'div',
    null,
    h('div', { class: 'page-head' }, h('h1', null, t('home.title')), h('p', { class: 'sub mono' }, g.root), scopeLine(g)),
    g.nuxt && !g.nuxt.generated && h('div', { class: 'note warn' }, t('nuxt.notGenerated')),
    g.nuxt?.remoteLayers?.length > 0 && h('div', { class: 'note warn' }, t('nuxt.remoteLayers', { layers: g.nuxt.remoteLayers.join(', ') })),
    h(
      'div',
      { class: 'kpis' },
      kpi(t('kpi.pages'), renderedRoutes(), {
        href: PATHS.routes,
        // Next.js: pages per router; Nuxt has a single router (its version is in the sidebar).
        sub: (isNuxt() ? [] : ['app', 'pages'].map((r) => byRouter(r) && `${routerLabel(r)} ${byRouter(r)}`)).concat(api ? [`API ${api}`] : []).filter(Boolean).join(' · '),
      }),
      kpi(t('kpi.components'), comps.length, { href: PATHS.components, sub: t(universalRendering() ? 'kpi.components.sub.universal' : 'kpi.components.sub', { client, server: comps.length - client }), help: 'client' }),
      kpi(t('kpi.modules'), Object.keys(g.modules).length, { sub: t('kpi.modules.sub', { n: packages.size }) }),
      kpi(t('kpi.dead'), g.unreachable.length + neverRendered, {
        href: PATHS.deadCode,
        tone: g.unreachable.length + neverRendered ? 'warn' : '',
        sub: t('kpi.dead.sub', { files: t('n.file', { n: g.unreachable.length }), components: t('n.component', { n: neverRendered }) }),
        help: 'dead-code',
      }),
    ),
    h(
      'div',
      { class: 'grid-2' },
      panel(
        { title: t('home.top.title'), help: 'impact', actions: h('a', { class: 'link-more', href: PATHS.components }, t('common.viewAll'), ' →'), flush: true },
        table([t('col.component'), num(t('col.usages')), num(t('col.pages'))], compBody),
      ),
      panel({ title: t('home.layouts.title'), help: 'layout', flush: true }, layoutsTable()),
    ),
    panel(
      { title: t('home.modules.title'), help: 'hook', flush: true },
      h('p', { class: 'panel-note' }, t('home.modules.text')),
      table([t('col.module'), t('col.type'), num(t('col.importers')), num(t('col.pages'))], modBody),
    ),
  );
}

/** Analysis scope: include / exclude patterns and files left out. */
function scopeLine(g) {
  if (!g.scope) return null;
  const patterns = (list) => list.map((p) => h('code', { class: 'chip mono' }, p));
  const excluded = g.excluded ?? [];
  return h(
    'p',
    { class: 'sub scope' },
    h('span', { class: 'scope-label' }, t('scope.label'), ' ', helpIcon('scope')),
    h('span', null, 'include'),
    patterns(g.scope.include),
    g.scope.exclude.length > 0 && [h('span', null, 'exclude'), patterns(g.scope.exclude)],
    excluded.length > 0 &&
      h('span', { class: 'muted', title: excluded.join('\n') }, t('scope.excluded', { n: excluded.length })),
  );
}

/** Layouts (and _app) with the number of pages they wrap. */
function layoutsTable() {
  const g = state.graph;
  const pagesBy = new Map();
  for (const r of uniquePages(g.routes)) {
    for (const w of r.wrappers) {
      if (!isLayoutRole(w)) continue;
      if (!pagesBy.has(w)) pagesBy.set(w, new Set());
      pagesBy.get(w).add(pageKey(r));
    }
  }
  const rows = [...pagesBy.entries()].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]));
  return table(
    [t('col.layout'), num(t('col.pages'))],
    h(
      'tbody',
      null,
      rows.length
        ? rows.map(([file, pages]) =>
            h(
              'tr',
              null,
              h('td', null, h('a', { class: 'strong-link', href: moduleHref(file) }, roleOf(file) === '_app' ? '_app' : roleLabel(file)), h('div', { class: 'cell-sub' }, file.replace(/^src\//, ''))),
              h('td', { class: 'num' }, coverage(pages.size)),
            ),
          )
        : emptyRow(2, t('common.none')),
    ),
  );
}

// ------------------------------------------------------------------ file

export function renderFile(id) {
  const g = state.graph;
  const mod = g.modules[id];
  const head = h(
    'div',
    { class: 'page-head' },
    h('nav', { class: 'breadcrumb' }, h('a', { href: PATHS.components }, t('nav.components')), h('span', { class: 'sep' }, '/'), folderOf(id) || '.'),
    h('div', { class: 'title-row' }, h('h1', { class: 'mono-title' }, basename(id)), h('div', { class: 'title-actions' }, editorLink(id, 1))),
    h('p', { class: 'sub' }, mod && h('span', { class: 'chip' }, categoryLabel(mod.category)), mod?.kind === 'source' && clientBadge(mod.client), h('span', { class: 'mono muted' }, id)),
  );
  if (!mod) {
    return h('div', null, head, panel({}, h('p', null, g.unreachable.includes(id) ? t('file.unused') : t('file.outside'))));
  }

  const roles = state.roles.get(id) ?? [];
  const comps = state.componentsByModule.get(id) ?? [];
  const importers = g.importedBy[id] ?? [];
  const kpis = h('div', { class: 'kpis' }, kpi(t('kpi.impacted'), '…', { help: 'impact' }), kpi(t('col.importers'), importers.length), kpi(t('file.uses'), mod.imports.length), kpi(t('file.exports'), mod.exports.length));
  const impactBody = h('tbody', null, loadingRow(2));

  if (mod.category !== 'barrel') {
    fetchJson(`/api/impact?file=${encodeURIComponent(id)}`)
      .then((result) => {
        const pages = uniquePages(result.routes, (r) => r.route);
        kpis.firstChild.replaceWith(kpi(t('kpi.impacted'), coverage(pages.length), { help: 'impact', sub: riskBadge(pages.length) }));
        impactBody.replaceChildren(
          ...(pages.length
            ? pages.map(({ route, chain }) => h('tr', null, h('td', null, h('a', { class: 'route-link', href: routeHref(route) }, routeLabel(route))), h('td', null, chainView(chain))))
            : [emptyRow(2, t('risk.none'))]),
        );
      })
      .catch((error) => impactBody.replaceChildren(h('tr', null, h('td', { colspan: 2 }, h('div', { class: 'error-box' }, error.message)))));
  } else {
    kpis.firstChild.remove();
  }

  const fileList = (ids) =>
    ids.length
      ? h('ul', { class: 'list' }, ids.map((i) => h('li', null, filePath(i), h('span', { class: 'spacer' }), h('span', { class: 'chip' }, categoryLabel(g.modules[i]?.category)))))
      : h('p', { class: 'empty' }, t('common.none'));

  return h(
    'div',
    null,
    head,
    kpis,
    mod.category === 'barrel' && h('div', { class: 'note' }, t('file.barrel'), ' ', helpIcon('barrel')),
    roles.length > 0 &&
      panel(
        { title: t('file.route') },
        h('div', { class: 'chips' }, [...new Map(roles.map((r) => [r.route, r])).values()].map(({ route }) => h('a', { class: 'chip route-chip', href: routeHref(route) }, routeLabel(route)))),
      ),
    comps.length > 0 && panel({ title: t('file.components'), count: comps.length }, h('div', { class: 'chips' }, comps.map((c) => componentTag(c)))),
    mod.category !== 'barrel' && panel({ title: t('kpi.impacted'), help: 'impact', flush: true }, table([t('col.page'), t('col.chain')], impactBody)),
    h(
      'div',
      { class: 'grid-2' },
      panel({ title: t('col.importers'), count: importers.length }, fileList(importers)),
      panel({ title: t('file.uses'), count: mod.imports.length }, fileList(mod.imports.map((e) => e.to))),
    ),
    mod.exports.length > 0 && panel({ title: t('file.exports'), count: mod.exports.length }, h('div', { class: 'chips' }, mod.exports.map((e) => h('span', { class: 'chip mono' }, e)))),
  );
}

// ------------------------------------------------------------------ dead code

export function renderUnused() {
  const g = state.graph;
  const neverRendered = Object.values(g.components).filter((c) => c.usages.length === 0);
  return h(
    'div',
    null,
    h('div', { class: 'page-head' }, h('h1', null, t('unused.title')), h('p', { class: 'lead' }, t('unused.subtitle'))),
    panel(
      { title: t('unused.components'), count: neverRendered.length, flush: true },
      h('p', { class: 'panel-note' }, t('unused.components.text')),
      table(
        [t('col.component'), t('col.file'), h('th', { class: 'actions' })],
        h(
          'tbody',
          null,
          neverRendered.length
            ? neverRendered.map((c) => h('tr', null, h('td', null, componentTag(c)), h('td', null, filePath(c.module)), h('td', { class: 'actions' }, editorLink(c.module, 1, { label: '' }))))
            : emptyRow(3, t('unused.allGood')),
        ),
      ),
    ),
    panel(
      { title: t('unused.files'), count: g.unreachable.length, flush: true },
      h('p', { class: 'panel-note' }, t('unused.files.text')),
      table(
        [t('col.file'), h('th', { class: 'actions' })],
        h(
          'tbody',
          null,
          g.unreachable.length
            ? g.unreachable.map((id) => h('tr', null, h('td', null, filePath(id)), h('td', { class: 'actions' }, editorLink(id, 1, { label: '' }))))
            : emptyRow(2, t('unused.allGood')),
        ),
      ),
    ),
    g.unresolved.length > 0 &&
      panel(
        { title: t('unused.unresolved'), count: g.unresolved.length, flush: true },
        table([t('col.file'), t('col.specifier')], h('tbody', null, g.unresolved.map((u) => h('tr', null, h('td', null, filePath(u.from)), h('td', null, h('code', null, u.specifier)))))),
      ),
  );
}

// ------------------------------------------------------------------ glossary

export function renderHelp(term) {
  // Entries tagged with a framework only show for that framework.
  const framework = state.graph.framework?.name ?? 'next';
  const entries = GLOSSARY[getLang()].filter((e) => !e[3] || e[3] === framework);
  const metrics = ['pages', 'risk', 'usages', 'variants', 'scope'];
  const view = h(
    'div',
    null,
    h('div', { class: 'page-head' }, h('h1', null, t('help.title')), h('p', { class: 'lead' }, t('help.subtitle'))),
    panel(
      { title: t('help.metrics') },
      h('dl', { class: 'glossary' }, metrics.map((m) => [h('dt', null, t(`help.metric.${m}`)), h('dd', null, tx(`help.metric.${m}.text`, {}))])),
    ),
    panel(
      { title: t('help.glossary') },
      h(
        'dl',
        { class: 'glossary' },
        entries.map(([id, title, text]) => [h('dt', { id: `term-${id}`, class: id === term ? 'highlight' : '' }, title), h('dd', { class: id === term ? 'highlight' : '' }, text)]),
      ),
    ),
  );
  if (term) requestAnimationFrame(() => document.getElementById(`term-${term}`)?.scrollIntoView({ block: 'center' }));
  return view;
}
