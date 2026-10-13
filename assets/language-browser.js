// Counts and example memberships verified against the supplied language-level
// pretrain_cluster_results.csv and posttrain_cluster_results.csv.
const languageGroups = {
  regime: [
    {
      name: 'Expand pre-training', count: 237, tone: 'expand',
      description: 'Limited pre-training resources call for a stronger foundation of quality-controlled text.',
      examples: [{ code: 'rhg', name: 'Rohingya' }, { code: 'hre', name: 'Hre' }, { code: 'agq', name: 'Aghem' }],
    },
    {
      name: 'Bootstrap post-training', count: 1433, tone: 'bootstrap',
      description: 'Existing pre-training resources need initial instruction and task-oriented supervision.',
      examples: [{ code: 'nav', name: 'Navajo' }, { code: 'mhl', name: 'Mauwake' }, { code: 'udu', name: 'Uduk' }],
    },
    {
      name: 'Scale up post-training', count: 274, tone: 'scale',
      description: 'Stronger pre-training foundations coexist with small post-training datasets that need expansion.',
      examples: [{ code: 'abk', name: 'Abkhazian' }, { code: 'ain', name: 'Ainu' }, { code: 'abq', name: 'Abaza' }],
    },
    {
      name: 'Diversify post-training', count: 142, tone: 'diversify',
      description: 'Substantial pre-training resources coexist with post-training supervision concentrated in limited tasks.',
      examples: [{ code: 'zul', name: 'Zulu' }, { code: 'mri', name: 'Māori' }, { code: 'lao', name: 'Lao' }],
    },
    {
      name: 'Refine both stages', count: 86, tone: 'refine',
      description: 'Large resources at both stages benefit from provenance auditing, balanced tasks, and targeted gap filling.',
      examples: [{ code: 'eng', name: 'English' }, { code: 'deu', name: 'German' }, { code: 'fra', name: 'French' }, { code: 'hrv', name: 'Croatian' }],
    },
  ],
  pretrain: [
    {
      name: 'Cluster 0', count: 237,
      description: 'Limited pre-training text is available from a narrow range of sources.',
      examples: [{ code: 'rhg', name: 'Rohingya' }, { code: 'hre', name: 'Hre' }, { code: 'agq', name: 'Aghem' }],
    },
    {
      name: 'Cluster 1', count: 1433,
      description: 'Intermediate pre-training resources often draw on language-identification corpora as seeds for expansion.',
      examples: [{ code: 'udu', name: 'Uduk' }, { code: 'mbj', name: 'Nadëb' }, { code: 'heg', name: 'Helong' }],
    },
    {
      name: 'Cluster 2', count: 502,
      description: 'Large, predominantly collected corpora provide a foundation for language adaptation.',
      examples: [{ code: 'eng', name: 'English' }, { code: 'spa', name: 'Spanish' }, { code: 'zul', name: 'Zulu' }],
    },
    {
      name: 'No usable resources', count: 4912, tone: 'unavailable', unavailable: true,
      description: 'No usable pre-training quantity is recorded for these languages in the surveyed inventory.',
      examples: [{ code: 'hru', name: 'Hruso' }, { code: 'oon', name: 'Önge' }, { code: 'anq', name: 'Jarawa (India)' }],
    },
  ],
  posttrain: [
    {
      name: 'Cluster 0', count: 296,
      description: 'Small post-training datasets are dominated by synthetic translation with limited collection support.',
      examples: [{ code: 'abq', name: 'Abaza' }, { code: 'dak', name: 'Dakota' }, { code: 'kgp', name: 'Kaingang' }],
    },
    {
      name: 'Cluster 1', count: 142,
      description: 'Intermediate post-training resources center on expert-created translations with shared underlying content.',
      examples: [{ code: 'zul', name: 'Zulu' }, { code: 'mri', name: 'Māori' }, { code: 'lao', name: 'Lao' }],
    },
    {
      name: 'Cluster 2', count: 86,
      description: 'Large post-training resources combine substantial synthetic translation with broader collection support.',
      examples: [{ code: 'eng', name: 'English' }, { code: 'deu', name: 'German' }, { code: 'fra', name: 'French' }, { code: 'hrv', name: 'Croatian' }],
    },
    {
      name: 'No usable resources', count: 6560, tone: 'unavailable', unavailable: true,
      description: 'No usable post-training quantity is recorded for these languages in the surveyed inventory.',
      examples: [{ code: 'nav', name: 'Navajo' }, { code: 'mhl', name: 'Mauwake' }, { code: 'hre', name: 'Hre' }, { code: 'hru', name: 'Hruso' }, { code: 'oon', name: 'Önge' }],
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

  const createCard = (group) => {
    const card = element('article', 'resource-card');
    if (group.tone) card.dataset.tone = group.tone;
    card.append(element('h3', '', group.name));
    const count = element('p', 'group-count');
    count.append(element('strong', '', group.count.toLocaleString('en-US')), ' languages');
    card.append(count, element('p', 'group-description', group.description));

    const examples = element('ul', 'group-examples');
    examples.setAttribute('aria-label', 'Representative languages');
    group.examples.forEach((language) => examples.append(element('li', '', language.name)));
    const button = element('button', 'view-languages', 'View languages');
    button.type = 'button';
    button.disabled = true;
    card.append(examples, button);
    return card;
  };

  Object.entries(languageGroups).forEach(([view, groups]) => {
    const panel = document.getElementById(`panel-${view}`);
    const grid = element('div', 'group-grid');
    groups.filter((group) => !group.unavailable).forEach((group) => grid.append(createCard(group)));
    panel.append(grid);
    const unavailable = groups.find((group) => group.unavailable);
    if (unavailable) {
      const separateGroup = element('div', 'unavailable-group');
      separateGroup.append(createCard(unavailable));
      panel.append(separateGroup);
    }
  });

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
})();
