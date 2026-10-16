(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else api.initialize(root);
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const colors = {
    'expand-pre-training': '#c62845', 'bootstrap-post-training': '#2876b7',
    'scale-up-post-training': '#4d8339', 'diversify-post-training': '#8c564b',
    'refine-both-stages': '#b65b00', 'neither-stage-eligible': '#657581', other: '#657581',
  };
  const requireValue = (condition, message) => { if (!condition) throw new Error(message); };

  function parsePoints(raw, catalog) {
    requireValue(raw.data_version === catalog.manifest.data_version, 'Plot and language index versions differ.');
    requireValue(Array.isArray(raw.points) && raw.points.length > 0, 'Missing plot coordinates.');
    const seen = new Set();
    return raw.points.map(([code, x, y, jitter]) => {
      const row = catalog.byCode.get(code);
      requireValue(row && !seen.has(code), 'Unknown or duplicate plot language.');
      seen.add(code);
      requireValue(row.pretrain.cluster >= 0 && Number.isFinite(x) && Math.abs(x - Math.log10(row.pretrain.quantity)) < 1e-9,
        `${code}: plot NCC does not match the index.`);
      requireValue(row.posttrain.cluster === -1
        ? y === null && Number.isFinite(jitter) && jitter >= 0 && jitter <= 1
        : Number.isFinite(y) && Math.abs(y - Math.log10(row.posttrain.quantity)) < 1e-9,
      `${code}: plot post-training quantity does not match the index.`);
      return { code, row, x, y, jitter };
    });
  }

  function layoutPoints(points) {
    const xMax = Math.max(1, Math.ceil(Math.max(...points.map(point => point.x))));
    const measured = points.filter(point => point.y !== null);
    const yMin = Math.min(0, Math.floor(Math.min(...measured.map(point => point.y))));
    const yMax = Math.max(1, Math.ceil(Math.max(...measured.map(point => point.y))));
    const xPosition = x => 90 + 880 * x / xMax;
    const yPosition = y => 340 - 310 * (y - yMin) / (yMax - yMin);
    return { xMax, yMin, yMax, xPosition, yPosition, points: points.map(point => ({
      ...point, cx: xPosition(point.x), cy: point.y === null ? 390 + point.jitter * 38 : yPosition(point.y),
    })) };
  }

  function nearbyPoints(points, target, radius) {
    return points.filter(point => Math.hypot(point.cx - target.cx, point.cy - target.cy) <= radius)
      .sort((a, b) => Math.hypot(a.cx - target.cx, a.cy - target.cy) - Math.hypot(b.cx - target.cx, b.cy - target.cy) || a.code.localeCompare(b.code));
  }

  function initialize(window) {
    const document = window.document;
    const host = document.getElementById('resource-profile-chart');
    if (!host || !window.MappData || !window.MappExplorer) return;
    const svg = document.getElementById('profile-chart-svg');
    const legend = document.getElementById('profile-chart-legend');
    const status = document.getElementById('profile-chart-status');
    const picker = document.getElementById('profile-point-picker');
    const errorBox = document.getElementById('profile-chart-error');
    const paper = document.getElementById('profile-paper-figure');
    let layout, catalog, selectedCodes = new Set(), currentFilters = {}, focusCode;
    const circles = new Map(), legendButtons = new Map();
    const element = (tag, text, className) => {
      const item = document.createElement(tag);
      if (text !== undefined) item.textContent = text;
      if (className) item.className = className;
      return item;
    };
    const shape = (tag, attributes, text) => {
      const item = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [key, value] of Object.entries(attributes)) item.setAttribute(key, String(value));
      if (text !== undefined) item.textContent = text;
      return item;
    };
    function focusPoint(code, moveFocus = false) {
      if (focusCode) circles.get(focusCode)?.setAttribute('tabindex', '-1');
      focusCode = code;
      circles.get(code)?.setAttribute('tabindex', '0');
      if (moveFocus) circles.get(code)?.focus();
    }
    function openPoint(point, chooseNearby) {
      focusPoint(point.code);
      if (!chooseNearby) { window.MappExplorer.openDetails(point.code); return; }
      const radius = 7 * 1000 / Math.max(1, svg.getBoundingClientRect().width);
      const pool = selectedCodes.has(point.code) ? layout.points.filter(item => selectedCodes.has(item.code)) : layout.points;
      const nearby = nearbyPoints(pool, point, radius);
      if (nearby.length === 1) { window.MappExplorer.openDetails(point.code); return; }
      picker.replaceChildren();
      picker.hidden = false;
      const heading = element('p', `${nearby.length.toLocaleString('en-US')} nearby or overlapping languages — choose one to open details.`);
      const close = element('button', 'Close selection');
      close.type = 'button';
      close.addEventListener('click', () => { picker.hidden = true; focusPoint(point.code, true); });
      const header = element('div', undefined, 'profile-point-picker-header');
      header.append(heading, close);
      const list = element('div', undefined, 'profile-point-options');
      for (const item of nearby) {
        const button = element('button', `${item.row.name} (${item.code})`);
        button.type = 'button';
        button.addEventListener('click', () => window.MappExplorer.openDetails(item.code));
        list.append(button);
      }
      picker.append(header, list);
      list.children[0]?.focus({ preventScroll: true });
      picker.scrollIntoView({ block: 'nearest' });
    }
    function update(detail) {
      if (!layout) return;
      selectedCodes = new Set(detail.codes);
      currentFilters = detail.filters;
      const filtering = Object.values(currentFilters).some(value => String(value).trim() !== '');
      let highlighted = 0;
      for (const point of layout.points) {
        const matches = selectedCodes.has(point.code);
        const circle = circles.get(point.code);
        circle.setAttribute('opacity', !filtering || matches ? '0.8' : '0.08');
        circle.setAttribute('r', filtering && matches ? '4.2' : '3.2');
        circle.style.pointerEvents = filtering && !matches ? 'none' : 'auto';
        circle.setAttribute('aria-disabled', String(filtering && !matches));
        circle.dataset.matching = String(matches);
        if (matches) highlighted++;
      }
      for (const [id, button] of legendButtons) button.setAttribute('aria-pressed', String(currentFilters.regime === id));
      const available = layout.points.filter(point => selectedCodes.has(point.code));
      if (!available.some(point => point.code === focusCode)) focusPoint(available[0]?.code);
      const missing = detail.codes.length - highlighted;
      status.textContent = `${highlighted.toLocaleString('en-US')} matching languages in the plot · ${detail.codes.length.toLocaleString('en-US')} in the table.` +
        (missing ? ` ${missing.toLocaleString('en-US')} matching languages have no plotted point in the paper snapshot; they remain available in the table.` : '');
      picker.hidden = true;
    }
    function draw() {
      svg.replaceChildren();
      svg.append(shape('rect', { x: 90, y: 380, width: 880, height: 58, fill: '#f0f4f7', rx: 6 }));
      for (let x = 0; x <= layout.xMax; x += 2) {
        const cx = layout.xPosition(x);
        svg.append(shape('line', { x1: cx, x2: cx, y1: 30, y2: 438, class: 'profile-gridline' }));
        svg.append(shape('text', { x: cx, y: 460, 'text-anchor': 'middle' }, String(x)));
      }
      for (let y = layout.yMin; y <= layout.yMax; y += 2) {
        const cy = layout.yPosition(y);
        svg.append(shape('line', { x1: 90, x2: 970, y1: cy, y2: cy, class: 'profile-gridline' }));
        svg.append(shape('text', { x: 77, y: cy + 5, 'text-anchor': 'end' }, String(y)));
      }
      svg.append(shape('text', { x: 530, y: 491, 'text-anchor': 'middle' }, 'Pre-training log(Q)'));
      svg.append(shape('text', { transform: 'translate(23 187) rotate(-90)', 'text-anchor': 'middle' }, 'Post-training log(Q)'));
      svg.append(shape('text', { x: 90, y: 369, class: 'profile-strip-label' }, 'No usable post-training quantity (categorical strip)'));
      for (const point of layout.points) {
        const label = `${point.row.name} (${point.code}) · ${window.MappData.regimeNames[point.row.regime] || point.row.regime}`;
        const circle = shape('circle', { cx: point.cx, cy: point.cy, r: 3.2,
          fill: colors[point.row.regime] || colors.other, class: 'profile-point', role: 'button', tabindex: '-1', 'aria-label': `Open details: ${label}`, 'aria-haspopup': 'dialog' });
        circle.dataset.code = point.code;
        circle.append(shape('title', {}, `${label}\nNCC: ${window.MappData.formatQuantity(point.row.pretrain.quantity)}\nPost-training: ${window.MappData.formatQuantity(point.row.posttrain.quantity)}`));
        circle.addEventListener('click', () => openPoint(point, true));
        circle.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openPoint(point, false); return; }
          if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const available = layout.points.filter(item => selectedCodes.has(item.code));
          if (!available.length) return;
          let next = available.findIndex(item => item.code === point.code);
          if (event.key === 'Home') next = 0;
          else if (event.key === 'End') next = available.length - 1;
          else next = (next + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) + available.length) % available.length;
          focusPoint(available[next].code, true);
        });
        circles.set(point.code, circle);
        svg.append(circle);
      }
      legend.replaceChildren();
      for (const group of catalog.clusters.regimes.filter(group => group.n_languages > 0)) {
        const button = element('button', undefined, 'profile-legend-button');
        button.type = 'button';
        button.setAttribute('aria-pressed', 'false');
        button.setAttribute('aria-controls', 'profile-chart-svg language-explorer');
        const swatch = element('span', undefined, 'profile-swatch');
        swatch.style.backgroundColor = colors[group.id] || colors.other;
        swatch.setAttribute('aria-hidden', 'true');
        button.append(swatch, `${window.MappData.regimeNames[group.id] || group.name} (${group.n_languages.toLocaleString('en-US')} languages)`);
        button.addEventListener('click', () => window.MappExplorer.select({ regime: group.id }, { scroll: false }));
        legendButtons.set(group.id, button);
        legend.append(button);
      }
    }
    async function load() {
      errorBox.hidden = true;
      try {
        catalog = await window.MappData.loadCatalog();
        layout = layoutPoints(parsePoints(await window.MappData.loadPlotPoints(), catalog));
        draw();
        update(window.MappExplorer.getState());
        host.hidden = false;
        paper.open = false;
      } catch (error) {
        host.hidden = true;
        paper.open = true;
        errorBox.hidden = false;
        const retry = element('button', 'Retry interactive plot');
        retry.type = 'button';
        retry.addEventListener('click', load);
        errorBox.replaceChildren('The interactive plot is unavailable. The paper preview and language table remain available. ', retry);
        console.error('Resource plot failed', error);
      }
    }
    document.addEventListener('mapp:results-changed', event => update(event.detail));
    load();
  }
  return { parsePoints, layoutPoints, nearbyPoints, initialize };
});
