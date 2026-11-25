// Component catalog and component page.
import {
  categoryLabel,
  clientBadge,
  componentHref,
  componentTag,
  coverage,
  editorLink,
  emptyRow,
  fetchJson,
  filePath,
  folderOf,
  h,
  helpIcon,
  isBarrel,
  isNuxt,
  jsxSnippet,
  kpi,
  loadComponentRanking,
  moduleHref,
  moduleLabel,
  navigate,
  panel,
  PATHS,
  rankOf,
  riskBadge,
  roleLabel,
  routeHref,
  routeLabel,
  routerLabel,
  savePrefs,
  state,
  tx,
  uniquePages,
  universalRendering,
} from '../core.js';
import { renderDiagram } from '../diagram.js';
import { t } from '../i18n.js';

const IGNORED_PROPS = new Set(['children', 'key', 'ref']);
/** Technical attributes: never a variant of the component (still listed in "Other props"). */
const NOT_VARIANT = /^(?:className|class|style|id|role|tabIndex|title|name|href|src|alt|htmlFor|for|placeholder|value|defaultValue|target|rel|aria[A-Z-].*|data[A-Z-].*)$/;
const UNSET = '__unset';
const DYNAMIC = '__dynamic';

/** Variant filter in the URL: `value=danger`, or `state=unset` / `state=dynamic`. */
const filterParam = (key) => (key === UNSET ? { state: 'unset' } : key === DYNAMIC ? { state: 'dynamic' } : { value: key.slice(key.indexOf(':') + 1) });
function filterFromParams(params) {
  const prop = params.get('prop');
  if (!prop) return null;
  const state = params.get('state');
  return { prop, value: state === 'unset' ? UNSET : state === 'dynamic' ? DYNAMIC : (params.get('value') ?? '') };
}

/** `primary`, `sm`, `outline-dark`, `true`: values that select a style, unlike texts such as "Checkout". */
const isTokenLike = (v) => v.type === 'boolean' || (v.type === 'string' && /^[a-z][a-z0-9-]{0,24}$/.test(v.value));

/**
 * Props of a component and the values passed to them across all usages.
 * A prop is a "variant" when it takes at least two different values (unset counts as one)
 * and its values are reused or look like tokens: `variant="primary"`, not `title="Checkout"`.
 */
export function propStats(component) {
  const stats = new Map();
  for (const usage of component.usages) {
    for (const prop of usage.props) {
      if (prop.kind === 'spread' || IGNORED_PROPS.has(prop.name)) continue;
      if (!stats.has(prop.name)) stats.set(prop.name, { name: prop.name, values: new Map(), dynamic: [], set: 0 });
      const s = stats.get(prop.name);
      s.set++;
      if (prop.kind === 'literal') {
        const key = `${prop.type}:${prop.value}`;
        const entry = s.values.get(key) ?? { value: prop.value, type: prop.type, count: 0 };
        entry.count++;
        s.values.set(key, entry);
      } else {
        s.dynamic.push(prop.value);
      }
    }
  }
  const total = component.usages.length;
  return [...stats.values()]
    .map((s) => {
      const unset = total - s.set;
      const distinct = s.values.size + (unset > 0 ? 1 : 0) + (s.dynamic.length > 0 ? 1 : 0);
      const isEvent = /^on[A-Z]/.test(s.name);
      const literals = [...s.values.values()];
      const reused = literals.some((v) => v.count > 1);
      const tokens = literals.every(isTokenLike);
      return { ...s, unset, isVariant: !isEvent && !NOT_VARIANT.test(s.name) && literals.length > 0 && distinct >= 2 && (reused || tokens) };
    })
    .sort((a, b) => Number(b.isVariant) - Number(a.isVariant) || b.set - a.set || a.name.localeCompare(b.name));
}

const literalText = (v) => (v.type === 'string' ? `"${v.value}"` : v.value);

// ------------------------------------------------------------------ catalog

const SORTS = {
  name: (a, b) => a.c.name.localeCompare(b.c.name),
  usages: (a, b) => a.c.usages.length - b.c.usages.length,
  files: (a, b) => a.files - b.files,
  pages: (a, b) => (a.rank?.pages ?? -1) - (b.rank?.pages ?? -1),
  variants: (a, b) => a.variants.length - b.variants.length,
};

export function renderComponentList() {
  const g = state.graph;
  const all = Object.values(g.components).map((c) => ({
    c,
    files: new Set(c.usages.map((u) => u.module)).size,
    variants: propStats(c).filter((p) => p.isVariant),
    rank: null,
  }));
  const folders = [...new Set(all.map(({ c }) => folderOf(c.module)))].sort();
  const local = { query: '', folder: '' };
  if (!SORTS[state.prefs.sort]) state.prefs.sort = 'pages';

  const tbody = h('tbody');
  const thead = h('thead');
  const count = h('span', { class: 'result-count' });
  const COLS = 6;

  const header = () => {
    const th = (key, label, cls = '', help) =>
      h(
        'th',
        { class: `${cls} sortable ${state.prefs.sort === key ? 'sorted' : ''}`, 'aria-sort': state.prefs.sort === key ? (state.prefs.sortDir > 0 ? 'ascending' : 'descending') : 'none' },
        h(
          'button',
          {
            onclick: () => {
              if (state.prefs.sort === key) state.prefs.sortDir *= -1;
              else {
                state.prefs.sort = key;
                state.prefs.sortDir = key === 'name' ? 1 : -1;
              }
              savePrefs();
              draw();
            },
          },
          label,
          h('span', { class: 'sort-ind' }, state.prefs.sort === key ? (state.prefs.sortDir > 0 ? '↑' : '↓') : ''),
        ),
        help && helpIcon(help),
      );
    thead.replaceChildren(
      h(
        'tr',
        null,
        th('name', t('col.component')),
        h('th', null, t('col.rendering'), ' ', helpIcon('client')),
        th('usages', t('col.usages'), 'num'),
        th('files', t('col.files'), 'num'),
        th('pages', t('col.pages'), 'num', 'impact'),
        th('variants', t('col.variants'), '', 'variant'),
      ),
    );
  };

  const draw = () => {
    header();
    const q = local.query.trim().toLowerCase();
    const show = state.prefs.show;
    const rows = all.filter(({ c }) => {
      if (local.folder && folderOf(c.module) !== local.folder) return false;
      if (show === 'client' && !c.client) return false;
      if (show === 'server' && c.client) return false;
      if (show === 'unused' && c.usages.length > 0) return false;
      return !q || c.name.toLowerCase().includes(q) || c.module.toLowerCase().includes(q);
    });
    for (const row of rows) row.rank = rankOf(row.c.id);
    const cmp = SORTS[state.prefs.sort];
    rows.sort((a, b) => cmp(a, b) * state.prefs.sortDir || a.c.name.localeCompare(b.c.name));
    count.textContent = t('n.component', { n: rows.length });

    tbody.replaceChildren(
      ...(rows.length === 0
        ? [emptyRow(COLS, t('components.empty'))]
        : rows.map(({ c, files, variants, rank }) =>
            h(
              'tr',
              { class: 'clickable', onclick: (e) => e.target.closest('a') || navigate(componentHref(c.id)) },
              h('td', null, componentTag(c), h('div', { class: 'cell-sub' }, folderOf(c.module))),
              h('td', null, clientBadge(c.client)),
              h('td', { class: 'num' }, c.usages.length || h('span', { class: 'muted' }, '0')),
              h('td', { class: 'num' }, files || h('span', { class: 'muted' }, '0')),
              h('td', { class: 'num' }, rank ? coverage(rank.pages) : '…'),
              h('td', null, variants.length ? h('div', { class: 'chips' }, variants.map((v) => h('span', { class: 'chip mono' }, v.name))) : h('span', { class: 'muted' }, '—')),
            ),
          )),
    );
  };

  const segmented = h(
    'div',
    { class: 'segmented', role: 'group' },
    ['all', 'client', 'server', 'unused'].map((key) =>
      h(
        'button',
        {
          class: state.prefs.show === key ? 'active' : '',
          onclick: (e) => {
            state.prefs.show = key;
            savePrefs();
            for (const b of segmented.children) b.classList.toggle('active', b === e.currentTarget);
            draw();
          },
        },
        t(universalRendering() && key === 'server' ? 'components.show.server.universal' : `components.show.${key}`),
      ),
    ),
  );

  const view = h(
    'div',
    null,
    h('div', { class: 'page-head' }, h('h1', null, t('components.title')), h('p', { class: 'lead' }, t('components.subtitle'))),
    h(
      'div',
      { class: 'filters' },
      h('input', {
        type: 'search',
        class: 'input grow',
        placeholder: t('components.filter'),
        oninput: (e) => {
          local.query = e.target.value;
          draw();
        },
      }),
      h(
        'select',
        {
          class: 'input',
          'aria-label': t('components.folder'),
          onchange: (e) => {
            local.folder = e.target.value;
            draw();
          },
        },
        h('option', { value: '' }, t('components.folder.all')),
        folders.map((f) => h('option', { value: f }, f)),
      ),
      segmented,
      count,
    ),
    h('div', { class: 'panel' }, h('div', { class: 'panel-body flush' }, h('table', { class: 'table' }, thead, tbody))),
  );
  draw();
  loadComponentRanking().then(draw);
  return view;
}

// ------------------------------------------------------------------ component page

export function renderComponent(id, params) {
  const g = state.graph;
  const component = g.components[id];
  if (!component) {
    return h('div', null, h('h1', null, t('common.notFound')), h('p', { class: 'muted' }, t('common.notFoundText')));
  }
  const tab = params.get('tab') ?? 'usages';
  const filter = filterFromParams(params);
  const variants = propStats(component);
  const variantCount = variants.filter((v) => v.isVariant).length;
  const files = new Set(component.usages.map((u) => u.module)).size;

  const body = h('div', null, panel({}, h('p', { class: 'muted' }, t('common.loading'))));
  const kpis = h(
    'div',
    { class: 'kpis' },
    kpi(t('kpi.impacted'), '…', { help: 'impact' }),
    kpi(t('col.usages'), component.usages.length),
    kpi(t('kpi.callers'), files),
    kpi(t('col.variants'), variantCount, { help: 'variant', sub: variantCount ? variants.filter((v) => v.isVariant).map((v) => v.name).join(', ') : null }),
  );
  const note = h('div');
  const tabsSlot = h('div');

  const view = h(
    'div',
    null,
    h('nav', { class: 'breadcrumb' }, h('a', { href: PATHS.components }, t('nav.components')), h('span', { class: 'sep' }, '/'), folderOf(component.module)),
    h(
      'div',
      { class: 'page-head' },
      h('div', { class: 'title-row' }, h('h1', { class: 'component-title' }, componentTag(component, { href: false })), h('div', { class: 'title-actions' }, editorLink(component.module, 1))),
      h(
        'p',
        { class: 'sub' },
        clientBadge(component.client),
        filePath(component.module),
        component.export !== 'default' ? h('span', { class: 'muted' }, t('component.export', { name: component.export })) : h('span', { class: 'muted' }, t('component.exportDefault')),
      ),
    ),
    kpis,
    note,
    tabsSlot,
    body,
  );

  fetchJson(`/api/component?id=${encodeURIComponent(id)}`)
    .then(({ impact, routesByFile }) => {
      const pages = uniquePages(impact.routes, (r) => r.route);
      kpis.firstChild.replaceWith(kpi(t('kpi.impacted'), coverage(pages.length), { help: 'impact', sub: riskBadge(pages.length) }));
      const layouts = [...new Set(impact.routes.filter((r) => r.entry !== r.route.file).map((r) => r.entry))];
      if (layouts.length) {
        note.replaceChildren(
          h('div', { class: 'note' }, tx('component.viaLayout', { layouts: layouts.map((l, i) => [i > 0 && ', ', h('a', { href: moduleHref(l) }, roleLabel(l))]) })),
        );
      }
      const tabs = [
        ['usages', t('component.tab.usages'), component.usages.length],
        ['variants', t('component.tab.variants'), variantCount],
        ['pages', t('component.tab.pages'), pages.length],
        ['map', t('component.tab.map')],
        ['content', t('component.tab.content')],
      ];
      tabsSlot.replaceChildren(
        h(
          'div',
          { class: 'tabs', role: 'tablist' },
          tabs.map(([key, label, n]) =>
            h(
              'a',
              { class: `tab ${tab === key ? 'active' : ''}`, href: componentHref(id, { tab: key }), role: 'tab', 'aria-selected': tab === key ? 'true' : 'false' },
              label,
              n != null && h('span', { class: 'count' }, n),
            ),
          ),
        ),
      );
      const content = {
        usages: () => renderUsages(component, routesByFile, filter),
        variants: () => renderVariants(component, variants),
        pages: () => renderImpactedPages(component, impact),
        map: () =>
          panel(
            { title: t('component.tab.map') },
            h('p', { class: 'panel-note flat' }, t('component.map.text')),
            pages.length ? renderDiagram(impact, { changedLabel: `<${component.name}>`, fullscreen: params.get('full') === '1' }) : h('p', { class: 'empty' }, t('risk.none')),
          ),
        content: () => renderContent(component),
      }[tab] ?? (() => renderUsages(component, routesByFile, filter));
      body.replaceChildren(content());
    })
    .catch((error) => body.replaceChildren(h('div', { class: 'error-box' }, error.message)));

  return view;
}

/** Label of the place where a usage is written: `<Header>`, "Page /checkout"… */
function usagePlace(moduleId) {
  const comps = state.componentsByModule.get(moduleId) ?? [];
  if (!state.roles.has(moduleId) && comps.length > 0) return comps.map((c, i) => [i > 0 && ' ', componentTag(c)]);
  return h('a', { href: moduleHref(moduleId) }, moduleLabel(moduleId));
}

function routeChips(indexes) {
  const routes = uniquePages(indexes.map((i) => state.graph.routes[i]).filter(Boolean));
  const shown = routes.slice(0, 6);
  return [
    shown.map((r) => h('a', { class: 'chip route-chip', href: routeHref(r) }, routeLabel(r))),
    routes.length > shown.length && h('span', { class: 'muted' }, t('common.more', { n: routes.length - shown.length })),
  ];
}

function matchesFilter(usage, filter) {
  if (!filter) return true;
  const prop = usage.props.find((p) => p.name === filter.prop);
  if (filter.value === UNSET) return !prop;
  if (filter.value === DYNAMIC) return prop?.kind === 'expression';
  return prop?.kind === 'literal' && prop.value === filter.value;
}

function renderUsages(component, routesByFile, filter) {
  if (component.usages.length === 0) return panel({}, h('p', { class: 'empty' }, t('component.usages.none')));
  const usages = component.usages.filter((u) => matchesFilter(u, filter));
  const filterLabel = filter && (filter.value === UNSET ? t('component.variants.unset') : filter.value === DYNAMIC ? t('component.variants.dynamic') : filter.value);

  return panel(
    { flush: true },
    filter &&
      h(
        'div',
        { class: 'filter-bar' },
        tx('component.usages.filtered', { prop: h('code', null, filter.prop), value: h('code', null, filterLabel) }),
        h('span', { class: 'muted' }, t('n.usage', { n: usages.length })),
        h('a', { class: 'button small', href: componentHref(component.id, { tab: 'usages' }) }, t('common.clear')),
      ),
    h(
      'table',
      { class: 'table usages-table' },
      h('thead', null, h('tr', null, h('th', null, t('col.location')), h('th', null, t(isNuxt() ? 'col.jsx.nuxt' : 'col.jsx')), h('th', null, t('col.visibleOn')))),
      h(
        'tbody',
        null,
        usages.map((u) =>
          h(
            'tr',
            null,
            h(
              'td',
              { class: 'usage-place' },
              h('div', { class: 'cell-main' }, usagePlace(u.module)),
              h('div', { class: 'cell-sub' }, filePath(u.module, { line: u.line }), ' ', editorLink(u.module, u.line, { label: '' })),
            ),
            h('td', null, jsxSnippet(u.tag, u.props)),
            h('td', null, routesByFile[u.module]?.length ? h('div', { class: 'chips' }, routeChips(routesByFile[u.module])) : h('span', { class: 'muted' }, t('component.usages.notVisible'))),
          ),
        ),
      ),
    ),
  );
}

function renderVariants(component, stats) {
  if (stats.length === 0) return panel({}, h('p', { class: 'empty' }, t('component.variants.none')));
  const total = component.usages.length;
  const link = (prop, value) => componentHref(component.id, { tab: 'usages', prop, ...filterParam(value) });
  const row = (count, label, href, cls = '', title) =>
    h(
      'tr',
      { class: `clickable ${cls}`, title, onclick: (e) => e.target.closest('a') || navigate(href) },
      h('td', { class: 'variant-label' }, label),
      h('td', { class: 'num' }, count),
      h('td', { class: 'share' }, h('span', { class: 'bar' }, h('span', { class: 'fill', style: `width:${(count / total) * 100}%` })), h('span', { class: 'num muted' }, `${Math.round((count / total) * 100)} %`)),
      h('td', { class: 'actions' }, h('a', { href }, t('component.variants.see'), ' →')),
    );

  const variantPanels = stats
    .filter((s) => s.isVariant)
    .map((s) =>
      panel(
        { title: h('code', { class: 'prop-name' }, s.name), count: t('component.variants.values', { n: s.values.size + (s.unset > 0 ? 1 : 0) + (s.dynamic.length > 0 ? 1 : 0) }), flush: true },
        h(
          'table',
          { class: 'table variant-table' },
          h('thead', null, h('tr', null, h('th', null, t('col.value')), h('th', { class: 'num' }, t('col.usages')), h('th', null, t('col.share')), h('th', { class: 'actions' }))),
          h(
            'tbody',
            null,
            [...s.values.entries()].sort((a, b) => b[1].count - a[1].count).map(([key, v]) => row(v.count, h('code', { class: 'tk-string' }, literalText(v)), link(s.name, key))),
            s.unset > 0 && row(s.unset, t('component.variants.unset'), link(s.name, UNSET), 'unset'),
            s.dynamic.length > 0 && row(s.dynamic.length, t('component.variants.dynamic'), link(s.name, DYNAMIC), 'dynamic', `${t('component.variants.dynamic.tip')}\n${s.dynamic.join('\n')}`),
          ),
        ),
      ),
    );
  const others = stats.filter((s) => !s.isVariant);

  return h(
    'div',
    null,
    variantPanels.length ? h('div', { class: 'grid-2' }, variantPanels) : panel({}, h('p', { class: 'empty' }, t('component.variants.noVariant'))),
    others.length > 0 &&
      panel(
        { title: t('component.variants.other'), count: others.length },
        h('p', { class: 'panel-note flat' }, t('component.variants.other.text')),
        h('div', { class: 'chips' }, others.map((s) => h('span', { class: 'chip mono', title: [...s.values.values()].map(literalText).concat(s.dynamic).join('\n') }, `${s.name} ×${s.set}`))),
      ),
  );
}

/** Import chain shown with human labels, index files hidden. */
export function chainView(chain) {
  const steps = chain.filter((id, i) => i === 0 || i === chain.length - 1 || !isBarrel(state.graph.modules[id]));
  return h('div', { class: 'chain' }, steps.map((id, i) => [i > 0 && h('span', { class: 'arrow' }, '›'), h('a', { href: moduleHref(id), title: id }, moduleLabel(id))]));
}

function renderImpactedPages(component, impact) {
  const pages = uniquePages(impact.routes, (r) => r.route);
  if (pages.length === 0) return panel({}, h('p', { class: 'empty' }, t('risk.none')));
  return panel(
    { flush: true },
    h(
      'table',
      { class: 'table' },
      h('thead', null, h('tr', null, h('th', null, t('col.page')), h('th', null, t('col.router')), h('th', null, t('col.via')), h('th', null, t('col.chain')))),
      h(
        'tbody',
        null,
        pages.map(({ route, entry, chain }) =>
          h(
            'tr',
            null,
            h('td', null, h('a', { class: 'route-link', href: routeHref(route) }, routeLabel(route))),
            h('td', null, h('span', { class: 'chip' }, routerLabel(route.router))),
            h('td', null, entry !== route.file ? h('a', { href: moduleHref(entry) }, roleLabel(entry)) : h('span', { class: 'muted' }, t('component.pages.direct'))),
            h('td', null, chainView(chain)),
          ),
        ),
      ),
    ),
  );
}

function renderContent(component) {
  const g = state.graph;
  const mod = g.modules[component.module];
  const rendered = new Map();
  for (const u of mod?.usages ?? []) rendered.set(u.component, (rendered.get(u.component) ?? 0) + 1);
  const renderedComponents = [...rendered.entries()].map(([cid, n]) => [g.components[cid], n]).filter(([c]) => c && c.id !== component.id);
  const renderedModules = new Set(renderedComponents.map(([c]) => c.module));
  const otherFiles = (mod?.imports ?? []).filter((e) => e.kind !== 'type' && !renderedModules.has(e.to) && !isBarrel(g.modules[e.to]));
  const siblings = (state.componentsByModule.get(component.module) ?? []).filter((c) => c.id !== component.id);

  return h(
    'div',
    { class: 'grid-2' },
    panel(
      { title: t('component.content.renders'), count: renderedComponents.length },
      renderedComponents.length
        ? h('div', { class: 'chips' }, renderedComponents.map(([c, n]) => h('span', { class: 'chip-group' }, componentTag(c), n > 1 && h('span', { class: 'muted' }, ` ×${n}`))))
        : h('p', { class: 'empty' }, t('common.none')),
    ),
    panel(
      { title: t('component.content.imports'), count: otherFiles.length },
      otherFiles.length
        ? h('ul', { class: 'list' }, otherFiles.map((e) => h('li', null, filePath(e.to), h('span', { class: 'spacer' }), h('span', { class: 'chip' }, categoryLabel(g.modules[e.to]?.category)))))
        : h('p', { class: 'empty' }, t('common.none')),
    ),
    siblings.length > 0 && panel({ title: t('component.sameFile'), count: siblings.length }, h('div', { class: 'chips' }, siblings.map((c) => componentTag(c)))),
    mod?.externals.length > 0 && panel({ title: t('component.content.packages'), count: mod.externals.length }, h('div', { class: 'chips' }, mod.externals.map((p) => h('span', { class: 'chip mono' }, p)))),
  );
}
