// Shared state and helpers of the UI.
import { getLang, t } from './i18n.js';

export const state = {
  graph: null,
  config: { lang: 'en', editor: 'vscode', appUrl: 'http://localhost:3000' },
  version: 0,
  analyzedAt: null,
  error: null,
  componentRanking: null,
  moduleRanking: null,
  /** module id -> [{ role, route }] for Next.js files (page, layout, _app…) */
  roles: new Map(),
  /** module id -> components defined in it */
  componentsByModule: new Map(),
  prefs: loadPrefs(),
};

// ------------------------------------------------------------------ prefs

function loadPrefs() {
  const defaults = { lang: null, showFiles: false, sort: 'pages', sortDir: -1, show: 'all' };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem('impact-analyser:prefs') ?? '{}') };
  } catch {
    return defaults;
  }
}
export function savePrefs() {
  try {
    localStorage.setItem('impact-analyser:prefs', JSON.stringify(state.prefs));
  } catch {
    /* storage unavailable: preferences only last for this visit */
  }
}

// ------------------------------------------------------------------ DOM

/** h('a', { href, class, onclick }, 'text', child, [children]) */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value == null || value === false) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  return append(el, children);
}
export function append(el, children) {
  for (const child of [children].flat(Infinity)) {
    if (child == null || child === false || child === '') continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}
export function svg(tag, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

/** Like t(), but placeholders can be DOM nodes: tx('x {name} y', { name: h('code', …) }). */
export function tx(key, vars = {}) {
  const textVars = Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, `\u0000${k}\u0000`]));
  return t(key, { ...textVars, n: vars.n })
    .split(/\u0000(\w+)\u0000/)
    .map((part, i) => (i % 2 === 1 ? vars[part] : part));
}

// ------------------------------------------------------------------ text helpers

export const basename = (id) => id.slice(id.lastIndexOf('/') + 1);
export const dirname = (id) => (id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : '');
export const stem = (id) => basename(id).replace(/\.[^.]+$/, '');
const NEXT_FILES = new Set(['page', 'layout', 'template', 'loading', 'error', 'not-found', 'default', 'route', 'index', 'global-error', 'forbidden', 'unauthorized']);

/** `page.tsx` alone is ambiguous: prefix it with its folder. */
export function fileName(id) {
  const name = basename(id);
  if (!NEXT_FILES.has(stem(id))) return name;
  const parent = basename(dirname(id));
  return parent ? `${parent}/${name}` : name;
}

/** Folder shown in lists: path without the src/ prefix. */
export const folderOf = (id) => dirname(id).replace(/^src\//, '');

export function routeKey(r) {
  return [r.router, r.kind, r.path, r.slot ?? ''].join('|');
}
export function routeLabel(r) {
  const tags = [r.slot && `@${r.slot}`, r.kind !== 'page' && t(`routeKind.${r.kind}`)].filter(Boolean);
  return tags.length ? `${r.path} (${tags.join(', ')})` : r.path;
}
// ------------------------------------------------------------------ URLs
// Readable paths: /routes/app/dashboard/settings, /components/Button?tab=variants, /files/src/lib/format.ts

export const PATHS = { home: '/', routes: '/routes', components: '/components', deadCode: '/dead-code', reference: '/reference' };

/** Keeps `/`, `[id]`, `(group)`, `@slot` readable; only escapes what would break the URL. */
export const encodePath = (p) => encodeURI(p).replace(/#/g, '%23').replace(/\?/g, '%3F');

/** `href` + query parameters (undefined / null values skipped). */
export function withQuery(href, params = {}) {
  const [base, query = ''] = href.split('?');
  const search = new URLSearchParams(query);
  for (const [key, value] of Object.entries(params)) if (value != null) search.set(key, value);
  const text = search.toString().replace(/%2F/g, '/');
  return text ? `${base}?${text}` : base;
}

/** /routes/app/dashboard — `?kind=api|default` and `?slot=x` only when needed. */
export function routeHref(r) {
  return withQuery(`${PATHS.routes}/${r.router}${r.path === '/' ? '/' : encodePath(r.path)}`, {
    kind: r.kind !== 'page' ? r.kind : undefined,
    slot: r.slot,
  });
}

/** /components/Button, or /components/Button?in=src/ui/Button.tsx when several components share the name. */
export function componentHref(id, params = {}) {
  const c = state.graph?.components[id];
  if (!c) return PATHS.components;
  const homonyms = Object.values(state.graph.components).filter((o) => o.name === c.name);
  return withQuery(`${PATHS.components}/${encodeURIComponent(c.name)}`, { in: homonyms.length > 1 ? c.module : undefined, ...params });
}

/** `..` segments (files of a layer outside the project) would be resolved by the browser: written `_parent_` in URLs. */
export const fileHref = (id) => `/files/${encodePath(id.split('/').map((p) => (p === '..' ? '_parent_' : p)).join('/'))}`;
export const fileIdFromUrl = (parts) => parts.map((p) => (p === '_parent_' ? '..' : p)).join('/');
export const helpHref = (term) => (term ? `${PATHS.reference}/${encodeURIComponent(term)}` : PATHS.reference);

/** Client-side navigation (History API); main.js re-renders on `app:navigate`. */
export function navigate(href, { replace = false } = {}) {
  if (replace) history.replaceState(null, '', href);
  else history.pushState(null, '', href);
  window.dispatchEvent(new CustomEvent('app:navigate', { detail: { scroll: !replace } }));
}

/** Where a module id leads: its component page when it defines a single component. */
export function moduleHref(id) {
  const comps = state.componentsByModule.get(id) ?? [];
  return comps.length === 1 ? componentHref(comps[0].id) : fileHref(id);
}

/** Human label of a module: `<Header>` for components, "layout de /dashboard" for Next files, file name otherwise. */
export function moduleLabel(id) {
  const roles = state.roles.get(id);
  if (roles?.length) return roleLabel(id);
  const comps = state.componentsByModule.get(id) ?? [];
  if (comps.length === 1) return `<${comps[0].name}>`;
  if (comps.length > 1) return comps.map((c) => `<${c.name}>`).join(' ');
  return fileName(id);
}

// ------------------------------------------------------------------ framework

export const isNuxt = () => state.graph?.framework?.name === 'nuxt';

/** Server components only exist in the App Router: elsewhere (Pages Router only, Nuxt) components are universal (SSR + hydration). */
export const universalRendering = () => isNuxt() || !state.graph?.appDir;

/** "App Router", "Pages Router", "Nuxt 4". */
export function routerLabel(router) {
  const major = state.graph?.framework?.major;
  return router === 'nuxt' && major ? `Nuxt ${major}` : t(`router.${router}`);
}

/** Role of a file wrapping routes: layout, _app, app (app.vue), parent, middleware… (file name for Next.js). */
export const roleOf = (id) => state.graph?.roles?.[id]?.role ?? stem(id);

/** Layout-like wrappers, counted in the "Layouts" columns. */
export const isLayoutRole = (id) => ['layout', 'template', '_app'].includes(roleOf(id));

/** Category label, with the framework's vocabulary: "Nuxt file", "composable". */
export function categoryLabel(category) {
  if (isNuxt() && (category === 'route' || category === 'hook')) return t(`category.${category}.nuxt`);
  return t(`category.${category ?? 'util'}`);
}

/** Short label of a file attached to a route (boundary, middleware, plugin…): "error", "middleware /admin", "proxy". */
export function attachedLabel(id) {
  if (isNuxt()) return roleLabel(id);
  const info = state.graph.roles?.[id];
  if (info?.role === 'middleware' && info.name) return info.name === 'middleware' || info.name === 'proxy' ? info.name : `middleware ${info.name}`;
  return t(`role.${roleOf(id)}`);
}

/** Nuxt: "Layout dashboard", "app.vue", "Parent page /dashboard", "Middleware auth", "Plugin toast"… */
function nuxtRoleLabel(id) {
  const info = state.graph.roles?.[id];
  if (!info) return null;
  if (info.role === 'middleware' && info.global) return t('nuxt.role.middleware.global', { name: info.name });
  const key = `nuxt.role.${info.role}`;
  const label = t(key, { name: info.name ?? '' });
  return label === key ? null : label;
}

/** "Root layout", "Layout of /dashboard", "Page /checkout"… */
export function roleLabel(id) {
  const g = state.graph;
  const role = roleOf(id);
  const roles = state.roles.get(id) ?? [];
  if (isNuxt()) {
    const label = nuxtRoleLabel(id);
    if (label) return label;
  }
  if (role === 'layout' || role === 'template') {
    const segment = segmentOf(id);
    if (!segment) return t('route.layout.root');
    return t(role === 'layout' ? 'route.layout.of' : 'route.template.of', { segment });
  }
  if (roles.some((r) => r.role === 'page' || r.role === 'default' || r.role === 'api')) {
    const route = roles.find((r) => r.role === 'page' || r.role === 'default' || r.role === 'api').route;
    const label = `${t(`role.${roles[0].role}`)} ${routeLabel(route)}`;
    return label.charAt(0).toUpperCase() + label.slice(1);
  }
  const raw = t(`role.${role}`);
  const label = raw.charAt(0).toUpperCase() + raw.slice(1);
  const segment = g.appDir && id.startsWith(g.appDir) ? segmentOf(id) : '';
  return segment ? `${label} (${segment})` : label;
}

/** URL-ish segment of an app/ file: `src/app/(shop)/layout.tsx` -> "(shop)", `src/app/dashboard/x` -> "/dashboard". */
export function segmentOf(id) {
  const g = state.graph;
  if (!g.appDir || !id.startsWith(g.appDir + '/')) return '';
  const parts = dirname(id).slice(g.appDir.length).split('/').filter(Boolean);
  if (parts.length === 0) return '';
  const url = parts.filter((p) => !/^\(.*\)$/.test(p) && !p.startsWith('@'));
  const last = parts[parts.length - 1];
  if (/^\(.*\)$/.test(last)) return t('route.group', { name: last });
  if (last.startsWith('@')) return last;
  return '/' + url.join('/');
}

// ------------------------------------------------------------------ risk

/** A page is a URL: slots (@analytics) and default.tsx belong to their page, API routes are not pages. */
export const pageKey = (r) => `${r.router}:${r.path}`;

/** Distinct pages among routes, keeping the main route (no slot, kind page) of each URL. */
export function uniquePages(routes, getRoute = (r) => r) {
  const byKey = new Map();
  for (const item of routes) {
    const r = getRoute(item);
    if (r.kind === 'api') continue;
    const current = byKey.get(pageKey(r));
    const isMain = !r.slot && r.kind === 'page';
    if (!current || (isMain && (getRoute(current).slot || getRoute(current).kind !== 'page'))) byKey.set(pageKey(r), item);
  }
  return [...byKey.values()];
}

export function renderedRoutes() {
  return uniquePages(state.graph.routes).length || 1;
}
export function riskOf(pages) {
  const total = renderedRoutes();
  if (pages === 0) return 'none';
  const ratio = pages / total;
  if (ratio >= 0.5) return 'high';
  if (ratio >= 0.2) return 'medium';
  return 'low';
}
export function riskBadge(pages) {
  const risk = riskOf(pages);
  return h('span', { class: `risk risk-${risk}`, title: t('risk.help') }, h('i'), t(`risk.${risk}`));
}

/** "7 / 9" with a thin bar coloured by impact level. */
export function coverage(pages) {
  const total = renderedRoutes();
  const risk = riskOf(pages);
  return h(
    'span',
    { class: 'coverage', title: `${Math.round((pages / total) * 100)} % — ${t(`risk.${risk}`)}` },
    h('span', { class: 'bar' }, h('span', { class: `fill risk-${risk}`, style: `width:${(pages / total) * 100}%` })),
    h('span', { class: 'num' }, pages, h('span', { class: 'muted' }, ` / ${total}`)),
  );
}

/** Key figure: label, value, optional detail line. */
export function kpi(label, value, { sub, href, tone = '', help } = {}) {
  const content = [h('div', { class: 'kpi-label' }, label, help && [' ', helpIcon(help)]), h('div', { class: `kpi-value ${tone}` }, value), sub && h('div', { class: 'kpi-sub' }, sub)];
  return href ? h('a', { class: 'kpi', href }, content) : h('div', { class: 'kpi' }, content);
}

/** Panel with a header (title, count, help, actions) and a body. */
export function panel({ title, count, help, actions, flush = false, id }, ...body) {
  return h(
    'section',
    { class: 'panel', id },
    title && h('header', { class: 'panel-head' }, h('h2', null, title, count != null && h('span', { class: 'count' }, count), help && helpIcon(help)), actions && h('div', { class: 'panel-actions' }, actions)),
    h('div', { class: `panel-body ${flush ? 'flush' : ''}` }, body),
  );
}

export function emptyRow(colspan, text) {
  return h('tr', null, h('td', { colspan, class: 'empty' }, text));
}

// ------------------------------------------------------------------ badges & links

export function helpIcon(term) {
  return h('a', { class: 'help-icon', href: helpHref(term), title: glossaryText(term), 'aria-label': glossaryText(term) || '?' }, 'i');
}
let glossaryCache = null;
export function setGlossary(glossary) {
  glossaryCache = glossary;
}
function glossaryText(term) {
  const entry = glossaryCache?.[getLang()]?.find(([id]) => id === term);
  return entry ? `${entry[1]} — ${entry[2]}` : '';
}

export function clientBadge(isClient) {
  // Nuxt renders components on the server then hydrates them (universal), unless they are .client.vue.
  if (universalRendering()) {
    return isClient
      ? h('span', { class: 'chip client', title: t(isNuxt() ? 'badge.client.tip.nuxt' : 'badge.client.tip') }, t('badge.client'))
      : h('span', { class: 'chip server', title: t('badge.universal.tip') }, t('badge.universal'));
  }
  return isClient
    ? h('span', { class: 'chip client', title: t('badge.client.tip') }, t('badge.client'))
    : h('span', { class: 'chip server', title: t('badge.server.tip') }, t('badge.server'));
}

/** Absolute path of a project file, `..` resolved: /app/../shared/x.vue -> /shared/x.vue. */
function absolutePath(id) {
  const out = [];
  for (const part of `${state.graph.root}/${id}`.split('/')) {
    if (part === '..') out.pop();
    else if (part !== '.') out.push(part);
  }
  return out.join('/');
}

export function editorHref(id, line = 1) {
  const abs = absolutePath(id);
  const enc = encodeURI(abs);
  switch (state.config.editor) {
    case 'none':
      return null;
    case 'cursor':
      return `cursor://file${enc}:${line}`;
    case 'zed':
      return `zed://file${enc}:${line}`;
    case 'webstorm':
      return `webstorm://open?file=${encodeURIComponent(abs)}&line=${line}`;
    case 'idea':
      return `idea://open?file=${encodeURIComponent(abs)}&line=${line}`;
    default:
      return `vscode://file${enc}:${line}`;
  }
}
export function editorLink(id, line, { label } = {}) {
  const href = editorHref(id, line);
  if (!href) return null;
  const text = label ?? t('common.openEditor');
  return h('a', { class: `editor-link ${text ? '' : 'icon-only'}`, href, title: `${t('common.openEditor')} — ${id}${line ? `:${line}` : ''}`, 'aria-label': t('common.openEditor') }, h('span', { class: 'ico', 'aria-hidden': 'true' }, '↗'), text);
}

/** File path line: folder dim + name, linking to the file page. */
export function filePath(id, { line } = {}) {
  return h(
    'span',
    { class: 'path' },
    h('span', { class: 'dir' }, folderOf(id) ? `${folderOf(id)}/` : ''),
    h('a', { href: fileHref(id) }, basename(id)),
    line && h('span', { class: 'muted' }, `:${line}`),
  );
}

export function componentTag(component, { href = true } = {}) {
  const content = [h('span', { class: 'lt' }, '<'), component.name, h('span', { class: 'lt' }, ' />')];
  return href ? h('a', { class: 'ctag', href: componentHref(component.id) }, content) : h('span', { class: 'ctag' }, content);
}

/** `<BaseButton variant="primary" :size="s" @click="go" />`: Vue template syntax. */
function vueSnippet(tag, props) {
  const parts = [h('span', { class: 'tk-punct' }, '<'), h('span', { class: 'tk-tag' }, tag)];
  const attr = (name, value, cls) => [h('span', { class: 'tk-attr' }, name), h('span', { class: 'tk-punct' }, '="'), h('span', { class: cls }, value), h('span', { class: 'tk-punct' }, '"')];
  for (const p of props) {
    if (p.name === 'key') continue;
    parts.push(' ');
    if (p.kind === 'spread') parts.push(attr('v-bind', p.value, 'tk-expr'));
    else if (p.kind === 'literal' && p.type === 'boolean' && p.value === 'true') parts.push(h('span', { class: 'tk-attr' }, p.name));
    else if (p.kind === 'literal' && p.type === 'string') parts.push(attr(p.name, p.value, 'tk-string'));
    else if (p.kind === 'literal') parts.push(attr(`:${p.name}`, p.value, 'tk-number'));
    else if (p.name.startsWith('v-')) parts.push(attr(p.name, p.value, 'tk-expr'));
    else if (/^on[A-Z]/.test(p.name)) parts.push(attr(`@${p.name.charAt(2).toLowerCase()}${p.name.slice(3).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, p.value, 'tk-expr'));
    else parts.push(attr(`:${p.name}`, p.value, 'tk-expr'));
  }
  parts.push(h('span', { class: 'tk-punct' }, ' />'));
  return h('code', { class: 'jsx' }, parts);
}

/** `<Button variant="primary" size="sm" />` with syntax colors (Vue template syntax for Nuxt). */
export function jsxSnippet(tag, props) {
  if (isNuxt()) return vueSnippet(tag, props);
  const parts = [h('span', { class: 'tk-punct' }, '<'), h('span', { class: 'tk-tag' }, tag)];
  for (const p of props) {
    if (p.name === 'children' || p.name === 'key') continue;
    parts.push(' ');
    if (p.kind === 'spread') {
      parts.push(h('span', { class: 'tk-punct' }, '{...'), h('span', { class: 'tk-expr' }, p.value), h('span', { class: 'tk-punct' }, '}'));
      continue;
    }
    parts.push(h('span', { class: 'tk-attr' }, p.name));
    if (p.kind === 'literal' && p.type === 'boolean' && p.value === 'true') continue; // <X disabled />
    parts.push(h('span', { class: 'tk-punct' }, '='));
    if (p.kind === 'literal' && p.type === 'string') parts.push(h('span', { class: 'tk-string' }, `"${p.value}"`));
    else parts.push(h('span', { class: 'tk-punct' }, '{'), h('span', { class: p.kind === 'literal' ? 'tk-number' : 'tk-expr' }, p.value), h('span', { class: 'tk-punct' }, '}'));
  }
  parts.push(h('span', { class: 'tk-punct' }, ' />'));
  return h('code', { class: 'jsx' }, parts);
}

// ------------------------------------------------------------------ data

export async function fetchJson(url) {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data;
}

export async function loadGraph() {
  try {
    const data = await fetchJson('/api/graph');
    state.graph = data.graph;
    state.version = data.version;
    state.analyzedAt = data.analyzedAt;
    state.configError = data.configError ?? null;
    state.error = null;
    state.componentRanking = null;
    state.moduleRanking = null;
    indexGraph();
  } catch (error) {
    state.error = error.message;
  }
}

function indexGraph() {
  state.roles = new Map();
  const add = (id, role, route) => {
    const list = state.roles.get(id) ?? [];
    list.push({ role, route });
    state.roles.set(id, list);
  };
  for (const route of state.graph.routes) {
    add(route.file, route.kind, route);
    for (const w of route.wrappers) add(w, roleOf(w), route);
  }
  state.componentsByModule = new Map();
  for (const c of Object.values(state.graph.components)) {
    const list = state.componentsByModule.get(c.module) ?? [];
    list.push(c);
    state.componentsByModule.set(c.module, list);
  }
}

export async function loadModuleRanking() {
  state.moduleRanking ??= await fetchJson('/api/ranking');
  return state.moduleRanking;
}

export async function loadComponentRanking() {
  state.componentRanking ??= await fetchJson('/api/components/ranking');
  return state.componentRanking;
}

/** Ranking entry of a component (routes impacted, usages, files). */
export function rankOf(id) {
  return state.componentRanking?.find((r) => r.id === id);
}

export const isBarrel = (mod) => mod?.category === 'barrel';
