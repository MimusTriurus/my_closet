// Точка входа: загрузка состояния, переключение вкладок, перерисовка.
import { fill, qs, qsa, h } from './ui.js';
import { loadAll, subscribe } from './state.js';
import { renderCloset, startAddItem } from './closet.js';
import { renderOutfits, openOutfitEditor } from './outfits.js';
import { renderCalendar } from './calendar.js';
import { renderPacking } from './packing.js';
import { renderShop } from './shop.js';
import { openSettings } from './settings.js';

const TABS = {
  closet: { title: 'Гардероб', render: renderCloset },
  outfits: { title: 'Образы', render: renderOutfits },
  calendar: { title: 'Календарь', render: renderCalendar },
  packing: { title: 'Чемодан', render: renderPacking },
  shop: { title: 'Каталог', render: renderShop }
};

let current = 'closet';

function renderTopbar() {
  qs('#tb-title').textContent = TABS[current].title;
  const actions = qs('#tb-actions');
  fill(actions, 
    current === 'outfits'
      ? h('button', { class: 'icon-btn', title: 'Новый образ', onclick: () => openOutfitEditor(null) }, '🎨')
      : null,
    h('button', { class: 'icon-btn', title: 'Настройки', onclick: openSettings }, '⚙️')
  );
}

function render() {
  for (const key of Object.keys(TABS)) {
    const el = qs('#view-' + key);
    el.hidden = key !== current;
  }
  const root = qs('#view-' + current);
  TABS[current].render(root);
  renderTopbar();
}

function setTab(tab) {
  current = tab;
  qsa('#tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  qs('main#views').scrollTop = 0;
  render();
}

async function boot() {
  await loadAll();
  subscribe(() => render());
  qsa('#tabbar button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
  render();
}

boot().catch(e => {
  console.error(e);
  document.body.innerHTML = '<p style="padding:24px">Ошибка запуска: ' + e.message + '</p>';
});
