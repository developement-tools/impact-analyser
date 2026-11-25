// Entry point: routing, sidebar, search, live updates.
import {
  basename,
  componentHref,
  fetchJson,
  fileHref,
  fileIdFromUrl,
  helpHref,
  navigate,
  PATHS,
  folderOf,
  h,
  loadGraph,
  renderedRoutes,
  routeHref,
  routeLabel,
  routerLabel,
  routeKey,
  savePrefs,
  setGlossary,
  state,
} from './core.js';
import { GLOSSARY, LANGS, getLang, setLang, t } from './i18n.js';
import { renderComponent, renderComponentList } from './views/components.js';
import { renderFile, renderHelp, renderHome, renderUnused } from './views/misc.js';
import { renderPage, renderPageList } from './views/pages.js';

setGlossary(GLOSSARY);

const ICONS = {
  home: '<path d="M3 3h6v8H3zM11 3h6v5h-6zM11 10h6v7h-6zM3 13h6v4H3z"/>',
  pages: '<path d="M4 3h8l4 4v10H4z"/><path d="M12 3v4h4"/>',
  components: '<path d="M10 2l7 4v8l-7 4-7-4V6z"/><path d="M3 6l7 4 7-4M10 10v8"/>',
  unused: '<path d="M4 6h12M8 6V3h4v3M6 6l1 11h6l1-11"/>',
  help: '<circle cx="10" cy="10" r="7.5"/><path d="M7.8 7.8a2.3 2.3 0 1 1 3.2 2.1c-.6.3-1 .8-1 1.5v.4M10 14.6v.1"/>',
};
const icon = (name) => {
  const span = h('span', { class: 'nav-icon', 'aria-hidden': 'true' });
  span.innerHTML = `<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">${ICONS[name]}</svg>`;
  return span;
};

/** "Next.js 16.4.6", "Nuxt 4.7.0". */
function frameworkLabel(fw) {
  const name = fw.name === 'nuxt' ? 'Nuxt' : 'Next.js';
  const version = fw.version?.replace(/^[^\d]*/, '');
  return version ? `${name} ${version}` : name;
}

function navItems() {
  const g = state.graph;
  const dead = g ? g.unreachable.length + Object.values(g.components).filter((c) => c.usages.length === 0).length : null;
  return [
    { href: PATHS.home, key: 'nav.home', icon: 'home', views: [''] },
    { href: PATHS.routes, key: 'nav.pages', icon: 'pages', views: ['pages', 'page'], count: g && renderedRoutes() },
    { href: PATHS.components, key: 'nav.components', icon: 'components', views: ['components', 'component', 'file'], count: g && Object.keys(g.components).length },
    { href: PATHS.deadCode, key: 'nav.unused', icon: 'unused', views: ['unused'], count: dead, warn: dead > 0 },
    { href: PATHS.reference, key: 'nav.help', icon: 'help', views: ['help'] },
  ];
}

/**
 * URL -> view:
 * /                                   overview
 * /routes, /routes/app/dashboard      routes, route (?kind=api|default, ?slot=x)
 * /components, /components/Button     components, component (?in=file when the name is shared, ?tab=…)
 * /files/src/lib/format.ts            file
 * /dead-code, /reference[/term]       dead code, reference
 */
function currentRoute() {
  const params = new URLSearchParams(location.search);
  const parts = location.pathname.split('/').filter(Boolean).map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  });
  const [section, ...rest] = parts;
  const g = state.graph;
  switch (section) {
    case undefined:
      return { view: '', arg: '', params };
    case 'routes': {
      if (rest.length === 0) return { view: 'pages', arg: '', params };
      const [router, ...segments] = rest;
      const urlPath = '/' + segments.join('/');
      return { view: 'page', arg: [router, params.get('kind') ?? 'page', urlPath, params.get('slot') ?? ''].join('|'), params };
    }
    case 'components': {
      if (rest.length === 0) return { view: 'components', arg: '', params };
      const name = rest.join('/');
      const file = params.get('in');
      const match = g && Object.values(g.components).find((c) => c.name === name && (!file || c.module === file));
      return { view: 'component', arg: match?.id ?? name, params };
    }
    case 'files':
      return { view: 'file', arg: fileIdFromUrl(rest), params };
    case 'dead-code':
      return { view: 'unused', arg: '', params };
    case 'reference':
      return { view: 'help', arg: rest[0] ?? '', params };
    default:
      return { view: 'notFound', arg: '', params };
  }
}

/** Links of the previous versions (/#/component/src%2F…%23Button) -> readable URLs. */
function redirectLegacyHash() {
  if (!location.hash.startsWith('#/')) return;
  const [path, query = ''] = location.hash.slice(2).split('?');
  const slash = path.indexOf('/');
  const view = slash === -1 ? path : path.slice(0, slash);
  const arg = slash === -1 ? '' : decodeURIComponent(path.slice(slash + 1));
  const params = Object.fromEntries(new URLSearchParams(query));
  const g = state.graph;
  const route = view === 'page' && g?.routes.find((r) => routeKey(r) === arg);
  const target =
    view === 'page' && route ? routeHref(route)
    : view === 'component' ? componentHref(arg, params)
    : view === 'file' ? fileHref(arg)
    : view === 'help' ? helpHref(arg)
    : ({ pages: PATHS.routes, components: PATHS.components, unused: PATHS.deadCode }[view] ?? PATHS.home);
  history.replaceState(null, '', target);
}

// ------------------------------------------------------------------ sidebar & top bar

let statusText = '';
let statusClass = '';

function renderSidebar() {
  const { view } = currentRoute();
  const root = state.graph?.root ?? '';
  const project = root.split('/').filter(Boolean).pop() ?? '';
  const brand = h('a', { class: 'brand', href: PATHS.home }, h('span', { class: 'brand-mark', 'aria-hidden': 'true' }), h('span', null, 'impact-analyser'));
  brand.firstChild.innerHTML =
    '<svg viewBox="0 0 32 32" width="18" height="18"><circle cx="8" cy="16" r="5"/><circle cx="24" cy="8" r="4"/><circle cx="24" cy="24" r="4"/><path d="M12 14l8-5M12 18l8 5"/></svg>';

  document.getElementById('sidebar').replaceChildren(
    brand,
    project &&
      h(
        'div',
        { class: 'project', title: root },
        h('span', { class: 'project-label' }, t('nav.project')),
        h('span', { class: 'project-name' }, project),
        state.graph?.framework && h('span', { class: 'project-fw' }, frameworkLabel(state.graph.framework)),
      ),
    h(
      'nav',
      { class: 'nav' },
      navItems().map((item) =>
        h(
          'a',
          { class: `nav-item ${item.views.includes(view) ? 'active' : ''}`, href: item.href },
          icon(item.icon),
          h('span', { class: 'nav-label' }, t(item.key)),
          item.count != null && h('span', { class: `nav-count ${item.warn ? 'warn' : ''}` }, item.count),
        ),
      ),
    ),
    h(
      'div',
      { class: 'sidebar-foot' },
      h('span', { id: 'status', class: `status ${statusClass}`, title: root }, h('i'), statusText),
      h(
        'div',
        { class: 'lang', role: 'group', 'aria-label': t('lang.label') },
        LANGS.map((lang) =>
          h(
            'button',
            {
              class: lang === getLang() ? 'active' : '',
              'aria-pressed': lang === getLang() ? 'true' : 'false',
              onclick: () => {
                state.prefs.lang = lang;
                savePrefs();
                setLang(lang);
                if (state.analyzedAt) statusText = t('status.analysed', { time: new Date(state.analyzedAt).toLocaleTimeString(getLang()) });
                render();
              },
            },
            lang.toUpperCase(),
          ),
        ),
      ),
    ),
  );
}

function renderTopbar() {
  document.getElementById('topbar').replaceChildren(searchBox());
}

function setStatus(text, cls = '') {
  statusText = text;
  statusClass = cls;
  const el = document.getElementById('status');
  if (el) {
    el.replaceChildren(h('i'), text);
    el.className = `status ${cls}`;
  }
}

// ------------------------------------------------------------------ search

function searchBox() {
  const input = h('input', { id: 'search', type: 'search', placeholder: t('search.placeholder'), autocomplete: 'off', spellcheck: 'false', 'aria-label': t('search.placeholder') });
  const list = h('ul', { class: 'search-results', hidden: true, role: 'listbox' });
  let results = [];
  let active = 0;

  const close = () => {
    list.hidden = true;
    results = [];
  };
  const go = (item) => {
    navigate(item.href);
    input.value = '';
    close();
    input.blur();
  };
  const score = (text, needle) => {
    const s = text.toLowerCase();
    if (s === needle) return 0;
    if (s.startsWith(needle)) return 1;
    if (s.includes(needle)) return 2;
    return -1;
  };

  const search = (q) => {
    const g = state.graph;
    const needle = q.trim().toLowerCase();
    if (!g || !needle) return close();
    const found = [];
    for (const c of Object.values(g.components)) {
      const s = score(c.name, needle);
      if (s >= 0) found.push({ s, kind: 'component', label: `<${c.name}>`, detail: folderOf(c.module), href: componentHref(c.id) });
    }
    for (const r of g.routes) {
      const s = score(r.path, needle);
      if (s >= 0) found.push({ s: s + 0.3, kind: 'page', label: routeLabel(r), detail: routerLabel(r.router), href: routeHref(r) });
    }
    for (const id of [...Object.keys(g.modules), ...g.unreachable]) {
      const s = Math.min(...[score(basename(id), needle), score(id, needle) >= 0 ? 3 : -1].filter((x) => x >= 0), Infinity);
      if (Number.isFinite(s)) found.push({ s: s + 0.6, kind: 'file', label: basename(id), detail: folderOf(id), href: fileHref(id) });
    }
    results = found.sort((a, b) => a.s - b.s || a.label.length - b.label.length).slice(0, 14);
    active = 0;
    draw();
  };

  const draw = () => {
    list.replaceChildren(
      ...(results.length
        ? results.map((r, i) =>
            h(
              'li',
              { class: i === active ? 'active' : '', role: 'option', onmousedown: (e) => (e.preventDefault(), go(r)) },
              h('span', { class: `kind kind-${r.kind}` }, t(`search.kind.${r.kind}`)),
              h('span', { class: 'mono' }, r.label),
              h('span', { class: 'detail' }, r.detail),
            ),
          )
        : [h('li', { class: 'muted' }, t('search.noMatch'))]),
    );
    list.hidden = false;
  };

  input.addEventListener('input', () => search(input.value));
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') active = Math.min(active + 1, results.length - 1);
    else if (e.key === 'ArrowUp') active = Math.max(active - 1, 0);
    else if (e.key === 'Enter' && results[active]) return go(results[active]);
    else if (e.key === 'Escape') return (close(), input.blur());
    else return;
    e.preventDefault();
    draw();
  });
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  return h('div', { class: 'search' }, h('span', { class: 'search-icon', 'aria-hidden': 'true' }, '⌕'), input, h('kbd', null, mac ? '⌘K' : 'Ctrl K'), list);
}

document.addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName ?? '';
  const typing = /input|textarea|select/i.test(tag);
  if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
    e.preventDefault();
    document.getElementById('search')?.focus();
  }
});

// ------------------------------------------------------------------ render

function render({ scroll = false } = {}) {
  renderSidebar();
  renderTopbar();
  const main = document.getElementById('main');
  if (state.error) {
    main.replaceChildren(h('h1', null, t('common.analysisFailed')), h('div', { class: 'error-box' }, state.error));
    return;
  }
  const { view, arg, params } = currentRoute();
  const views = {
    '': () => renderHome(),
    pages: () => renderPageList(),
    page: () => renderPage(arg),
    components: () => renderComponentList(),
    component: () => renderComponent(arg, params),
    file: () => renderFile(arg),
    unused: () => renderUnused(),
    help: () => renderHelp(arg),
    notFound: () => h('div', null, h('h1', null, t('common.notFound')), h('p', { class: 'muted' }, t('common.notFoundText'))),
  };
  main.replaceChildren(
    state.configError ? h('div', { class: 'error-box config-error' }, t('status.configError'), '\n', state.configError) : '',
    (views[view] ?? views[''])(),
  );
  if (scroll) window.scrollTo(0, 0);
}

function listenForChanges() {
  const events = new EventSource('/api/events');
  events.addEventListener('graph', async (event) => {
    if (Number(event.data) === state.version) return;
    // The config can change too (hot reload of impact-analyser.config.*): editor, app URL, language.
    const previousLang = state.config.lang;
    try {
      state.config = { ...state.config, ...(await fetchJson('/api/config')) };
    } catch {
      /* keep the current settings */
    }
    if (!state.prefs.lang && state.config.lang !== previousLang) setLang(state.config.lang);
    await loadGraph();
    render();
    const time = new Date().toLocaleTimeString(getLang());
    setStatus(state.error ? t('status.failed') : t('status.updated', { time }), state.error ? 'error' : 'flash');
    setTimeout(() => setStatus(statusText, ''), 2500);
  });
  events.onerror = () => setStatus(t('status.disconnected'), 'error');
  events.onopen = () => state.analyzedAt && setStatus(t('status.analysed', { time: new Date(state.analyzedAt).toLocaleTimeString(getLang()) }));
}

// ------------------------------------------------------------------ boot

window.addEventListener('popstate', () => render());
window.addEventListener('app:navigate', (e) => render({ scroll: e.detail?.scroll }));
// Internal links navigate without reloading the page (modifier keys keep the browser behaviour: new tab…).
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const link = e.target.closest?.('a[href]');
  if (!link || link.target || link.hasAttribute('download')) return;
  const href = link.getAttribute('href');
  if (!href.startsWith('/') || href.startsWith('//') || href.startsWith('/api/')) return;
  e.preventDefault();
  if (href !== location.pathname + location.search) navigate(href);
});

try {
  state.config = { ...state.config, ...(await fetchJson('/api/config')) };
} catch {
  /* older server: keep the defaults */
}
setLang(state.prefs.lang ?? state.config.lang);
await loadGraph();
redirectLegacyHash();
if (state.analyzedAt) statusText = t('status.analysed', { time: new Date(state.analyzedAt).toLocaleTimeString(getLang()) });
render();
listenForChanges();
