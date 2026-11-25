// Impact map: pages on the left, the changed file on the right, one column per step.
// Inline in the page (static) or fullscreen (zoom, pan, draggable nodes) for large graphs.
import { h, isBarrel, moduleHref, moduleLabel, navigate, routeHref, routeKey, routeLabel, state, svg, uniquePages } from './core.js';
import { t } from './i18n.js';

const NODE_W = 210;
const NODE_H = 32;
const GAP_X = 64;
const GAP_Y = 10;
const PAD = 16;
const HEADER = 28;
/** A step with more boxes than this is spread over several sub-columns (keeps large graphs readable). */
const MAX_ROWS = 18;
const GAP_SUB = 16;
/** Inline graphs above this size are only drawn fullscreen. */
const MAX_INLINE_NODES = 220;
const MAX_NODES = 4000;

/** Removes index files (barrels) from the edges: A -> index -> B becomes A -> B. */
function collapseBarrels(edges, targets) {
  let current = edges;
  for (const id of new Set(edges.flatMap((e) => [e.from, e.to]))) {
    if (targets.has(id) || !isBarrel(state.graph.modules[id])) continue;
    const incoming = current.filter((e) => e.to === id);
    const outgoing = current.filter((e) => e.from === id);
    const rest = current.filter((e) => e.to !== id && e.from !== id);
    const bridged = incoming.flatMap((i) => outgoing.map((o) => ({ from: i.from, to: o.to })));
    const seen = new Set(rest.map((e) => `${e.from}>${e.to}`));
    current = [...rest, ...bridged.filter((e) => !seen.has(`${e.from}>${e.to}`) && seen.add(`${e.from}>${e.to}`))];
  }
  return current;
}

/** Nodes, edges and initial positions (columns by distance to the changed file). */
function layout(result, changedLabel) {
  const targets = new Set(result.targets);
  const edges = collapseBarrels(result.edges, targets).map((e) => ({ ...e, kind: '' }));

  // Column = number of steps to the changed file (0 = the file itself, on the right).
  const level = new Map(result.targets.map((id) => [id, 0]));
  const importersOf = new Map();
  for (const e of edges) {
    if (!importersOf.has(e.to)) importersOf.set(e.to, []);
    importersOf.get(e.to).push(e.from);
  }
  const queue = [...result.targets];
  for (let i = 0; i < queue.length; i++) {
    for (const from of importersOf.get(queue[i]) ?? []) {
      if (!level.has(from)) {
        level.set(from, level.get(queue[i]) + 1);
        queue.push(from);
      }
    }
  }

  const routeNodes = uniquePages(result.routes, (r) => r.route).map(({ route, entry }) => ({ key: `route:${routeKey(route)}`, route, entry }));
  for (const r of routeNodes) edges.push({ from: r.key, to: r.entry, kind: 'entry' });

  const maxLevel = Math.max(0, ...level.values());
  const routeCol = maxLevel + 1;
  const columns = Array.from({ length: routeCol + 1 }, () => []);
  for (const [id, l] of level) columns[l].push(id);
  columns[routeCol] = routeNodes.map((r) => r.key);

  const outgoing = new Map();
  for (const e of edges) {
    if (!outgoing.has(e.from)) outgoing.set(e.from, []);
    outgoing.get(e.from).push(e.to);
  }

  // Each step (column) is split into sub-columns of at most MAX_ROWS boxes.
  const subCount = columns.map((col) => Math.max(1, Math.ceil(col.length / MAX_ROWS)));
  const rowsOf = (l) => Math.ceil(columns[l].length / subCount[l]);
  const rows = Math.max(1, ...columns.map((_, l) => rowsOf(l)));
  const colX = [];
  let cursor = PAD;
  // Pages (highest step) on the left, the changed file on the right.
  for (let l = routeCol; l >= 0; l--) {
    colX[l] = cursor;
    cursor += subCount[l] * NODE_W + (subCount[l] - 1) * GAP_SUB + GAP_X;
  }
  const width = cursor - GAP_X + PAD;
  const height = PAD * 2 + HEADER + rows * (NODE_H + GAP_Y) - GAP_Y;
  const pos = new Map();
  // Order each column by the mean y of what it points to: fewer crossings.
  columns.forEach((col, l) => {
    if (l > 0) {
      const score = (id) => {
        const ys = (outgoing.get(id) ?? []).map((to) => pos.get(to)?.y).filter((y) => y != null);
        return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : Infinity;
      };
      col.sort((a, b) => score(a) - score(b) || a.localeCompare(b));
    }
    const perSub = rowsOf(l);
    const offset = ((rows - perSub) * (NODE_H + GAP_Y)) / 2;
    col.forEach((id, i) => {
      const sub = Math.floor(i / perSub);
      const row = i % perSub;
      pos.set(id, { x: colX[l] + sub * (NODE_W + GAP_SUB), y: PAD + HEADER + offset + row * (NODE_H + GAP_Y) });
    });
  });

  const nodes = [];
  for (const [id] of level) {
    const mod = state.graph.modules[id];
    nodes.push({
      key: id,
      label: targets.has(id) && changedLabel ? changedLabel : moduleLabel(id),
      title: id,
      classes: [targets.has(id) && 'target', mod?.client && 'client'].filter(Boolean).join(' '),
      href: moduleHref(id),
    });
  }
  for (const r of routeNodes) {
    nodes.push({ key: r.key, label: routeLabel(r.route), title: `${t(`router.${r.route.router}`)} — ${r.route.file}`, classes: 'route', href: routeHref(r.route) });
  }

  const titles = columns.map((_, l) => ({
    x: colX[l],
    text: l === routeCol ? t('map.routes') : l === 0 ? t('map.changed') : l === 1 ? t('map.direct') : t('map.indirect', { n: l }),
  }));
  return { nodes, edges, pos, width, height, titles };
}

/** Cubic path from the right side of `a` to the left side of `b` (or a loop when `b` is not on the right). */
function edgePath(a, b) {
  const x1 = a.x + NODE_W;
  const y1 = a.y + NODE_H / 2;
  if (b.x > x1) {
    const y2 = b.y + NODE_H / 2;
    const mid = (x1 + b.x) / 2;
    return `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${b.x},${y2}`;
  }
  const x2 = b.x + NODE_W;
  const y2 = b.y + NODE_H / 2;
  const bulge = Math.max(x1, x2) + GAP_X * 0.6;
  return `M${x1},${y1} C${bulge},${y1} ${bulge},${y2} ${x2},${y2}`;
}

/**
 * Draws a layout into an SVG group. Returns helpers to move nodes and highlight links.
 * `interactive`: nodes can be dragged (pointer), a click selects, a double click opens.
 */
function draw(model, root, { interactive = false, onNodeMoved } = {}) {
  const edgesLayer = svg('g');
  const nodesLayer = svg('g');
  for (const title of model.titles) {
    const text = svg('text', { x: title.x, y: PAD + 10, class: 'col-title' });
    text.textContent = title.text;
    root.append(text);
  }
  root.append(edgesLayer, nodesLayer);

  const edgeEls = new Map(); // node key -> path elements touching it
  const paths = model.edges.map((e) => {
    const a = model.pos.get(e.from);
    const b = model.pos.get(e.to);
    if (!a || !b) return null;
    const path = svg('path', { d: edgePath(a, b), class: `edge ${e.kind}`, 'data-from': e.from, 'data-to': e.to });
    edgesLayer.append(path);
    for (const key of [e.from, e.to]) (edgeEls.get(key) ?? edgeEls.set(key, []).get(key)).push({ path, e });
    return path;
  });

  let pinned = null;
  const highlight = (key, on) => {
    const svgRoot = root.ownerSVGElement ?? root;
    svgRoot.classList.toggle('hovering', on);
    for (const path of paths) if (path) path.classList.toggle('hot', on && (path.dataset.from === key || path.dataset.to === key));
    for (const g of nodesLayer.children) g.classList.toggle('linked', on && (g.dataset.key === key || (edgeEls.get(key) ?? []).some(({ e }) => e.from === g.dataset.key || e.to === g.dataset.key)));
  };

  const moveNode = (key, group) => {
    const p = model.pos.get(key);
    group.setAttribute('transform', `translate(${p.x},${p.y})`);
    for (const { path, e } of edgeEls.get(key) ?? []) path.setAttribute('d', edgePath(model.pos.get(e.from), model.pos.get(e.to)));
  };

  for (const node of model.nodes) {
    const p = model.pos.get(node.key);
    const group = svg('g', { class: `node ${node.classes}`, transform: `translate(${p.x},${p.y})`, tabindex: 0, role: 'link', 'data-key': node.key });
    const tip = svg('title');
    tip.textContent = node.title;
    const text = svg('text', { x: 10, y: NODE_H / 2 + 4 });
    text.textContent = node.label.length > 27 ? `${node.label.slice(0, 26)}…` : node.label;
    group.append(tip, svg('rect', { width: NODE_W, height: NODE_H, rx: 7 }), text);
    group.addEventListener('keydown', (e) => e.key === 'Enter' && navigate(node.href));
    group.addEventListener('mouseenter', () => pinned == null && highlight(node.key, true));
    group.addEventListener('mouseleave', () => pinned == null && highlight(node.key, false));

    if (!interactive) {
      group.addEventListener('click', () => navigate(node.href));
    } else {
      // Drag to move; click without moving pins the highlight; double click opens the element.
      group.addEventListener('pointerdown', (down) => {
        if (down.button !== 0) return;
        down.stopPropagation();
        down.preventDefault();
        const start = { x: p.x, y: p.y, cx: down.clientX, cy: down.clientY };
        const scale = onNodeMoved?.scale?.() ?? 1;
        let moved = false;
        const move = (e) => {
          const dx = (e.clientX - start.cx) / scale;
          const dy = (e.clientY - start.cy) / scale;
          if (!moved && Math.hypot(dx, dy) < 3) return;
          moved = true;
          p.x = start.x + dx;
          p.y = start.y + dy;
          moveNode(node.key, group);
        };
        // Listen on the window: the pointer may leave the box during a fast drag.
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          group.classList.remove('dragging');
          if (!moved) {
            pinned = pinned === node.key ? null : node.key;
            highlight(node.key, pinned != null);
          }
        };
        group.classList.add('dragging');
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      });
      group.addEventListener('dblclick', () => navigate(node.href));
    }
    nodesLayer.append(group);
  }

  return {
    clearPin: () => {
      pinned = null;
      highlight('', false);
    },
  };
}

function legend() {
  return h(
    'div',
    { class: 'legend' },
    h('span', null, h('i', { class: 'route' }), t('map.legend.route')),
    h('span', null, h('i', { class: 'target' }), t('map.legend.changed')),
    h('span', null, h('i', { class: 'client' }), t('map.legend.client')),
    h('span', null, h('i', { class: 'entry' }), t('map.legend.entry')),
  );
}

// ------------------------------------------------------------------ fullscreen

function openFullscreen(result, changedLabel, title) {
  const model = layout(result, changedLabel);
  const view = { x: 0, y: 0, scale: 1 };
  const viewport = svg('g', { class: 'viewport' });
  const root = svg('svg', { class: 'diagram diagram-full', role: 'img' });
  root.append(viewport);
  const apply = () => viewport.setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.scale})`);
  const drawn = draw(model, viewport, { interactive: true, onNodeMoved: { scale: () => view.scale } });
  const initial = new Map([...model.pos].map(([k, p]) => [k, { ...p }]));

  const fit = () => {
    const box = root.getBoundingClientRect();
    const xs = [...model.pos.values()];
    const minX = Math.min(...xs.map((p) => p.x)) - PAD;
    const minY = Math.min(PAD, ...xs.map((p) => p.y)) - PAD;
    const maxX = Math.max(...xs.map((p) => p.x + NODE_W)) + PAD;
    const maxY = Math.max(...xs.map((p) => p.y + NODE_H)) + PAD;
    view.scale = Math.min(box.width / (maxX - minX), box.height / (maxY - minY), 1.5);
    view.x = (box.width - (maxX - minX) * view.scale) / 2 - minX * view.scale;
    view.y = (box.height - (maxY - minY) * view.scale) / 2 - minY * view.scale;
    apply();
  };
  const zoomAt = (factor, cx, cy) => {
    const scale = Math.min(4, Math.max(0.05, view.scale * factor));
    view.x = cx - ((cx - view.x) * scale) / view.scale;
    view.y = cy - ((cy - view.y) * scale) / view.scale;
    view.scale = scale;
    apply();
  };
  const zoomCenter = (factor) => {
    const box = root.getBoundingClientRect();
    zoomAt(factor, box.width / 2, box.height / 2);
  };
  const reset = () => {
    for (const [k, p] of initial) Object.assign(model.pos.get(k), p);
    viewport.replaceChildren();
    Object.assign(drawn, draw(model, viewport, { interactive: true, onNodeMoved: { scale: () => view.scale } }));
    fit();
  };

  // Pan: drag the background. Zoom: wheel / pinch (ctrl+wheel), around the cursor.
  root.addEventListener('pointerdown', (down) => {
    if (down.button !== 0) return;
    drawn.clearPin();
    down.preventDefault();
    const start = { x: view.x, y: view.y, cx: down.clientX, cy: down.clientY };
    root.classList.add('panning');
    const move = (e) => {
      view.x = start.x + e.clientX - start.cx;
      view.y = start.y + e.clientY - start.cy;
      apply();
    };
    const up = () => {
      root.classList.remove('panning');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
  root.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const box = root.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - box.left, e.clientY - box.top);
    },
    { passive: false },
  );

  const close = () => {
    overlay.remove();
    sized.disconnect();
    const url = new URL(location.href);
    if (url.searchParams.has('full')) {
      url.searchParams.delete('full');
      history.replaceState(null, '', url.pathname + url.search);
    }
    document.body.classList.remove('no-scroll');
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === '+' || e.key === '=') zoomCenter(1.2);
    else if (e.key === '-') zoomCenter(1 / 1.2);
    else if (e.key === '0') fit();
  };
  const button = (label, onclick, title) => h('button', { class: 'button small', type: 'button', onclick, title }, label);
  const overlay = h(
    'div',
    { class: 'diagram-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h(
      'header',
      { class: 'diagram-overlay-head' },
      h('strong', null, title),
      h('span', { class: 'muted small' }, t('map.full.hint')),
      h('span', { class: 'spacer' }),
      button('−', () => zoomCenter(1 / 1.2), t('map.full.zoomOut')),
      button('+', () => zoomCenter(1.2), t('map.full.zoomIn')),
      button(t('map.full.fit'), fit, '0'),
      button(t('map.full.reset'), reset),
      button(`✕ ${t('map.full.close')}`, close, 'Esc'),
    ),
    h('div', { class: 'diagram-overlay-body' }, root),
    h('footer', { class: 'diagram-overlay-foot' }, legend(), h('span', { class: 'muted small' }, t('map.full.count', { nodes: model.nodes.length, edges: model.edges.length }))),
  );
  document.body.append(overlay);
  document.body.classList.add('no-scroll');
  document.addEventListener('keydown', onKey);
  // Closing the overlay when navigating (double click on a node).
  window.addEventListener('app:navigate', close, { once: true });
  // Fit as soon as the drawing area has its real size (not before the overlay is laid out).
  const sized = new ResizeObserver((entries) => {
    if (entries.some((e) => e.contentRect.width > 0 && e.contentRect.height > 0)) {
      sized.disconnect();
      fit();
    }
  });
  sized.observe(root);
}

// ------------------------------------------------------------------ inline

/** @param result impact result ({ targets, edges, routes }) */
export function renderDiagram(result, { changedLabel, title = changedLabel ?? '', fullscreen = false } = {}) {
  const model = layout(result, changedLabel);
  const total = model.nodes.length;
  if (total > MAX_NODES) return h('p', { class: 'muted' }, t('component.map.tooBig', { n: total }));

  const expand = h('button', { class: 'button small', type: 'button', onclick: () => openFullscreen(result, changedLabel, title) }, '⤢ ', t('map.full.open'));
  // ?full=1 opens the fullscreen view directly (shareable link).
  if (fullscreen) requestAnimationFrame(() => openFullscreen(result, changedLabel, title));
  const toolbar = h('div', { class: 'diagram-toolbar' }, h('span', { class: 'muted small' }, t('map.full.count', { nodes: total, edges: model.edges.length })), h('span', { class: 'spacer' }), expand);

  if (total > MAX_INLINE_NODES) {
    return h('div', null, toolbar, h('div', { class: 'note' }, t('map.full.tooBigInline', { n: total })));
  }

  const root = svg('svg', {
    class: 'diagram',
    viewBox: `0 0 ${model.width} ${model.height}`,
    style: `width:100%;max-width:${model.width}px;min-width:${Math.round(model.width * 0.65)}px;height:auto`,
    role: 'img',
  });
  draw(model, root);
  return h('div', null, toolbar, h('div', { class: 'diagram-wrap' }, root), legend());
}
