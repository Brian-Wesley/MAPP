(() => {
  'use strict';
  const root = document.getElementById('language-explorer');
  if (!root) return;
  const data = window.MappData;
  const find = id => document.getElementById(`explorer-${id}`);
  if (!data) {
    find('message').textContent = 'Language Explorer is temporarily unavailable because a required file could not be loaded.';
    find('message').setAttribute('role', 'alert');
    find('rows').replaceChildren();
    return;
  }
  const state = { catalog: null, filters: data.emptyFilters(), sortKey: 'name', sortDirection: 'asc', page: 1, pageSize: 25, matches: [] };
  const inputs = {
    search: find('search'), family: find('family'), regime: find('regime'),
    iso_scope: find('iso-scope'), iso_language_type: find('iso-language-type'), classification_status: find('classification-status'),
    pretrainCluster: find('pretrain-cluster'), posttrainCluster: find('posttrain-cluster'),
    pretrainStatus: find('pretrain-status'), posttrainStatus: find('posttrain-status'),
  };
  const number = value => value.toLocaleString('en-US');
  const metadataLabels = { iso_scope: 'ISO_scope', iso_language_type: 'ISO_language_type', classification_status: 'classification_status' };
  function node(tag, text, className) {
    const item = document.createElement(tag);
    if (text !== undefined) item.textContent = text;
    if (className) item.className = className;
    return item;
  }
  function button(text, action) {
    const item = node('button', text);
    item.type = 'button';
    item.addEventListener('click', action);
    return item;
  }
  function option(value, label) {
    const item = node('option', label);
    item.value = value;
    return item;
  }
  function syncInputs() {
    for (const [key, input] of Object.entries(inputs)) input.value = state.filters[key];
  }
  function selectionText() {
    const filters = state.filters;
    const entries = [];
    if (filters.regime) entries.push(['regime', data.regimeNames[filters.regime] || filters.regime]);
    for (const [stage, label] of [['pretrain', 'pre-training'], ['posttrain', 'post-training']]) {
      if (filters[`${stage}Cluster`] !== '') entries.push([`${label} cluster`, filters[`${stage}Cluster`] === '-1' ? 'No usable resources (-1)' : `Cluster ${filters[`${stage}Cluster`]}`]);
      if (filters[`${stage}Status`]) entries.push([`${label} availability`, data.statusNames[filters[`${stage}Status`]]]);
    }
    if (filters.family) entries.push(['family', filters.family === data.UNKNOWN_FAMILY ? 'Unknown family' : filters.family]);
    for (const field of data.METADATA_FIELDS) {
      if (filters[field]) entries.push([metadataLabels[field], filters[field] === data.UNKNOWN_METADATA ? 'Unknown' : filters[field]]);
    }
    if (filters.search.trim()) entries.push(['search', filters.search.trim()]);
    const selected = find('selected');
    selected.replaceChildren(entries.length === 0 ? 'All languages' : entries.length === 1 ? `Selected ${entries[0][0]}: ` : 'Selected filters: ');
    entries.forEach(([key, value], index) => {
      if (index) selected.append(' · ');
      if (entries.length > 1) selected.append(`${key}: `);
      selected.append(node('strong', value));
    });
    find('clear').disabled = entries.length === 0;
    const extraCount = ['regime', 'pretrainCluster', 'posttrainCluster', 'pretrainStatus', 'posttrainStatus'].filter(key => filters[key] !== '').length;
    find('more').textContent = extraCount ? `More filters (${extraCount})` : 'More filters';
  }
  function stageCell(stage, value) {
    const cell = node('td');
    cell.append(node('span', value.cluster === -1 ? 'No usable resources (-1)' : `Cluster ${value.cluster}`, 'stage-cluster'));
    const units = stage === 'pretrain' ? 'NCC' : 'sample equivalents';
    const quantity = node('span', value.quantity === null ? data.statusNames[value.status] : `${data.formatQuantity(value.quantity)} ${units}`, 'stage-quantity');
    if (value.quantity !== null) quantity.title = `${data.formatQuantity(value.quantity, true)} ${units}`;
    cell.append(quantity);
    return cell;
  }
  function addStatistic(list, label, value) {
    list.append(node('dt', label), node('dd', value));
  }
  function stageDetails(stage, detail) {
    const values = detail[stage];
    const section = node('section');
    section.append(node('h4', stage === 'pretrain' ? 'Pre-training' : 'Post-training'));
    const list = node('dl');
    addStatistic(list, 'Cluster', String(values.cluster));
    addStatistic(list, 'Status', data.statusNames[values.status]);
    addStatistic(list, stage === 'pretrain' ? 'NCC' : 'Sample equivalents', data.formatQuantity(values.quantity, true));
    if (stage === 'pretrain' && values.quantity_ci95?.lower != null && values.quantity_ci95?.upper != null) {
      addStatistic(list, 'NCC 95% interval', `${values.quantity_ci95.lower} – ${values.quantity_ci95.upper}`);
    }
    addStatistic(list, 'Collections', number(values.n_collections));
    addStatistic(list, 'Datasets', number(values.n_datasets));
    section.append(list);
    for (const [key, label] of [['sources', 'Sources'], ['tasks', 'Tasks']]) {
      const entries = Object.entries(values[key] || {}).sort((a, b) => (b[1].proportion ?? -1) - (a[1].proportion ?? -1));
      if (entries.length) section.append(node('p', `${label}: ${entries.map(([name, info]) => `${name}${info.proportion == null ? '' : ` (${(info.proportion * 100).toFixed(2)}%)`}`).join('; ')}.`));
    }
    if (values.datasets.length) {
      const disclosure = node('details');
      disclosure.append(node('summary', `Dataset records (${number(values.datasets.length)})`));
      const table = node('table', undefined, 'detail-datasets');
      const head = node('thead');
      const headings = node('tr');
      for (const label of ['Collection', 'Dataset', stage === 'pretrain' ? 'NCC' : 'Sample equivalents']) {
        const heading = node('th', label);
        heading.scope = 'col';
        headings.append(heading);
      }
      head.append(headings);
      const body = node('tbody');
      for (const record of values.datasets) {
        const row = node('tr');
        const collection = node('td');
        const link = node('a', record.collection, 'collection-catalog-link');
        link.href = '#dataset-catalog';
        link.setAttribute('aria-label', `${record.collection}: view datasets covering ${detail.name} (${detail.code})`);
        link.addEventListener('click', event => {
          if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
          if (dialog.open) dialog.close();
          if (window.MappDatasetExplorer) {
            event.preventDefault();
            window.MappDatasetExplorer.openSubset({ code: detail.code, name: detail.name, stage, collection: record.collection });
          }
        });
        collection.append(link);
        row.append(collection, node('td', record.id), node('td', data.formatQuantity(record.quantity, true)));
        body.append(row);
      }
      table.append(head, body);
      disclosure.append(table);
      section.append(disclosure);
    }
    return section;
  }
  const detailRequests = new WeakMap();
  async function showDetails(container, row) {
    const request = Symbol(row.code);
    detailRequests.set(container, request);
    container.replaceChildren(node('p', `Loading details for ${row.name}…`));
    try {
      const detail = await data.loadDetails(row.code);
      if (!container.isConnected || detailRequests.get(container) !== request) return;
      const heading = node('h3', `${detail.name} (${detail.code})`);
      const metadata = node('p', `Family: ${detail.family || 'Unknown family'} · Development regime: ${data.regimeNames[detail.regime] || detail.regime}`);
      const columns = node('div', undefined, 'detail-columns');
      columns.append(stageDetails('pretrain', detail), stageDetails('posttrain', detail));
      container.replaceChildren(heading, metadata, columns);
    } catch (error) {
      if (!container.isConnected || detailRequests.get(container) !== request) return;
      console.error(`Language details failed (${row.code})`, error);
      const reason = error.userMessage || 'The detail data could not be read or displayed. Please reload the page and retry.';
      const message = node('p', `Could not load details for ${row.name} (${row.code}). ${reason}`);
      message.setAttribute('role', 'alert');
      container.replaceChildren(message, button('Retry details', () => showDetails(container, row)));
    }
  }
  function languageRow(language) {
    const row = node('tr');
    row.append(node('td', language.name, 'language-name'));
    const code = node('td');
    code.append(node('code', language.code));
    row.append(code, stageCell('pretrain', language.pretrain), stageCell('posttrain', language.posttrain), node('td', language.family || 'Unknown family'));
    const actions = node('td');
    let expandedRow;
    const toggle = button('Details', () => {
      if (expandedRow) {
        expandedRow.remove();
        expandedRow = null;
        toggle.textContent = 'Details';
        toggle.setAttribute('aria-expanded', 'false');
        return;
      }
      expandedRow = node('tr', undefined, 'language-detail-row');
      const cell = node('td');
      cell.colSpan = 6;
      const content = node('div');
      content.id = `language-details-${language.code}`;
      content.setAttribute('aria-live', 'polite');
      cell.append(content);
      expandedRow.append(cell);
      row.after(expandedRow);
      toggle.textContent = 'Hide';
      toggle.setAttribute('aria-expanded', 'true');
      showDetails(content, language);
    });
    toggle.className = 'details-toggle';
    toggle.setAttribute('aria-label', `Details for ${language.name} (${language.code})`);
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', `language-details-${language.code}`);
    actions.append(toggle);
    row.append(actions);
    return row;
  }
  function renderPages(page) {
    const navigation = find('pages');
    navigation.replaceChildren();
    const move = value => {
      state.page = value;
      render();
      const current = [...navigation.children].find(item => item.getAttribute('aria-current') === 'page');
      current?.focus({ preventScroll: true });
    };
    const previous = button('‹', () => move(state.page - 1));
    previous.setAttribute('aria-label', 'Previous page');
    previous.disabled = page.page <= 1;
    navigation.append(previous);
    const numbers = new Set([1, page.pageCount]);
    for (let value = page.page - 2; value <= page.page + 2; value++) if (value >= 1 && value <= page.pageCount) numbers.add(value);
    let last = 0;
    for (const value of [...numbers].filter(value => value >= 1 && value <= page.pageCount).sort((a, b) => a - b)) {
      if (last && value > last + 1) navigation.append(node('span', '…'));
      const item = button(String(value), () => move(value));
      item.setAttribute('aria-label', `Page ${value}`);
      if (value === page.page) item.setAttribute('aria-current', 'page');
      navigation.append(item);
      last = value;
    }
    const next = button('›', () => move(state.page + 1));
    next.setAttribute('aria-label', 'Next page');
    next.disabled = page.pageCount === 0 || page.page >= page.pageCount;
    navigation.append(next);
  }
  function render() {
    if (!state.catalog) return;
    // Always filter the complete index, then sort all matches before slicing a page.
    state.matches = data.sortLanguages(data.filterLanguages(state.catalog.languages, state.filters), state.sortKey, state.sortDirection);
    const page = data.paginate(state.matches, state.page, state.pageSize);
    state.page = page.page;
    const rows = find('rows');
    rows.replaceChildren(...page.rows.map(languageRow));
    if (!page.rows.length) {
      const row = node('tr');
      const cell = node('td', 'No matching languages. Adjust your search or clear the filters.');
      cell.colSpan = 6;
      row.append(cell);
      rows.append(row);
    }
    find('count').textContent = `Showing matching languages: ${number(page.total)}`;
    find('range').textContent = `Showing ${number(page.start)}–${number(page.end)} of ${number(page.total)}`;
    find('download').disabled = page.total === 0;
    selectionText();
    renderPages(page);
    document.dispatchEvent(new CustomEvent('mapp:results-changed', { detail: { codes: state.matches.map(row => row.code), filters: { ...state.filters } } }));
  }
  find('sort').addEventListener('change', () => {
    [state.sortKey, state.sortDirection] = find('sort').value.split(':');
    state.page = 1;
    render();
  });
  for (const [key, input] of Object.entries(inputs)) {
    input.addEventListener(key === 'search' ? 'input' : 'change', () => {
      state.filters[key] = input.value;
      state.page = 1;
      render();
    });
  }
  find('clear').addEventListener('click', () => {
    state.filters = data.emptyFilters();
    state.page = 1;
    syncInputs();
    render();
  });
  find('more').addEventListener('click', () => {
    const expanded = find('more').getAttribute('aria-expanded') !== 'true';
    find('more').setAttribute('aria-expanded', String(expanded));
    find('extra').hidden = !expanded;
  });
  find('page-size').addEventListener('change', event => {
    state.pageSize = Number(event.target.value);
    state.page = 1;
    render();
  });
  find('download').addEventListener('click', () => {
    const csv = data.toCSV(state.matches);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const link = node('a');
    link.href = url;
    link.download = `mapp-filtered-languages-${state.catalog.manifest.data_version}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  const dialog = document.getElementById('language-detail-dialog');
  const dialogContent = document.getElementById('language-detail-content');
  document.getElementById('language-detail-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    detailRequests.delete(dialogContent);
    dialogContent.replaceChildren();
  });
  window.MappExplorer = {
    getState() {
      return { filters: { ...state.filters }, codes: state.matches.map(row => row.code) };
    },
    openDetails(code) {
      const language = state.catalog?.byCode.get(code);
      if (!language) return;
      if (!dialog.open) dialog.showModal();
      showDetails(dialogContent, language);
    },
    select(filter, { scroll = true } = {}) {
      const active = Object.entries(filter).every(([key, value]) => state.filters[key] === value);
      if (active) {
        // Remove only this group's filter; retain any search or other filters.
        for (const key of Object.keys(filter)) state.filters[key] = '';
      } else {
        state.filters = { ...data.emptyFilters(), ...filter };
      }
      state.page = 1;
      syncInputs();
      render();
      if (scroll) {
        root.scrollIntoView({ block: 'start' });
        find('title').focus({ preventScroll: true });
      }
    },
  };
  async function initialize() {
    find('message').replaceChildren(node('p', 'Loading language data…'));
    try {
      state.catalog = await data.loadCatalog();
      root.dataset.dataVersion = state.catalog.manifest.data_version;
      inputs.family.replaceChildren(option('', 'All families'), ...state.catalog.families.map(family => option(family, family)), option(data.UNKNOWN_FAMILY, 'Unknown family'));
      for (const field of data.METADATA_FIELDS) {
        const values = state.catalog.metadataOptions[field];
        inputs[field].replaceChildren(option('', values.length ? 'All' : 'Not available'), ...values.map(value => option(value, value)));
        if (values.length && state.catalog.languages.some(row => row[field] === null)) inputs[field].append(option(data.UNKNOWN_METADATA, 'Unknown'));
        inputs[field].disabled = values.length === 0;
      }
      inputs.regime.replaceChildren(option('', 'All regimes'), ...state.catalog.clusters.regimes.map(group => option(group.id, data.regimeNames[group.id] || group.name)));
      find('controls').disabled = false;
      find('page-size').disabled = false;
      find('message').replaceChildren();
      syncInputs();
      render();
      document.dispatchEvent(new CustomEvent('mapp:catalog-ready', { detail: state.catalog }));
    } catch (error) {
      const message = node('p', 'Language data could not be loaded. Please try again.');
      message.setAttribute('role', 'alert');
      find('message').replaceChildren(message, button('Retry loading', initialize));
      const row = node('tr');
      const cell = node('td', 'Language data unavailable.');
      cell.colSpan = 6;
      row.append(cell);
      find('rows').replaceChildren(row);
    }
  }
  initialize();
})();
