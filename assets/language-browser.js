// Editorial descriptions and preferred examples. Membership, names and counts
// are resolved from the shared export; no resource thresholds are used here.
const languageGroups = {
  regime: [
    {
      id: 'expand-pre-training', name: 'Expand pre-training', tone: 'expand',
      description: 'Limited pre-training resources call for a stronger foundation of quality-controlled text.',
      examples: ['rhg', 'hre', 'agq'],
    },
    {
      id: 'bootstrap-post-training', name: 'Bootstrap post-training', tone: 'bootstrap',
      description: 'Existing pre-training resources need initial instruction and task-oriented supervision.',
      examples: ['nav', 'mhl', 'udu'],
    },
    {
      id: 'scale-up-post-training', name: 'Scale up post-training', tone: 'scale',
      description: 'Stronger pre-training foundations coexist with small post-training datasets that need expansion.',
      examples: ['abk', 'ain', 'abq'],
    },
    {
      id: 'diversify-post-training', name: 'Diversify post-training', tone: 'diversify',
      description: 'Substantial pre-training resources coexist with post-training supervision concentrated in limited tasks.',
      examples: ['zul', 'mri', 'lao'],
    },
    {
      id: 'refine-both-stages', name: 'Refine both stages', tone: 'refine',
      description: 'Large resources at both stages benefit from provenance auditing, balanced tasks, and targeted gap filling.',
      examples: ['eng', 'deu', 'fra', 'hrv'],
    },
    {
      id: 'neither-stage-eligible', name: 'No pre-training yet', tone: 'unavailable',
      description: 'No usable resources are recorded at either training stage in the surveyed inventory.',
      examples: ['hru', 'oon', 'anq'],
    },
  ],
  pretrain: [
    {
      cluster: 0, name: 'Cluster 0',
      description: 'Limited pre-training text is available from a narrow range of sources.',
      examples: ['rhg', 'hre', 'agq'],
    },
    {
      cluster: 1, name: 'Cluster 1',
      description: 'Intermediate pre-training resources often draw on language-identification corpora as seeds for expansion.',
      examples: ['udu', 'mbj', 'heg'],
    },
    {
      cluster: 2, name: 'Cluster 2',
      description: 'Large, predominantly collected corpora provide a foundation for language adaptation.',
      examples: ['eng', 'spa', 'zul'],
    },
    {
      cluster: -1, name: 'No usable resources', tone: 'unavailable', unavailable: true,
      description: 'No usable pre-training quantity is recorded for these languages in the surveyed inventory.',
      examples: ['hru', 'oon', 'anq'],
    },
  ],
  posttrain: [
    {
      cluster: 0, name: 'Cluster 0',
      description: 'Small post-training datasets are dominated by synthetic translation with limited collection support.',
      examples: ['abq', 'dak', 'kgp'],
    },
    {
      cluster: 1, name: 'Cluster 1',
      description: 'Intermediate post-training resources center on expert-created translations with shared underlying content.',
      examples: ['zul', 'mri', 'lao'],
    },
    {
      cluster: 2, name: 'Cluster 2',
      description: 'Large post-training resources combine substantial synthetic translation with broader collection support.',
      examples: ['eng', 'deu', 'fra', 'hrv'],
    },
    {
      cluster: -1, name: 'No usable resources', tone: 'unavailable', unavailable: true,
      description: 'No usable post-training quantity is recorded for these languages in the surveyed inventory.',
      examples: ['nav', 'mhl', 'hre', 'hru', 'oon'],
    },
  ],
};

(() => {
  const browser = document.getElementById('language-browser');
  if (!browser) return;

  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const cards = [];
  let catalog;
  let matchingCodes;
  const createCard = (group, view) => {
    const card = element('article', 'resource-card');
    if (group.tone) card.dataset.tone = group.tone;
    card.append(element('h3', '', group.name));
    const count = element('p', 'group-count');
    count.append(element('strong', '', '—'), ' languages in this group');
    const matching = element('p', 'group-matching', 'Loading matching count…');
    card.append(count, matching, element('p', 'group-description', group.description));

    const examples = element('ul', 'group-examples');
    examples.setAttribute('aria-label', 'Representative languages');
    const button = element('button', 'view-languages', 'View languages');
    button.type = 'button';
    button.disabled = true;
    const filter = view === 'regime'
      ? { regime: group.id }
      : { [`${view}Cluster`]: String(group.cluster) };
    button.addEventListener('click', () => window.MappExplorer.select(filter));
    button.setAttribute('aria-controls', 'language-explorer');
    button.setAttribute('aria-label', `View all languages in ${view === 'regime' ? '' : view === 'pretrain' ? 'pre-training ' : 'post-training '}${group.name}`);
    cards.push({ card, count, matching, examples, group, button, filter, members: [] });
    card.append(examples, button);
    return card;
  };

  Object.entries(languageGroups).forEach(([view, groups]) => {
    const panel = document.getElementById(`panel-${view}`);
    const grid = element('div', 'group-grid');
    groups.filter((group) => !group.unavailable).forEach((group) => grid.append(createCard(group, view)));
    panel.append(grid);
    const unavailable = groups.find((group) => group.unavailable);
    if (unavailable) {
      const separateGroup = element('div', 'unavailable-group');
      separateGroup.append(createCard(unavailable, view));
      panel.append(separateGroup);
    }
  });

  const updateMatchingCounts = () => {
    if (!catalog) return;
    cards.forEach(({ members, matching }) => {
      const total = matchingCodes ? members.filter(row => matchingCodes.has(row.code)).length : members.length;
      matching.textContent = `${total.toLocaleString('en-US')} matching current filters`;
    });
  };
  const updateCounts = (value) => {
    const figure = document.getElementById('resource-profiles-figure');
    const notice = document.getElementById('profile-version-notice');
    if (figure && notice) notice.hidden = figure.dataset.version === value.manifest.data_version;
    if (catalog === value) return;
    catalog = value;
    browser.dataset.dataVersion = catalog.manifest.data_version;
    cards.forEach(card => {
      card.members = window.MappData.filterLanguages(catalog.languages, card.filter);
      card.count.replaceChildren(element('strong', '', card.members.length.toLocaleString('en-US')), ' languages in this group');
      const preferred = card.group.examples.map(code => catalog.byCode.get(code)).filter(row => row && card.members.includes(row));
      const examples = [...preferred, ...window.MappData.sortLanguages(card.members).filter(row => !preferred.includes(row))].slice(0, card.group.examples.length);
      card.examples.replaceChildren(...examples.map(row => element('li', '', row.name)));
      card.button.disabled = false;
    });
    updateMatchingCounts();
  };
  document.addEventListener('mapp:results-changed', event => {
    matchingCodes = new Set(event.detail.codes);
    updateMatchingCounts();
  });
  document.addEventListener('mapp:catalog-ready', event => updateCounts(event.detail));

  const tabs = [...browser.querySelectorAll('[role="tab"]')];
  const activate = (activeTab) => {
    tabs.forEach((tab) => {
      const selected = tab === activeTab;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      document.getElementById(tab.getAttribute('aria-controls')).hidden = !selected;
    });
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activate(tab));
    tab.addEventListener('keydown', (event) => {
      let nextIndex;
      if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === 'Home') nextIndex = 0;
      else if (event.key === 'End') nextIndex = tabs.length - 1;
      else return;
      event.preventDefault();
      activate(tabs[nextIndex]);
      tabs[nextIndex].focus();
    });
  });
  const showLoadError = () => {
    cards.forEach(({ matching, button }) => {
      matching.textContent = 'Language data is temporarily unavailable.';
      button.disabled = true;
    });
  };
  if (!window.MappData || !window.MappExplorer) showLoadError();
  else window.MappData.loadCatalog().then(updateCounts).catch(showLoadError);
})();
