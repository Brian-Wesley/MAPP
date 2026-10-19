(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else api.init(root, document);
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const compare = new Intl.Collator('en', { sensitivity: 'base', numeric: true }).compare;
  const normalize = text => String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  function selectRows(rows, query, sort, taskNames = {}) {
    const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
    return rows.filter(row => {
      const text = normalize([row.name, ...row.tasks, ...row.tasks.map(task => taskNames[task] || task), ...row.sources].join(' '));
      return terms.every(term => text.includes(term));
    }).sort((a, b) => {
      if (sort === 'name') return compare(a.name, b.name);
      const value = row => sort === 'year' ? (row.paper_years.at(-1) ?? null) : row[sort];
      const left = value(a), right = value(b);
      if (left === null || right === null) return left === right ? compare(a.name, b.name) : left === null ? 1 : -1;
      return right - left || compare(a.name, b.name);
    });
  }
  function init(root, document) {
    const find = id => document.getElementById(`catalog-${id}`);
    if (!find('rows')) return;
    const node = (tag, text) => {
      const element = document.createElement(tag);
      if (text != null) element.textContent = String(text);
      return element;
    };
    const number = value => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
    let catalog, stage = 'pretrain', page = 1;
    function listCell(values, limit = 3) {
      const cell = node('td');
      if (!values.length) { cell.textContent = '—'; return cell; }
      const list = items => {
        const ul = node('ul');
        for (const text of items) ul.append(node('li', text));
        return ul;
      };
      cell.append(list(values.slice(0, limit)));
      if (values.length > limit) {
        const details = node('details');
        details.append(node('summary', `+${values.length - limit} more`), list(values.slice(limit)));
        cell.append(details);
      }
      return cell;
    }
    function linkCell(urls, label, name) {
      const cell = node('td');
      // Reject unsafe imported protocols even if a data file was edited by hand.
      const valid = urls.filter(url => { try { return ['https:', 'http:'].includes(new URL(url).protocol); } catch { return false; } });
      if (!valid.length) { cell.textContent = '—'; return cell; }
      const link = (url, i) => {
        const a = node('a', label);
        a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
        a.setAttribute('aria-label', `${name}: ${label}${valid.length > 1 ? ` ${i + 1}` : ''} (new tab)`);
        a.title = url;
        return a;
      };
      cell.append(link(valid[0], 0));
      if (valid.length > 1) {
        const details = node('details');
        details.append(node('summary', `+${valid.length - 1}`));
        valid.slice(1).forEach((url, i) => { const p = node('div'); p.append(link(url, i + 1)); details.append(p); });
        cell.append(details);
      }
      return cell;
    }
    function render() {
      if (!catalog) return;
      const rows = selectRows(catalog.stages[stage], find('search').value, find('sort').value, catalog.task_names);
      const size = Number(find('page-size').value);
      const pages = Math.max(1, Math.ceil(rows.length / size));
      page = Math.max(1, Math.min(page, pages));
      const offset = (page - 1) * size;
      const body = find('rows');
      body.replaceChildren();
      for (const row of rows.slice(offset, offset + size)) {
        const tr = node('tr'), name = node('th', row.name);
        name.scope = 'row';
        const years = row.paper_years;
        const year = node('td', years.length ? years.join(', ') : '—');
        const quantity = node('td', row.quantity === null ? '—' : number(row.quantity));
        if (row.quantity !== null) quantity.title = `${row.quantity} ${stage === 'pretrain' ? 'NCC' : 'sample equivalents'}`;
        if (row.quantity !== null && row.quantity_partial) { const note = node('span', 'Partial'); note.className = 'catalog-partial'; quantity.append(note); }
        tr.append(name, year, quantity, node('td', number(row.language_count)),
          listCell(row.tasks.map(task => catalog.task_names[task] || task)), listCell(row.sources),
          linkCell(row.dataset_links, 'Link', row.name), linkCell(row.paper_links, '论文', row.name));
        body.append(tr);
      }
      if (!rows.length) { const row = node('tr'), cell = node('td', 'No collections match your search.'); cell.colSpan = 8; row.append(cell); body.append(row); }
      find('range').textContent = `Showing ${rows.length ? offset + 1 : 0}–${Math.min(offset + size, rows.length)} of ${number(rows.length)} collections`;
      find('page').textContent = `Page ${page} of ${pages}`;
      find('prev').disabled = page === 1;
      find('next').disabled = page === pages;
      find('quantity-heading').textContent = stage === 'pretrain' ? 'Data quantity (NCC)' : 'Data quantity (sample equivalents)';
    }
    for (const value of ['pretrain', 'posttrain']) {
      const tab = find(value);
      tab.addEventListener('click', () => {
        stage = value; page = 1;
        for (const name of ['pretrain', 'posttrain']) {
          find(name).setAttribute('aria-selected', String(name === stage));
          find(name).tabIndex = name === stage ? 0 : -1;
        }
        find('panel').setAttribute('aria-labelledby', `catalog-${stage}`);
        render();
      });
      tab.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 'pretrain' : event.key === 'End' ? 'posttrain' : value === 'pretrain' ? 'posttrain' : 'pretrain';
        find(next).click(); find(next).focus();
      });
    }
    for (const id of ['search', 'sort', 'page-size']) find(id).addEventListener(id === 'search' ? 'input' : 'change', () => { page = 1; render(); });
    find('prev').addEventListener('click', () => { page--; render(); });
    find('next').addEventListener('click', () => { page++; render(); });
    function ready() {
      catalog = root.MappDatasetCatalog;
      const expected = document.getElementById('resource-profiles-figure')?.dataset.version;
      if (!catalog || catalog.data_version !== expected || !['pretrain', 'posttrain'].every(key => Array.isArray(catalog.stages?.[key]))) {
        catalog = null;
        find('message').replaceChildren(node('span', 'The dataset catalog could not be loaded. '));
        const retry = node('button', 'Retry catalog'); retry.type = 'button';
        retry.addEventListener('click', () => {
          retry.disabled = true;
          const script = node('script');
          script.src = document.getElementById('dataset-catalog-data').src;
          script.onload = () => { script.remove(); ready(); };
          script.onerror = () => { script.remove(); retry.disabled = false; };
          document.head.append(script);
        });
        find('message').append(retry);
        const row = node('tr'), cell = node('td', 'Dataset catalog unavailable. Use Retry catalog above.');
        cell.colSpan = 8; row.append(cell); find('rows').replaceChildren(row);
        return;
      }
      find('message').textContent = '';
      for (const id of ['search', 'sort', 'page-size']) find(id).disabled = false;
      find('pretrain').textContent = `Pre-train (${catalog.stages.pretrain.length})`;
      find('posttrain').textContent = `Post-train (${catalog.stages.posttrain.length})`;
      render();
    }
    ready();
  }
  return { selectRows, init };
});
