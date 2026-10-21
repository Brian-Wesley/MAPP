(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MappCollectionSnapshot = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const COLORS = ['#237c83', '#d28c38', '#6977b8', '#b95c7b', '#699349', '#825ca0'];
  const OTHER = '#9aa9b2';
  const ROW_HEIGHT = 38, BUTTON_HEIGHT = 32, GAP = 8;
  const percent = value => value > 0 && value < 0.001 ? '<0.1%' : `${(value * 100).toFixed(1)}%`;
  function aggregate(records) {
    const groups = new Map();
    let unknown = 0;
    for (const record of records) {
      if (typeof record.quantity !== 'number' || !Number.isFinite(record.quantity) || record.quantity < 0) { unknown++; continue; }
      groups.set(record.collection, (groups.get(record.collection) || 0) + record.quantity);
    }
    const rows = [...groups].filter(([, quantity]) => quantity > 0)
      .map(([name, quantity]) => ({ name, quantity }))
      .sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name, 'en'));
    const total = rows.reduce((sum, row) => sum + row.quantity, 0);
    return { rows: rows.map(row => ({ ...row, share: row.quantity / total })), total, unknown };
  }
  function visibleCount(height, count) {
    const capacity = Math.max(1, Math.floor(height / ROW_HEIGHT));
    return count <= capacity ? count : Math.max(1, Math.min(COLORS.length, Math.floor((height - BUTTON_HEIGHT - GAP) / ROW_HEIGHT)));
  }
  let sequence = 0;
  function create({ document, records, stage, language, collectionLink, formatQuantity, ResizeObserver }) {
    const summary = aggregate(records);
    const unit = stage === 'pretrain' ? 'NCC' : 'sample equivalents';
    const node = (tag, text, className) => {
      const element = document.createElement(tag);
      if (text !== undefined) element.textContent = text;
      if (className) element.className = className;
      return element;
    };
    const element = node('section', undefined, 'collection-snapshot');
    element.append(node('h5', 'Collection Snapshot'));
    if (!summary.total) {
      element.append(node('p', 'No positive quantity is available to calculate collection shares.', 'snapshot-note'));
      return { element, mount: () => () => {} };
    }
    element.append(node('p', summary.unknown
      ? `Shares of known ${unit} only; ${summary.unknown} record${summary.unknown === 1 ? '' : 's'} have unavailable quantities.`
      : `Share of ${unit} for ${language}.`, 'snapshot-note'));
    const layout = node('div', undefined, 'snapshot-layout');
    const chart = node('div', undefined, 'snapshot-chart');
    const side = node('div', undefined, 'snapshot-side');
    const top = node('ol', undefined, 'snapshot-list');
    const toggle = node('button', '', 'snapshot-toggle');
    toggle.type = 'button';
    const more = node('div', undefined, 'snapshot-more');
    more.id = `snapshot-more-${++sequence}`;
    more.hidden = true;
    toggle.setAttribute('aria-controls', more.id);
    toggle.setAttribute('aria-expanded', 'false');
    side.append(top, toggle); layout.append(chart, side); element.append(layout, more);
    let expanded = false, lastSize = 0;
    const description = row => `${row.name}: ${percent(row.share)} · ${formatQuantity(row.quantity)} ${unit}${summary.unknown ? ' (known quantities only)' : ''}`;
    function legendRow(row, color) {
      const item = node('li', undefined, 'snapshot-item');
      const swatch = node('span', undefined, 'snapshot-swatch');
      swatch.style.backgroundColor = color;
      swatch.setAttribute('aria-hidden', 'true');
      const name = collectionLink(row.name);
      name.className += ' snapshot-name';
      name.title = description(row);
      const share = node('span', percent(row.share), 'snapshot-percent');
      share.title = description(row);
      item.append(swatch, name, share);
      return item;
    }
    function draw(size) {
      const n = visibleCount(size, summary.rows.length);
      const leading = summary.rows.slice(0, n), trailing = summary.rows.slice(n);
      const otherQuantity = trailing.reduce((sum, row) => sum + row.quantity, 0);
      const slices = leading.map((row, index) => ({ ...row, color: COLORS[index % COLORS.length] }));
      if (trailing.length) slices.push({ name: `Others (${trailing.length} collections)`, quantity: otherQuantity, share: otherQuantity / summary.total, color: OTHER });
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 200 200');
      svg.setAttribute('role', 'group');
      svg.setAttribute('aria-label', `${language}: ${stage === 'pretrain' ? 'pre-training' : 'post-training'} collection shares`);
      const tooltip = node('div', undefined, 'snapshot-tooltip');
      tooltip.hidden = true;
      let angle = -Math.PI / 2;
      for (const row of slices) {
        const full = slices.length === 1;
        const shape = document.createElementNS('http://www.w3.org/2000/svg', full ? 'circle' : 'path');
        if (full) {
          shape.setAttribute('cx', '100'); shape.setAttribute('cy', '100'); shape.setAttribute('r', '99');
        } else {
          const end = angle + row.share * 2 * Math.PI;
          const point = a => `${100 + 99 * Math.cos(a)} ${100 + 99 * Math.sin(a)}`;
          shape.setAttribute('d', `M 100 100 L ${point(angle)} A 99 99 0 ${row.share > 0.5 ? 1 : 0} 1 ${point(end)} Z`);
          angle = end;
        }
        shape.setAttribute('fill', row.color);
        shape.setAttribute('stroke', '#fff'); shape.setAttribute('stroke-width', '1');
        shape.setAttribute('tabindex', '0'); shape.setAttribute('role', 'img');
        shape.setAttribute('aria-label', description(row));
        const show = () => { tooltip.textContent = description(row); tooltip.hidden = false; };
        const hide = () => { tooltip.hidden = true; };
        shape.addEventListener('mouseenter', show); shape.addEventListener('mouseleave', hide);
        shape.addEventListener('focus', show); shape.addEventListener('blur', hide);
        shape.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
        svg.append(shape);
      }
      chart.replaceChildren(svg, tooltip);
      top.replaceChildren(...leading.map((row, index) => legendRow(row, COLORS[index % COLORS.length])));
      toggle.hidden = !trailing.length;
      toggle.textContent = expanded ? 'Hide other collections ▴' : `Others (${trailing.length}) · ${percent(otherQuantity / summary.total)} ▾`;
      toggle.setAttribute('aria-expanded', String(expanded));
      more.replaceChildren();
      if (trailing.length) {
        more.append(node('p', 'Collections grouped as Others in the pie:', 'snapshot-note'));
        const list = node('ol', undefined, 'snapshot-list');
        list.start = n + 1;
        list.append(...trailing.map(row => legendRow(row, OTHER)));
        more.append(list);
      }
      more.hidden = !expanded || !trailing.length;
    }
    toggle.addEventListener('click', () => { expanded = !expanded; draw(lastSize || 184); });
    draw(184);
    function mount() {
      const resize = () => {
        const width = layout.getBoundingClientRect().width;
        if (!width) return;
        const size = Math.round(Math.max(112, Math.min(224, width * 0.42)));
        if (size === lastSize) return;
        lastSize = size;
        layout.style.setProperty('--snapshot-size', `${size}px`);
        draw(size);
      };
      resize();
      const observer = ResizeObserver ? new ResizeObserver(resize) : null;
      observer?.observe(layout);
      return () => observer?.disconnect();
    }
    return { element, mount };
  }
  return { aggregate, visibleCount, create };
});
