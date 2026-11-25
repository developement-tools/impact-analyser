// Pages list and page detail.
import {
  clientBadge,
  componentTag,
  editorLink,
  filePath,
  h,
  helpIcon,
  attachedLabel,
  categoryLabel,
  isBarrel,
  isLayoutRole,
  isNuxt,
  jsxSnippet,
  kpi,
  moduleHref,
  navigate,
  panel,
  PATHS,
  roleLabel,
  roleOf,
  routeHref,
  routeKey,
  routerLabel,
  savePrefs,
  state,
  universalRendering,
} from '../core.js';
import { t } from '../i18n.js';

/** Wrappers drawn as nested boxes; the others (boundaries, middleware, plugins…) are attached to a box. */
const BOX_ROLES = new Set(['layout', 'template', '_app', '_document', 'app', 'parent']);

/** Components rendered by a module: [{ component, usages }] in source order. */
function renderedBy(moduleId) {
  const g = state.graph;
  const byComponent = new Map();
  for (const u of g.modules[moduleId]?.usages ?? []) {
    const component = g.components[u.component];
    if (!component || component.module === moduleId) continue;
    if (!byComponent.has(component.id)) byComponent.set(component.id, { component, usages: [] });
    byComponent.get(component.id).usages.push(u);
  }
  return [...byComponent.values()];
}

/** Every component displayed by a route (through its layouts and its page). */
export function routeComponents(route) {
  const seen = new Set();
  const visit = (moduleId) => {
    for (const { component } of renderedBy(moduleId)) {
      if (seen.has(component.id)) continue;
      seen.add(component.id);
      visit(component.module);
    }
  };
  for (const file of [...route.wrappers, route.file]) visit(file);
  return [...seen].map((id) => state.graph.components[id]);
}

// ------------------------------------------------------------------ list

/**
 * URL tree of a router: `/` > `dashboard` > `settings`. A node holds the routes of its exact URL
 * (page, parallel-route slots, default, API) and its child segments.
 */
function buildUrlTree(routes) {
  const root = { segment: '/', path: '/', routes: [], children: new Map() };
  for (const r of routes) {
    let node = root;
    let path = '';
    for (const segment of r.path.split('/').filter(Boolean)) {
      path += `/${segment}`;
      if (!node.children.has(segment)) node.children.set(segment, { segment, path, routes: [], children: new Map() });
      node = node.children.get(segment);
    }
    node.routes.push(r);
  }
  // Main page first, then its slots, its default screens and its API handler.
  const order = (r) => (r.kind === 'page' && !r.slot ? 0 : r.slot && r.kind === 'page' ? 1 : r.kind === 'default' ? 2 : 3);
  const sort = (node) => {
    node.routes.sort((a, b) => order(a) - order(b) || (a.slot ?? '').localeCompare(b.slot ?? ''));
    node.children = new Map([...node.children.entries()].sort((a, b) => a[0].localeCompare(b[0])));
    for (const child of node.children.values()) sort(child);
  };
  sort(root);
  return root;
}

const countRoutes = (node) => node.routes.length + [...node.children.values()].reduce((n, c) => n + countRoutes(c), 0);

/** One router as a collapsible tree table: segment rows, with the routes of each URL. */
function routeTreeTable(routes) {
  const tree = buildUrlTree(routes);
  const collapsed = new Set();
  // Large apps start folded below the first level; small ones fully open.
  if (routes.length > 60) {
    for (const child of tree.children.values()) if (child.children.size > 0) collapsed.add(child.path);
  }
  const tbody = h('tbody');

  const cells = (r) => {
    const comps = r.kind === 'api' ? null : routeComponents(r);
    const dash = () => h('span', { class: 'muted' }, '—');
    return [
      h('td', null, h('span', { class: `chip kind-${r.kind}` }, r.slot ? (r.kind === 'default' ? 'slot · default' : 'slot') : t(`routeKind.${r.kind}`))),
      h('td', { class: 'num' }, r.kind === 'api' ? dash() : r.wrappers.filter(isLayoutRole).length),
      h('td', { class: 'num' }, comps ? comps.length : dash()),
      h('td', { class: 'num' }, comps ? comps.filter((c) => c.client).length : dash()),
      h('td', null, h('span', { class: 'route-file' }, r.file.replace(/^src\//, ''))),
    ];
  };

  const draw = () => {
    const rows = [];
    const visit = (node, depth) => {
      const hasChildren = node.children.size > 0;
      const isCollapsed = collapsed.has(node.path);
      const toggle = hasChildren
        ? h(
            'button',
            {
              class: `tree-toggle ${isCollapsed ? 'collapsed' : ''}`,
              'aria-label': isCollapsed ? t('route.tree.expand') : t('route.tree.collapse'),
              'aria-expanded': isCollapsed ? 'false' : 'true',
              onclick: (e) => {
                e.stopPropagation();
                if (collapsed.has(node.path)) collapsed.delete(node.path);
                else collapsed.add(node.path);
                draw();
              },
            },
            '▸',
          )
        : h('span', { class: 'tree-toggle leaf' });
      const label = node.segment === '/' ? '/' : `/${node.segment}`;
      const hidden = isCollapsed && hasChildren && h('span', { class: 'count', title: t('pages.hiddenRoutes') }, `+${[...node.children.values()].reduce((n, c) => n + countRoutes(c), 0)}`);
      const segment = (r) =>
        h(
          'span',
          { class: 'route-url', title: node.path },
          /^\[.*\]$/.test(node.segment) ? ['/', h('span', { class: 'dyn', title: t('common.dynamicUrl') }, node.segment)] : label,
        );

      if (node.routes.length === 0) {
        // Segment without a page of its own (e.g. /blog when only /blog/[slug] exists).
        rows.push(
          h(
            'tr',
            { class: 'segment-row' },
            h('td', { colspan: 6 }, h('span', { class: 'tree-cell', style: `--depth:${depth}` }, toggle, h('span', { class: 'route-url muted' }, label), hidden)),
          ),
        );
      }
      node.routes.forEach((r, i) => {
        const first = i === 0;
        rows.push(
          h(
            'tr',
            { class: `clickable ${r.slot || r.kind === 'api' ? 'slot-row' : ''}`, onclick: (e) => e.target.closest('a, button') || navigate(routeHref(r)) },
            h(
              'td',
              null,
              h(
                'span',
                { class: 'tree-cell', style: `--depth:${first ? depth : depth + 1}` },
                first ? toggle : h('span', { class: 'tree-toggle leaf' }),
                h(
                  'a',
                  { class: 'route-cell', href: routeHref(r) },
                  // A slot is a zone of its page, not another URL: "@analytics" under /dashboard.
                  r.slot ? [h('span', { class: 'route-url' }, `@${r.slot}`), r.kind === 'default' && h('span', { class: 'muted' }, ' (default)')] : first ? segment(r) : h('span', { class: 'route-url' }, label),
                ),
                first && hidden,
              ),
            ),
            cells(r),
          ),
        );
      });
      if (!isCollapsed) for (const child of node.children.values()) visit(child, depth + 1);
    };
    visit(tree, 0);
    tbody.replaceChildren(...rows);
  };
  draw();

  const setAll = (fold) => {
    collapsed.clear();
    if (fold) {
      const walk = (node) => {
        if (node.children.size > 0 && node !== tree) collapsed.add(node.path);
        for (const c of node.children.values()) walk(c);
      };
      walk(tree);
    }
    draw();
  };

  const table = h(
    'table',
    { class: 'table routes-table' },
    h(
      'thead',
      null,
      h(
        'tr',
        null,
        h('th', null, t('col.route')),
        h('th', null, t('col.type')),
        h('th', { class: 'num' }, t('col.layouts')),
        h('th', { class: 'num' }, t('col.components')),
        h('th', { class: 'num' }, t('col.client')),
        h('th', null, t('col.file')),
      ),
    ),
    tbody,
  );
  const actions = [
    h('button', { class: 'button small', onclick: () => setAll(false) }, t('route.tree.expand')),
    h('button', { class: 'button small', onclick: () => setAll(true) }, t('route.tree.collapse')),
  ];
  return { table, actions };
}

export function renderPageList() {
  const g = state.graph;
  const view = h('div', null, h('div', { class: 'page-head' }, h('h1', null, t('pages.title')), h('p', { class: 'lead' }, t('pages.subtitle'))));
  for (const router of ['app', 'pages', 'nuxt']) {
    const routes = g.routes.filter((r) => r.router === router);
    if (routes.length === 0) continue;
    const { table, actions } = routeTreeTable(routes);
    view.append(
      panel(
        { title: routerLabel(router), count: routes.length, help: router === 'app' ? 'app-router' : router === 'pages' ? 'pages-router' : 'page', actions, flush: true },
        table,
      ),
    );
  }
  return view;
}

/** Highlights dynamic segments: /products/[id] */
function urlParts(path) {
  if (path === '/') return '/';
  return path
    .split('/')
    .filter(Boolean)
    .map((seg) => ['/', /^\[.*\]$/.test(seg) ? h('span', { class: 'dyn', title: t('common.dynamicUrl') }, seg) : seg]);
}

// ------------------------------------------------------------------ detail

export function renderPage(key) {
  const g = state.graph;
  const route = g.routes.find((r) => routeKey(r) === key);
  if (!route) return h('div', null, h('h1', null, t('common.notFound')), h('p', { class: 'muted' }, t('common.notFoundText')));

  const isDynamic = /\[/.test(route.path);
  const appUrl = state.config.appUrl?.replace(/\/$/, '');
  const comps = routeComponents(route);
  const files = importedFiles(route);
  const externals = new Set(files.flatMap((m) => m.externals));

  const head = h(
    'div',
    { class: 'page-head' },
    h('nav', { class: 'breadcrumb' }, h('a', { href: PATHS.routes }, t('nav.pages')), h('span', { class: 'sep' }, '/'), routerLabel(route.router)),
    h(
      'div',
      { class: 'title-row' },
      h('h1', { class: 'route-title' }, urlParts(route.path), route.slot && h('span', { class: 'muted' }, ` @${route.slot}`)),
      h(
        'div',
        { class: 'title-actions' },
        editorLink(route.file, 1),
        route.kind === 'page' &&
          appUrl &&
          (isDynamic
            ? h('span', { class: 'editor-link disabled', title: t('common.dynamicUrl') }, h('span', { class: 'ico' }, '↗'), t('common.openPage'))
            : h('a', { class: 'editor-link', href: appUrl + route.path, target: '_blank', rel: 'noreferrer' }, h('span', { class: 'ico' }, '↗'), t('common.openPage'))),
      ),
    ),
    h('p', { class: 'sub' }, h('span', { class: 'chip' }, routerLabel(route.router)), route.kind !== 'page' && h('span', { class: 'chip' }, t(`routeKind.${route.kind}`)), filePath(route.file)),
  );

  if (route.kind === 'api') return h('div', null, head, h('div', { class: 'note' }, t('route.api')));

  const treeEl = h('ul', { class: 'ctree' }, buildComponentTree(route));
  const setAll = (collapsed) => treeEl.querySelectorAll('li.has-children').forEach((li) => li.classList.toggle('collapsed', collapsed));
  const layouts = route.wrappers.filter(isLayoutRole).length;

  return h(
    'div',
    null,
    head,
    h(
      'div',
      { class: 'kpis' },
      kpi(t('col.components'), comps.length, { sub: t(universalRendering() ? 'kpi.components.sub.universal' : 'kpi.components.sub', { client: comps.filter((c) => c.client).length, server: comps.filter((c) => !c.client).length }) }),
      kpi(t('col.layouts'), layouts, { help: 'layout' }),
      kpi(t('kpi.files'), files.length),
      kpi(t('kpi.packages'), externals.size),
    ),
    panel({ title: t('route.built.title'), help: 'layout' }, h('p', { class: 'panel-note flat' }, t(isNuxt() ? 'route.built.text.nuxt' : 'route.built.text')), renderBoxes(route)),
    panel(
      {
        title: t('route.tree.title'),
        count: comps.length,
        actions: [h('button', { class: 'button small', onclick: () => setAll(false) }, t('route.tree.expand')), h('button', { class: 'button small', onclick: () => setAll(true) }, t('route.tree.collapse'))],
      },
      treeEl.childElementCount ? treeEl : h('p', { class: 'empty' }, t('route.tree.empty')),
    ),
    renderFilesCard(files),
    externals.size > 0 && panel({ title: t('kpi.packages'), count: externals.size }, h('div', { class: 'chips' }, [...externals].sort().map((p) => h('span', { class: 'chip mono' }, p)))),
  );
}

/** Every file loaded by a route (barrels skipped), through non-type imports. */
function importedFiles(route) {
  const g = state.graph;
  const seen = new Set();
  const files = [];
  const visit = (id) => {
    if (seen.has(id)) return;
    seen.add(id);
    const mod = g.modules[id];
    if (!mod) return;
    if (!isBarrel(mod)) files.push(mod);
    for (const e of mod.imports) if (e.kind !== 'type') visit(e.to);
  };
  for (const f of [...route.wrappers, route.file]) visit(f);
  return files;
}

/** Layouts as nested boxes, special screens attached to their box, the page inside. */
function renderBoxes(route) {
  const boxes = [];
  const beforeFirstBox = [];
  for (const file of route.wrappers) {
    const role = roleOf(file);
    if (!BOX_ROLES.has(role)) (boxes.length > 0 ? boxes[boxes.length - 1].boundaries : beforeFirstBox).push(file);
    else boxes.push({ file, label: route.router === 'pages' ? t(role === '_app' ? 'route.app' : 'route.document') : roleLabel(file), boundaries: [] });
  }
  boxes.push({ file: route.file, label: t('route.page'), boundaries: [], page: true });
  // Nuxt: plugins, global middleware and CSS come before app.vue — shown on the outermost box.
  boxes[0].boundaries.unshift(...beforeFirstBox);
  const BOUNDARY_ROLES = new Set(['error', 'loading', 'not-found', 'forbidden', 'unauthorized', 'global-error', 'global-not-found']);

  const renderBox = (i) => {
    const box = boxes[i];
    const rendered = renderedBy(box.file);
    return h(
      'div',
      { class: `box ${box.page ? 'box-page' : ''}`, style: `--level:${i}` },
      h('div', { class: 'box-head' }, h('a', { class: 'box-title', href: moduleHref(box.file) }, box.label), filePath(box.file), editorLink(box.file, 1, { label: '' })),
      rendered.length > 0 && h('div', { class: 'box-renders' }, h('span', { class: 'muted' }, t('route.renders'), ' '), rendered.map(({ component }) => componentTag(component))),
      box.boundaries.length > 0 &&
        h(
          'div',
          { class: 'box-renders' },
          h('span', { class: 'muted' }, t(box.boundaries.every((f) => BOUNDARY_ROLES.has(roleOf(f))) ? 'route.boundaries' : 'route.attached'), ' '),
          helpIcon(box.boundaries.every((f) => BOUNDARY_ROLES.has(roleOf(f))) ? 'boundary' : 'middleware'),
          box.boundaries.map((f) => h('a', { class: 'chip', href: moduleHref(f), title: f }, attachedLabel(f))),
        ),
      i + 1 < boxes.length && renderBox(i + 1),
    );
  };
  return h('div', { class: 'boxes' }, renderBox(0));
}

/** Component tree from the JSX: layout/page -> components they render -> … */
function buildComponentTree(route) {
  const g = state.graph;
  const seen = new Set();

  const node = (component, usages, parentModule, depth) => {
    const dynamic = g.modules[parentModule]?.imports.some((e) => e.kind === 'dynamic' && e.to === component.module);
    const repeated = seen.has(component.id);
    seen.add(component.id);
    const folded = repeated && renderedBy(component.module).length > 0;
    const children = repeated ? [] : renderedBy(component.module).map((c) => node(c.component, c.usages, component.module, depth + 1));
    const snippets = [...new Map(usages.map((u) => [JSON.stringify(u.props.filter((p) => p.name !== 'children')), u])).values()].slice(0, 2);
    return treeItem(
      [
        componentTag(component),
        component.client && clientBadge(true),
        dynamic && h('span', { class: 'chip', title: t('badge.dynamic.tip') }, t('badge.dynamic')),
        usages.length > 1 && h('span', { class: 'muted' }, `×${usages.length}`),
        snippets.some((u) => u.props.some((p) => p.name !== 'children')) && h('span', { class: 'tree-props' }, snippets.map((u) => jsxSnippet(u.tag, u.props))),
        folded && h('span', { class: 'muted small', title: t('route.tree.repeated') }, '↺ ', t('route.tree.repeated')),
      ],
      children,
      depth,
    );
  };

  return [...route.wrappers, route.file]
    .map((file) => {
      const rendered = renderedBy(file);
      if (rendered.length === 0 && file !== route.file) return null;
      const label = route.router === 'pages' && file !== route.file ? roleOf(file) : file === route.file ? t('route.page') : roleLabel(file);
      return treeItem(
        [h('a', { class: 'role', href: moduleHref(file) }, label), h('span', { class: 'muted small' }, file.replace(/^src\//, ''))],
        rendered.map(({ component, usages }) => node(component, usages, file, 1)),
        0,
      );
    })
    .filter(Boolean);
}

function treeItem(content, children, depth) {
  const hasChildren = children.length > 0;
  const li = h('li', { class: `${hasChildren ? 'has-children' : ''} ${hasChildren && depth >= 3 ? 'collapsed' : ''}` });
  li.append(
    h(
      'div',
      { class: 'node' },
      h('button', { class: `caret ${hasChildren ? '' : 'leaf'}`, 'aria-label': 'toggle', onclick: () => li.classList.toggle('collapsed') }, '▸'),
      content,
    ),
  );
  if (hasChildren) li.append(h('ul', null, children));
  return li;
}

/** Every imported file (utilities, hooks, styles), collapsed by default. */
function renderFilesCard(files) {
  const details = h('details', { class: 'panel', open: state.prefs.showFiles });
  details.addEventListener('toggle', () => {
    state.prefs.showFiles = details.open;
    savePrefs();
  });
  const byCategory = new Map();
  for (const mod of files) {
    if (!byCategory.has(mod.category)) byCategory.set(mod.category, []);
    byCategory.get(mod.category).push(mod);
  }
  details.append(
    h('summary', { class: 'panel-head' }, h('h2', null, t('route.files.title'), h('span', { class: 'count' }, files.length))),
    h(
      'div',
      { class: 'panel-body' },
      h(
        'div',
        { class: 'file-groups' },
        ['route', 'component', 'hook', 'util', 'style', 'asset']
          .filter((c) => byCategory.has(c))
          .map((c) => h('div', null, h('h3', { class: 'section-title' }, categoryLabel(c), h('span', { class: 'count' }, byCategory.get(c).length)), h('ul', { class: 'list' }, byCategory.get(c).map((m) => h('li', null, filePath(m.id), m.client && clientBadge(true)))))),
      ),
    ),
  );
  return details;
}
