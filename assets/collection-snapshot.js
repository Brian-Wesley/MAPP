(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MappCollectionSnapshot = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const COLORS = ['#237c83', '#d28c38', '#6977b8', '#b95c7b', '#699349', '#825ca0'];
  const OTHER = '#9aa9b2';
  const percent = value => value > 0 && value < 0.001 ? '<0.1%' : `${(value * 100).toFixed(1)}%`;
  function aggregate(records) {
    const groups = new Map();
    const unavailable = new Map();
    let unknown = 0;
    for (const record of records) {
      if (typeof record.quantity !== 'number' || !Number.isFinite(record.quantity) || record.quantity < 0) {
        unknown++;
        unavailable.set(record.collection, (unavailable.get(record.collection) || 0) + 1);
        continue;
      }
      groups.set(record.collection, (groups.get(record.collection) || 0) + record.quantity);
    }
    const rows = [...groups].filter(([, quantity]) => quantity > 0)
      .map(([name, quantity]) => ({ name, quantity }))
      .sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name, 'en'));
    const total = rows.reduce((sum, row) => sum + row.quantity, 0);
    return { rows: rows.map(row => ({ ...row, share: row.quantity / total })), total, unknown,
      unavailable: [...unavailable].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name, 'en')) };
  }
  function visibleCount(count, hasUnavailable = false) {
    return hasUnavailable ? Math.min(4, count) : count <= 6 ? count : 5;
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
    const header = node('div', undefined, 'snapshot-header');
    header.append(node('h5', 'Collection Snapshot'),
      node('p', `Share of ${stage === 'pretrain' ? 'NCC' : 'samples'} for ${language}.`, 'snapshot-note'));
    element.append(header);
    const unavailableDetails = node('div', undefined, 'snapshot-more snapshot-unavailable');
    unavailableDetails.id = `snapshot-unavailable-${++sequence}`;
    unavailableDetails.hidden = true;
    const unavailableToggle = node('button', 'Unavailable quantities ▾', 'snapshot-toggle snapshot-unavailable-toggle');
    unavailableToggle.type = 'button';
    unavailableToggle.hidden = !summary.unknown;
    unavailableToggle.setAttribute('aria-controls', unavailableDetails.id);
    unavailableToggle.setAttribute('aria-expanded', 'false');
    if (summary.unknown) {
      unavailableDetails.append(node('p', 'These records have unavailable quantities and are excluded from the pie and percentages. Collections with partial quantities can also appear above.', 'snapshot-note'));
      const list = node('ul', undefined, 'snapshot-list');
      for (const row of summary.unavailable) {
        const item = node('li', undefined, 'snapshot-unavailable-item');
        item.append(collectionLink(row.name), node('span', `${row.count} record${row.count === 1 ? '' : 's'}`));
        list.append(item);
      }
      unavailableDetails.append(list);
    }
    unavailableToggle.addEventListener('click', () => {
      unavailableDetails.hidden = !unavailableDetails.hidden;
      unavailableToggle.setAttribute('aria-expanded', String(!unavailableDetails.hidden));
      unavailableToggle.textContent = `Unavailable quantities ${unavailableDetails.hidden ? '▾' : '▴'}`;
    });
    if (!summary.total) {
      element.append(node('p', 'No positive quantity is available to calculate collection shares.', 'snapshot-note'));
      if (summary.unknown) element.append(unavailableToggle, unavailableDetails);
      return { element, mount: () => () => {} };
    }
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
    const actions = node('div', undefined, 'snapshot-actions');
    actions.append(toggle, unavailableToggle);
    side.append(top, actions); layout.append(chart, side); element.append(layout, more, unavailableDetails);
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
      const n = visibleCount(summary.rows.length, summary.unknown > 0);
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
      const otherSwatch = node('span', undefined, 'snapshot-swatch');
      otherSwatch.style.backgroundColor = OTHER;
      otherSwatch.setAttribute('aria-hidden', 'true');
      toggle.replaceChildren(otherSwatch, node('span', `Others (${trailing.length}) · ${percent(otherQuantity / summary.total)} ${expanded ? '▴' : '▾'}`));
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
        const size = Math.round(Math.max(168, Math.min(224, width * 0.42)));
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
