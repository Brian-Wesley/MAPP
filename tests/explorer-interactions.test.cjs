// A lightweight DOM fixture checks event wiring without browser dependencies.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const data = require('../assets/language-data.js');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const json = file => JSON.parse(read(`data/${data.resolveDataPath(file)}`));
const catalog = data.parseCatalog(json('manifest.json'), json('clusters.json'), json('languages.json'));
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.events = {}; this.dataset = {}; this.value = ''; this.disabled = false; }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return (this.text || '') + this.children.map(child => typeof child === 'string' ? child : child.textContent).join(''); }
  append(...children) { for (const child of children) { this.children.push(child); if (typeof child !== 'string') child.parent = this; } }
  replaceChildren(...children) { for (const child of this.children) if (typeof child !== 'string') child.parent = null; this.text = ''; this.children = []; this.append(...children); }
  setAttribute(key, value) { this.attributes[key] = value; }
  getAttribute(key) { return this.attributes[key] ?? null; }
  addEventListener(type, handler) { (this.events[type] ||= []).push(handler); }
  dispatchEvent(event) { for (const handler of this.events[event.type] || []) handler({ target: this, ...event }); }
  click() { if (!this.disabled) this.dispatchEvent({ type: 'click' }); }
  focus() { this.focused = true; }
  scrollIntoView() { this.scrolled = true; }
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
  const context = vm.createContext({ window, document, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } }, Blob, URL: { createObjectURL(blob) { downloaded = blob; return 'blob:test'; }, revokeObjectURL() {} }, setTimeout() {} });
  vm.runInContext(read('assets/language-explorer.js'), context);
  vm.runInContext(read('assets/language-browser.js'), context);
  await tick();
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
  }
  allCards[3].children.at(-1).click();
  assert.equal(find('selected').textContent, 'Selected regime: Diversify post-training');
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
});
