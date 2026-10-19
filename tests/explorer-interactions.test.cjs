// A lightweight DOM fixture checks event wiring without browser dependencies.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const data = require('../assets/language-data.js');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const json = file => JSON.parse(read(`data/${data.resolveDataPath(file)}`));
const catalog = data.parseCatalog(json('manifest.json'), json('clusters.json'), json('languages.json'), json('explorer-filters.json'));
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.events = {}; this.dataset = {}; this.style = {}; this.value = ''; this.disabled = false; }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return (this.text || '') + this.children.map(child => typeof child === 'string' ? child : child.textContent).join(''); }
  append(...children) { for (const child of children) { this.children.push(child); if (typeof child !== 'string') child.parent = this; } }
  replaceChildren(...children) { for (const child of this.children) if (typeof child !== 'string') child.parent = null; this.text = ''; this.children = []; this.append(...children); }
  setAttribute(key, value) { this.attributes[key] = value; }
  getAttribute(key) { return this.attributes[key] ?? null; }
  addEventListener(type, handler) { (this.events[type] ||= []).push(handler); }
  dispatchEvent(event) { for (const handler of this.events[event.type] || []) handler({ target: this, preventDefault() {}, ...event }); }
  click() { if (!this.disabled) this.dispatchEvent({ type: 'click' }); }
  focus() { this.focused = true; }
  scrollIntoView() { this.scrolled = true; }
  getBoundingClientRect() { return { width: 1000 }; }
  closest() { return ['button', 'a'].includes(this.tag) ? this : this.parent?.closest() || null; }
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatchEvent({ type: 'close' }); }
  querySelectorAll() { return []; }
  get isConnected() { return !!this.parent; }
  after(item) { const list = this.parent.children; list.splice(list.indexOf(this) + 1, 0, item); item.parent = this.parent; }
  remove() { if (this.parent) { const list = this.parent.children; list.splice(list.indexOf(this), 1); this.parent = null; } }
}
const tick = () => new Promise(resolve => setImmediate(resolve));
test('missing deployed scripts show an error instead of permanent loading', () => {
  const elements = new Map([...read('index.html').matchAll(/\bid="([^"]+)"/g)].map(match => [match[1], new Element('fixture')]));
  const document = new Element('document');
  document.createElement = tag => new Element(tag);
  document.getElementById = id => elements.get(id);
  const context = vm.createContext({ window: {}, document });
  assert.doesNotThrow(() => vm.runInContext(read('assets/language-explorer.js'), context));
  assert.doesNotThrow(() => vm.runInContext(read('assets/language-browser.js'), context));
  assert.match(elements.get('explorer-message').textContent, /required file could not be loaded/);
  for (const view of ['regime', 'pretrain', 'posttrain']) {
    for (const group of elements.get(`panel-${view}`).children) {
      for (const card of group.children) {
        assert.equal(card.children[2].textContent, 'Language data is temporarily unavailable.');
        assert.equal(card.children.at(-1).disabled, true);
      }
    }
  }
});
test('cards, search, pagination, clear, details, and CSV share one explorer', async () => {
  const elements = new Map([...read('index.html').matchAll(/\bid="([^"]+)"/g)].map(match => [match[1], new Element('fixture')]));
  const document = new Element('document');
  document.body = new Element('body');
  document.createElement = tag => new Element(tag);
  document.getElementById = id => elements.get(id);
  for (const element of elements.values()) document.body.append(element);
  const find = id => elements.get(`explorer-${id}`);
  elements.get('resource-profiles-figure').dataset.version = catalog.manifest.data_version;
  const detailRequests = [];
  let downloaded;
  const window = { MappData: { ...data, loadCatalog: async () => catalog, loadDetails: async code => { detailRequests.push(code); return json(`languages/${code}.json`); } } };
  window.getSelection = () => null;
  window.MappData.loadPlotPoints = async () => JSON.parse(read('assets/resource-profile-points.json'));
  const context = vm.createContext({ window, document, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } }, Blob, URL: { createObjectURL(blob) { downloaded = blob; return 'blob:test'; }, revokeObjectURL() {} }, setTimeout() {} });
  vm.runInContext(read('assets/language-explorer.js'), context);
  vm.runInContext(read('assets/language-browser.js'), context);
  await tick();
  document.createElementNS = (_namespace, tag) => new Element(tag);
  require('../assets/resource-profile-chart.js').initialize({ ...window, document, fetch: async () => ({ ok: true, json: async () => JSON.parse(read('assets/resource-profile-points.json')) }) });
  await tick();
  const chart = elements.get('profile-chart-svg');
  const dots = chart.children.filter(item => item.tag === 'circle');
  const legendButtons = elements.get('profile-chart-legend').children;
  assert.equal(elements.get('resource-profile-chart').hidden, false);
  assert.equal(elements.get('profile-paper-figure').open, false);
  assert.equal(dots.length, JSON.parse(read('assets/resource-profile-points.json')).points.length);
  assert.equal(find('count').textContent, `Showing matching languages: ${catalog.languages.length.toLocaleString('en-US')}`);
  assert.equal(find('rows').children.length, 25);
  assert.equal(detailRequests.length, 0);
  assert.equal(elements.get('profile-version-notice').hidden, true);
  elements.get('resource-profiles-figure').dataset.version = 'previous-snapshot';
  document.dispatchEvent({ type: 'mapp:catalog-ready', detail: catalog });
  assert.equal(elements.get('profile-version-notice').hidden, false);
  elements.get('resource-profiles-figure').dataset.version = catalog.manifest.data_version;
  document.dispatchEvent({ type: 'mapp:catalog-ready', detail: catalog });
  assert.equal(elements.get('profile-version-notice').hidden, true);
  const allCards = [];
  for (const view of ['regime', 'pretrain', 'posttrain']) {
    for (const group of elements.get(`panel-${view}`).children) allCards.push(...group.children);
  }
  assert.equal(allCards.length, 14);
  assert.equal(elements.get('language-browser').dataset.dataVersion, catalog.manifest.data_version);
  for (const card of allCards) {
    const count = Number(card.children[1].textContent.replace(/[^0-9]/g, ''));
    const button = card.children.at(-1);
    assert.equal(button.disabled, false);
    button.click();
    assert.equal(find('count').textContent, `Showing matching languages: ${count.toLocaleString('en-US')}`);
    assert.equal(button.getAttribute('aria-pressed'), 'true');
    const matching = new Set(window.MappExplorer.getState().codes);
    assert.equal(dots.filter(dot => dot.dataset.matching === 'true').length, dots.filter(dot => matching.has(dot.dataset.code)).length);
    assert.equal(allCards.filter(item => item.children.at(-1).getAttribute('aria-pressed') === 'true').length, 1);
    assert.equal(find('selected').children.at(-1).tag, 'strong');
    button.click();
    assert.equal(button.getAttribute('aria-pressed'), 'false');
    assert.equal(find('selected').textContent, 'All languages');
    assert.equal(find('count').textContent, `Showing matching languages: ${catalog.languages.length.toLocaleString('en-US')}`);
  }
  allCards[3].children.at(-1).click();
  assert.equal(find('selected').textContent, 'Selected regime: Diversify post-training');
  assert.equal(find('selected').children.at(-1).textContent, 'Diversify post-training');
  const diversifyLegend = legendButtons.find(item => item.textContent.startsWith('Diversify'));
  assert.equal(diversifyLegend.getAttribute('aria-pressed'), 'true');
  diversifyLegend.click();
  assert.equal(find('selected').textContent, 'All languages');
  // A click on the card body activates the same shared filter.
  allCards[3].dispatchEvent({ type: 'click', target: allCards[3].children[0] });
  assert.equal(diversifyLegend.getAttribute('aria-pressed'), 'true');
  assert.equal(allCards[3].dataset.active, 'true');
  assert.equal(dots.find(dot => dot.dataset.code === 'zul').getAttribute('opacity'), '0.8');
  assert.equal(dots.find(dot => dot.dataset.code === 'eng').getAttribute('opacity'), '0.08');
  const beforeDetails = JSON.stringify(window.MappExplorer.getState());
  const beforeRange = find('range').textContent;
  const dialog = elements.get('language-detail-dialog');
  const dialogContent = elements.get('language-detail-content');
  assert.ok(!find('rows').textContent.includes('Zulu'));
  dots.find(dot => dot.dataset.code === 'zul').dispatchEvent({ type: 'keydown', key: 'Enter' });
  await tick();
  assert.equal(dialog.open, true);
  assert.ok(dialogContent.textContent.includes('Zulu (zul)'));
  assert.equal(find('range').textContent, beforeRange);
  assert.equal(JSON.stringify(window.MappExplorer.getState()), beforeDetails);
  elements.get('language-detail-close').click();
  assert.equal(dialog.open, false);
  assert.equal(dialogContent.textContent, '');
  detailRequests.length = 0;
  find('pages').children.at(-1).click();
  assert.equal(find('range').textContent, 'Showing 26–50 of 142');
  find('sort').value = 'posttrain:desc';
  find('sort').dispatchEvent({ type: 'change' });
  assert.equal(find('range').textContent, 'Showing 1–25 of 142');
  const sorted = data.sortLanguages(data.filterLanguages(catalog.languages, { regime: 'diversify-post-training' }), 'posttrain', 'desc');
  assert.equal(find('rows').children[0].children[1].textContent, sorted[0].code);
  find('download').click();
  assert.equal((await downloaded.text()).split('\r\n').length, 143);
  find('clear').click();
  assert.ok(allCards.every(card => card.children.at(-1).getAttribute('aria-pressed') === 'false'));
  find('search').value = 'eng';
  find('search').dispatchEvent({ type: 'input' });
  assert.equal(find('count').textContent, 'Showing matching languages: 1');
  assert.equal(allCards[4].children[2].textContent, '1 matching current filters');
  assert.equal(allCards[3].children[2].textContent, '0 matching current filters');
  assert.equal(allCards[4].children[1].textContent, '86 languages in this group');
  const details = find('rows').children[0].children[5].children[0];
  details.click();
  await tick();
  assert.deepEqual(detailRequests, ['eng']);
  assert.equal(find('rows').children.length, 2);
  assert.ok(find('rows').textContent.includes('Dataset records'));
  details.click();
  assert.equal(find('rows').children.length, 1);
  find('search').value = 'alu';
  find('search').dispatchEvent({ type: 'input' });
  assert.equal(find('count').textContent, 'Showing matching languages: 1');
  find('rows').children[0].children[5].children[0].click();
  await tick();
  assert.deepEqual(detailRequests, ['eng', 'alu']);
  assert.ok(find('rows').textContent.includes("'Are'are (alu)"));
  assert.ok(find('rows').textContent.includes('Not available'));
  assert.ok(!find('rows').textContent.includes('Could not load details'));
  find('search').value = 'no-language-matches-this';
  find('search').dispatchEvent({ type: 'input' });
  assert.equal(find('range').textContent, 'Showing 0–0 of 0');
  assert.equal(find('download').disabled, true);
  find('clear').click();
  find('page-size').value = '100';
  find('page-size').dispatchEvent({ type: 'change' });
  assert.equal(find('rows').children.length, 100);
  find('more').click();
  assert.equal(find('extra').hidden, false);
  find('family').value = data.UNKNOWN_FAMILY;
  find('family').dispatchEvent({ type: 'change' });
  assert.equal(find('count').textContent, `Showing matching languages: ${catalog.issues.missingFamily}`);

  // Dropdown changes and card toggles share state; deselection keeps other filters.
  find('regime').value = 'diversify-post-training';
  find('regime').dispatchEvent({ type: 'change' });
  const diversify = allCards[3].children.at(-1);
  assert.equal(diversify.getAttribute('aria-pressed'), 'true');
  diversify.click();
  assert.equal(diversify.getAttribute('aria-pressed'), 'false');
  assert.equal(find('regime').value, '');
  assert.equal(find('family').value, data.UNKNOWN_FAMILY);
  assert.equal(find('count').textContent, `Showing matching languages: ${catalog.issues.missingFamily}`);
  find('pretrain-cluster').value = '2';
  find('pretrain-cluster').dispatchEvent({ type: 'change' });
  find('posttrain-cluster').value = '-1';
  find('posttrain-cluster').dispatchEvent({ type: 'change' });
  assert.equal(allCards[8].children.at(-1).getAttribute('aria-pressed'), 'true');
  assert.equal(allCards[13].children.at(-1).getAttribute('aria-pressed'), 'true');
  allCards[8].children.at(-1).click();
  assert.equal(find('pretrain-cluster').value, '');
  assert.equal(find('posttrain-cluster').value, '-1');
  assert.equal(allCards[13].children.at(-1).getAttribute('aria-pressed'), 'true');
  find('clear').click();
  assert.ok(allCards.every(card => card.children.at(-1).getAttribute('aria-pressed') === 'false'));
  assert.ok(legendButtons.every(button => button.getAttribute('aria-pressed') === 'false'));
  const overlappingDot = dots.find(dot => dots.filter(other => Math.hypot(Number(other.getAttribute('cx')) - Number(dot.getAttribute('cx')), Number(other.getAttribute('cy')) - Number(dot.getAttribute('cy'))) <= 7).length > 1);
  overlappingDot.click();
  const picker = elements.get('profile-point-picker');
  assert.equal(picker.hidden, false);
  const choices = picker.children.at(-1).children;
  assert.ok(choices.length > 1);
  const chosenCode = choices[1].textContent.match(/\(([a-z]{3})\)$/)[1];
  const rangeBeforePick = find('range').textContent;
  choices[1].click();
  await tick();
  assert.ok(dialogContent.textContent.includes(`(${chosenCode})`));
  assert.equal(find('range').textContent, rangeBeforePick);
  dialog.close();
  const noPretrainingLegend = legendButtons.find(item => item.textContent.startsWith('No pre-training'));
  noPretrainingLegend.click();
  assert.ok(dots.every(dot => dot.dataset.matching === 'false'));
  assert.match(elements.get('profile-chart-status').textContent, /0 matching languages in the plot/);
  assert.ok(window.MappExplorer.getState().codes.length > 0);
  noPretrainingLegend.click();
  // Opening a second language before the first resolves cannot show stale details.
  let resolveOld;
  const realLoadDetails = window.MappData.loadDetails;
  window.MappData.loadDetails = code => code === 'eng' ? new Promise(resolve => { resolveOld = resolve; }) : realLoadDetails(code);
  window.MappExplorer.openDetails('eng');
  window.MappExplorer.openDetails('alu');
  await tick();
  resolveOld(json('languages/eng.json'));
  await tick();
  assert.ok(dialogContent.textContent.includes("'Are'are (alu)"));
  assert.ok(!dialogContent.textContent.includes('English (eng)'));
  dialog.close();
  window.MappData.loadDetails = realLoadDetails;
  // All metadata filters combine with the full index, shared plot and CSV.
  find('clear').click();
  find('iso-scope').value = 'Individual language';
  find('iso-scope').dispatchEvent({ type: 'change' });
  find('iso-language-type').value = 'Living';
  find('iso-language-type').dispatchEvent({ type: 'change' });
  find('classification-status').value = 'isolate';
  find('classification-status').dispatchEvent({ type: 'change' });
  const isolates = catalog.languages.filter(row => row.iso_scope === 'Individual language' && row.iso_language_type === 'Living' && row.classification_status === 'isolate');
  assert.deepEqual(Array.from(window.MappExplorer.getState().codes).sort(), isolates.map(row => row.code).sort());
  assert.match(find('selected').textContent, /ISO_scope: Individual language/);
  assert.match(find('selected').textContent, /classification_status: isolate/);
  assert.equal(find('more').textContent, 'More filters');
  find('download').click();
  assert.equal((await downloaded.text()).split('\r\n').length, isolates.length + 1);
  const isolateCodes = new Set(isolates.map(row => row.code));
  assert.equal(dots.filter(dot => dot.dataset.matching === 'true').length, dots.filter(dot => isolateCodes.has(dot.dataset.code)).length);
  find('search').value = 'hru';
  find('search').dispatchEvent({ type: 'input' });
  assert.equal(find('count').textContent, 'Showing matching languages: 1');
  find('clear').click();
  for (const id of ['iso-scope', 'iso-language-type', 'classification-status']) assert.equal(find(id).value, '');
  assert.equal(find('selected').textContent, 'All languages');
});
