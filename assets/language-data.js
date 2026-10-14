(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MappData = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const SCHEMA = 'language-resource-explorer/1';
  const STAGES = ['pretrain', 'posttrain'];
  const STATUSES = ['clustered', 'uncovered', 'quantity_unavailable'];
  const UNKNOWN_FAMILY = '__unknown__';
  const collator = new Intl.Collator('en', { sensitivity: 'base' });
  const regimeNames = {
    'expand-pre-training': 'Expand pre-training',
    'bootstrap-post-training': 'Bootstrap post-training',
    'scale-up-post-training': 'Scale up post-training',
    'diversify-post-training': 'Diversify post-training',
    'refine-both-stages': 'Refine both stages',
    'neither-stage-eligible': 'No pre-training yet',
    other: 'Other cluster combination',
  };
  const statusNames = { clustered: 'Clustered', uncovered: 'Not covered', quantity_unavailable: 'Quantity unavailable' };
  const emptyFilters = () => ({ search: '', family: '', regime: '', pretrainCluster: '', posttrainCluster: '', pretrainStatus: '', posttrainStatus: '' });
  const normalizeText = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('en');
  const compareNames = (a, b) => collator.compare(a.name, b.name) || a.code.localeCompare(b.code);
  const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
  function safePath(path) {
    requireValue(typeof path === 'string' && /^[a-zA-Z0-9_/-]+\.json$/.test(path) && !path.startsWith('/') && !path.split('/').includes('..'), 'Invalid data file path.');
    // Exported detail paths are logical identifiers. Prefix Windows device
    // filenames in the published snapshot while preserving the ISO code.
    return path.replace(/(^|\/)(con|prn|aux|nul|com[1-9]|lpt[1-9])\.json$/i, '$1iso-$2.json');
  }
  function parseStage(value, label) {
    requireValue(value && [-1, 0, 1, 2].includes(value.cluster), `${label}: invalid cluster.`);
    requireValue(STATUSES.includes(value.status), `${label}: invalid resource status.`);
    requireValue(value.quantity === null || (typeof value.quantity === 'number' && Number.isFinite(value.quantity) && value.quantity >= 0), `${label}: invalid quantity.`);
    requireValue(value.cluster === -1 ? value.status !== 'clustered' : value.status === 'clustered', `${label}: cluster/status mismatch.`);
    requireValue(value.cluster === -1 ? value.quantity === null : value.quantity > 0, `${label}: cluster/quantity mismatch.`);
    return { cluster: value.cluster, status: value.status, quantity: value.quantity };
  }
  function parseCatalog(manifest, clusters, index) {
    requireValue(manifest?.schema_version === SCHEMA, 'Unsupported language data schema.');
    requireValue(Array.isArray(index) && index.length === manifest.language_count, 'Language index count does not match the manifest.');
    requireValue(Array.isArray(clusters?.regimes), 'Missing regime definitions.');
    const definitions = new Map(clusters.regimes.map(group => [group.id, group]));
    const codes = new Set();
    const issues = { missingFamily: 0, quantityUnavailable: { pretrain: 0, posttrain: 0 } };
    const languages = index.map(raw => {
      requireValue(/^[a-z]{3}$/.test(raw.code) && !codes.has(raw.code), 'Invalid or duplicate ISO 639-3 code.');
      codes.add(raw.code);
      requireValue(typeof raw.name === 'string' && raw.name.trim(), `${raw.code}: missing language name.`);
      requireValue(raw.family === null || (typeof raw.family === 'string' && raw.family.trim()), `${raw.code}: invalid family.`);
      requireValue(definitions.has(raw.regime), `${raw.code}: unknown regime.`);
      const pretrain = parseStage(raw.pretrain, `${raw.code} pre-training`);
      const posttrain = parseStage(raw.posttrain, `${raw.code} post-training`);
      const pairs = definitions.get(raw.regime).cluster_pairs;
      requireValue(raw.regime === 'other' || pairs.some(([pre, post]) => pre === pretrain.cluster && post === posttrain.cluster), `${raw.code}: regime/cluster mismatch.`);
      safePath(raw.details);
      requireValue(raw.details === manifest.files.detail_template.replace('{code}', raw.code), `${raw.code}: inconsistent detail path.`);
      if (raw.family === null) issues.missingFamily++;
      for (const stage of STAGES) if (raw[stage].status === 'quantity_unavailable') issues.quantityUnavailable[stage]++;
      return { code: raw.code, name: raw.name, family: raw.family, pretrain, posttrain, regime: raw.regime, details: raw.details, searchText: normalizeText(`${raw.name} ${raw.code}`) };
    });
    for (const stage of STAGES) {
      requireValue(Array.isArray(clusters[stage]), `Missing ${stage} summaries.`);
      for (const summary of clusters[stage]) {
        requireValue(languages.filter(row => row[stage].cluster === summary.cluster).length === summary.n_languages, `${stage} cluster count mismatch.`);
      }
    }
    for (const group of clusters.regimes) requireValue(languages.filter(row => row.regime === group.id).length === group.n_languages, `${group.id}: regime count mismatch.`);
    return { manifest, clusters, languages, issues, byCode: new Map(languages.map(row => [row.code, row])), families: [...new Set(languages.map(row => row.family).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'en')) };
  }
  function parseDetails(raw, row) {
    requireValue(raw?.code === row.code && raw.name === row.name && raw.family === row.family && raw.regime === row.regime, 'Detail identity does not match the language index.');
    for (const stage of STAGES) {
      const parsed = parseStage(raw[stage], `${row.code} ${stage}`);
      requireValue(Object.keys(parsed).every(key => parsed[key] === row[stage][key]), 'Detail quantities or clusters do not match the language index.');
      requireValue(Number.isInteger(raw[stage].n_collections) && Number.isInteger(raw[stage].n_datasets) && Array.isArray(raw[stage].datasets), 'Incomplete language detail statistics.');
    }
    return raw;
  }
  function filterLanguages(rows, filters = {}) {
    const query = normalizeText(filters.search || '').trim();
    const terms = query.split(/\s+/).filter(Boolean);
    const exactCode = /^[a-z]{3}$/.test(query) && rows.some(row => row.code === query);
    return rows.filter(row => (exactCode ? row.code === query : terms.every(term => row.searchText.includes(term))) &&
      (!filters.family || (filters.family === UNKNOWN_FAMILY ? row.family === null : row.family === filters.family)) &&
      (!filters.regime || row.regime === filters.regime) &&
      STAGES.every(stage => (filters[`${stage}Cluster`] === '' || filters[`${stage}Cluster`] == null || row[stage].cluster === Number(filters[`${stage}Cluster`])) &&
        (!filters[`${stage}Status`] || row[stage].status === filters[`${stage}Status`])));
  }
  function paginate(rows, requestedPage = 1, pageSize = 25) {
    requireValue([25, 50, 100].includes(pageSize), 'Unsupported page size.');
    const pageCount = Math.ceil(rows.length / pageSize);
    const page = Math.max(1, Math.min(Math.floor(Number(requestedPage)) || 1, pageCount || 1));
    const offset = (page - 1) * pageSize;
    return { rows: rows.slice(offset, offset + pageSize), page, pageCount, start: rows.length ? offset + 1 : 0, end: Math.min(offset + pageSize, rows.length), total: rows.length };
  }
  function sortLanguages(rows, key = 'name', direction = 'asc') {
    const accessors = { name: row => row.name, code: row => row.code, family: row => row.family,
      pretrain: row => row.pretrain.quantity, posttrain: row => row.posttrain.quantity };
    requireValue(Object.hasOwn(accessors, key) && ['asc', 'desc'].includes(direction), 'Invalid sort order.');
    const sign = direction === 'desc' ? -1 : 1;
    return [...rows].sort((a, b) => {
      const left = accessors[key](a), right = accessors[key](b);
      // Unknown values stay last in both directions; ISO codes break ties.
      if (left === null || right === null) return left === right ? compareNames(a, b) : left === null ? 1 : -1;
      const compared = typeof left === 'number' ? left - right : collator.compare(left, right);
      return compared * sign || a.code.localeCompare(b.code);
    });
  }
  function csvCell(value) {
    if (value == null) return '';
    let text = String(value);
    if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }
  function toCSV(rows) {
    const header = ['Language', 'ISO 639-3', 'Family', 'Development regime', 'Pre-training cluster', 'Pre-training status', 'Pre-training NCC', 'Post-training cluster', 'Post-training status', 'Post-training sample equivalents'];
    const body = rows.map(row => [row.name, row.code, row.family, regimeNames[row.regime] || row.regime, row.pretrain.cluster, row.pretrain.status, row.pretrain.quantity, row.posttrain.cluster, row.posttrain.status, row.posttrain.quantity]);
    return '\ufeff' + [header, ...body].map(cells => cells.map(csvCell).join(',')).join('\r\n');
  }
  function formatQuantity(value, exact = false) {
    if (value === null) return 'Not available';
    if (exact) return String(value);
    return value >= 1e6 || (value > 0 && value < 0.01) ? value.toExponential(3).replace('e+', 'e') : new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
  }
  let catalogPromise;
  const detailsCache = new Map();
  async function readJSON(path, version) {
    const suffix = version ? `?v=${encodeURIComponent(version)}` : '';
    const response = await fetch(`data/${safePath(path)}${suffix}`, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`Could not load ${path} (${response.status}).`);
    return response.json();
  }
  function loadCatalog() {
    if (!catalogPromise) catalogPromise = (async () => {
      const manifest = await readJSON('manifest.json');
      requireValue(manifest.schema_version === SCHEMA, 'Unsupported language data schema.');
      requireValue(typeof manifest.data_version === 'string' && manifest.data_version.length > 0, 'Missing export version.');
      const [clusters, index] = await Promise.all([readJSON(manifest.files.clusters, manifest.data_version), readJSON(manifest.files.index, manifest.data_version)]);
      return parseCatalog(manifest, clusters, index);
    })().catch(error => { catalogPromise = null; throw error; });
    return catalogPromise;
  }
  async function loadDetails(code) {
    const catalog = await loadCatalog();
    const row = catalog.byCode.get(code);
    requireValue(row, 'Unknown language code.');
    if (!detailsCache.has(code)) detailsCache.set(code, readJSON(row.details, catalog.manifest.data_version).then(raw => parseDetails(raw, row)).catch(error => { detailsCache.delete(code); throw error; }));
    return detailsCache.get(code);
  }
  return { SCHEMA, STAGES, STATUSES, UNKNOWN_FAMILY, regimeNames, statusNames, emptyFilters, resolveDataPath: safePath, parseCatalog, parseDetails, filterLanguages, sortLanguages, paginate, toCSV, formatQuantity, loadCatalog, loadDetails };
});
