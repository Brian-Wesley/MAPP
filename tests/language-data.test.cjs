const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const data = require('../assets/language-data.js');
const read = file => JSON.parse(fs.readFileSync(path.join(__dirname, '../data', data.resolveDataPath(file)), 'utf8'));
const manifest = read('manifest.json');
const clusters = read('clusters.json');
const index = read('languages.json');
const catalog = data.parseCatalog(manifest, clusters, index);

test('Windows-reserved ISO detail paths resolve to portable publication filenames', () => {
  for (const code of ['con', 'prn']) {
    assert.equal(data.resolveDataPath(`languages/${code}.json`), `languages/iso-${code}.json`);
    assert.equal(read(catalog.byCode.get(code).details).code, code);
  }
  assert.equal(data.resolveDataPath('languages/eng.json'), 'languages/eng.json');
});

test('all language records and lazy detail files agree with the catalog', () => {
  assert.equal(catalog.languages.length, manifest.language_count);
  for (const row of catalog.languages) {
    const detail = data.parseDetails(read(row.details), row);
    for (const stage of data.STAGES) {
      assert.equal(detail[stage].datasets.length, detail[stage].n_datasets, row.code);
      for (const record of detail[stage].datasets) {
        assert.ok(record.quantity === null || (typeof record.quantity === 'number' && Number.isFinite(record.quantity)), `${row.code}: invalid dataset quantity`);
      }
    }
  }
  assert.deepEqual(catalog.issues, { missingFamily: manifest.family_assignments.missing, quantityUnavailable: {
    pretrain: manifest.counts.pretrain.status_counts.quantity_unavailable,
    posttrain: manifest.counts.posttrain.status_counts.quantity_unavailable,
  } });
});

test('card filters match all supplied regime and cluster counts', () => {
  for (const group of clusters.regimes) {
    assert.equal(data.filterLanguages(catalog.languages, { regime: group.id }).length, group.n_languages);
  }
  for (const stage of data.STAGES) {
    for (const group of clusters[stage]) {
      assert.equal(data.filterLanguages(catalog.languages, { [`${stage}Cluster`]: String(group.cluster) }).length, group.n_languages);
    }
  }
});

test('search, family, and stage filters combine and retain missing values', () => {
  assert.ok(data.filterLanguages(catalog.languages, { search: 'MAORI' }).some(row => row.code === 'mri'));
  assert.deepEqual(data.filterLanguages(catalog.languages, { search: ' ENG ' }).map(row => row.code), ['eng']);
  assert.equal(data.filterLanguages(catalog.languages, { family: data.UNKNOWN_FAMILY }).length, manifest.family_assignments.missing);
  assert.deepEqual(data.filterLanguages(catalog.languages, { search: 'English eng', family: 'Indo-European', pretrainCluster: '2', posttrainCluster: '2' }).map(row => row.code), ['eng']);
  assert.equal(data.filterLanguages(catalog.languages, { pretrainStatus: 'quantity_unavailable' }).length, 7);
  assert.equal(data.filterLanguages(catalog.languages, { posttrainStatus: 'quantity_unavailable' }).length, 2);
  assert.equal(data.filterLanguages(catalog.languages, { regime: 'diversify-post-training', posttrainCluster: '0' }).length, 0);
  assert.equal(catalog.byCode.get('hru').pretrain.quantity, null);
});

test('pagination handles final pages, empty results, and changed filters', () => {
  const rows = data.filterLanguages(catalog.languages, { regime: 'diversify-post-training' });
  assert.equal(data.paginate(rows).rows.length, 25);
  const last = data.paginate(rows, 99);
  assert.deepEqual([last.page, last.start, last.end, last.total, last.rows.length], [6, 126, 142, 142, 17]);
  const empty = data.paginate([], 3);
  assert.deepEqual([empty.page, empty.pageCount, empty.start, empty.end], [1, 0, 0, 0]);
  assert.equal(data.paginate(rows, 1, 100).rows.length, 100);
});

test('sorting applies to all filtered rows before pagination, with nulls last', () => {
  const filtered = data.filterLanguages(catalog.languages, { pretrainCluster: '2' });
  const original = [...filtered];
  const sorted = data.sortLanguages(filtered, 'pretrain', 'desc');
  assert.deepEqual(filtered, original, 'Sorting must not mutate the index or filtered array');
  assert.equal(sorted[0].pretrain.quantity, Math.max(...filtered.map(row => row.pretrain.quantity)));
  assert.deepEqual(data.paginate(sorted, 2).rows, sorted.slice(25, 50));
  for (const direction of ['asc', 'desc']) {
    const ordered = data.sortLanguages(catalog.languages, 'posttrain', direction);
    const firstMissing = ordered.findIndex(row => row.posttrain.quantity === null);
    assert.ok(firstMissing > 0);
    assert.ok(ordered.slice(firstMissing).every(row => row.posttrain.quantity === null));
  }
  const codes = data.sortLanguages(catalog.languages, 'code', 'desc').map(row => row.code);
  assert.deepEqual(codes, [...codes].sort().reverse());
  const tied = [{ ...catalog.byCode.get('eng'), code: 'zzz' }, { ...catalog.byCode.get('eng'), code: 'aaa' }];
  assert.deepEqual(data.sortLanguages(tied, 'pretrain', 'desc').map(row => row.code), ['aaa', 'zzz']);
});

test('CSV includes all matching languages and preserves raw quantities', () => {
  const rows = data.filterLanguages(catalog.languages, { regime: 'diversify-post-training' });
  const csv = data.toCSV(rows);
  assert.ok(csv.startsWith('\ufeff'));
  assert.equal(csv.split('\r\n').length, 143);
  assert.ok(csv.includes(`"${rows[0].pretrain.quantity}"`));
  const missing = data.toCSV([catalog.byCode.get('hru')]).split('\r\n')[1];
  assert.ok(missing.endsWith(',"-1","uncovered",'));
  const quoted = data.toCSV([{ ...rows[0], name: '=A,"B"\nC' }]);
  assert.ok(quoted.includes('"\'=A,""B""\nC"'));
});

test('inconsistent index or detail data is rejected', () => {
  const invalid = structuredClone(index);
  invalid[0].pretrain.quantity = -1;
  assert.throws(() => data.parseCatalog(manifest, clusters, invalid), /invalid quantity/);
  const row = catalog.byCode.get('eng');
  const detail = read(row.details);
  detail.posttrain.quantity = 1;
  assert.throws(() => data.parseDetails(detail, row), /do not match/);
});

test('catalog requests are shared and detail data loads on demand with retry', async () => {
  const calls = [];
  let englishFailures = 2;
  let areareFailures = 1;
  const requestOptions = [];
  const previousFetch = global.fetch;
  global.fetch = async (url, options) => {
    calls.push(url);
    requestOptions.push(options);
    const pathname = url.split('?')[0];
    if (pathname === 'data/languages/alu.json' && areareFailures-- > 0) throw new TypeError('Failed to fetch');
    if (pathname === 'data/languages/hru.json') return { ok: false, status: 404 };
    if (pathname === 'data/languages/eng.json' && englishFailures-- > 0) {
      return { ok: false, status: 503 };
    }
    return { ok: true, json: async () => read(pathname.replace(/^data\//, '')) };
  };
  try {
    const [first, second] = await Promise.all([data.loadCatalog(), data.loadCatalog()]);
    assert.equal(first, second);
    assert.equal(calls.length, 3);
    assert.ok(calls.slice(1).every(url => url.endsWith(`?v=${manifest.data_version}`)));
    const areare = await data.loadDetails('alu');
    assert.equal(areare.name, "'Are'are");
    assert.equal(calls.filter(url => url.startsWith('data/languages/alu.json')).length, 2);
    assert.equal(requestOptions.at(-1).cache, 'no-store');
    await assert.rejects(data.loadDetails('eng'), error => /503/.test(error.message) && /HTTP 503/.test(error.userMessage));
    const [detail, cached] = await Promise.all([data.loadDetails('eng'), data.loadDetails('eng')]);
    assert.equal(detail, cached);
    assert.equal(detail.code, 'eng');
    assert.equal(calls.filter(url => url === `data/languages/eng.json?v=${manifest.data_version}`).length, 3);
    await assert.rejects(data.loadDetails('hru'), /404/);
    assert.equal(calls.filter(url => url.startsWith('data/languages/hru.json')).length, 1);
    await assert.rejects(data.loadDetails('zzz'), /Unknown language/);
  } finally {
    global.fetch = previousFetch;
  }
});
