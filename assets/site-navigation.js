(() => {
  'use strict';
  const tabs = [...document.querySelectorAll('.site-tab')];
  function updateCurrentTab() {
    const active = tabs.find(tab => tab.hash === location.hash) || tabs[0];
    for (const tab of tabs) {
      if (tab === active) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    }
  }
  window.addEventListener('hashchange', updateCurrentTab);
  updateCurrentTab();
})();
