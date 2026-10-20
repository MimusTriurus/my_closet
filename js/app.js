// Точка входа: загрузка состояния, переключение вкладок, перерисовка.
import { fill, qs, qsa, h, toast } from './ui.js';
import { loadAll, subscribe, notices } from './state.js';
import { renderCloset, closetNav, startAddItem } from './closet.js';
import { renderOutfits, openOutfitEditor } from './outfits.js';
import { renderCalendar } from './calendar.js';
import { renderPacking } from './packing.js';
import { openSettings } from './settings.js';

const TABS = {
  closet: { title: 'Гардероб', render: renderCloset, nav: closetNav },
  outfits: { title: 'Образы', render: renderOutfits },
  calendar: { title: 'Календарь', render: renderCalendar },
  packing: { title: 'Чемодан', render: renderPacking }
};

let current = 'closet';

function renderTopbar() {
  // вкладка может быть вложенной (гардероб ходит по категориям) —
  // тогда она сама говорит, что написать в заголовке и куда ведёт «назад»
  const inner = TABS[current].nav?.() || null;
  qs('#tb-title').textContent = inner?.title || TABS[current].title;

  const back = qs('#tb-back');
  back.hidden = !inner?.back;
  back.onclick = inner?.back || null;

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
  // загрузка могла что-то поправить сама — не молчим об этом
  notices.forEach((msg, i) => setTimeout(() => toast(msg, 4200), 600 + i * 800));
}

boot().catch(e => {
  console.error(e);
  document.body.innerHTML = '<p style="padding:24px">Ошибка запуска: ' + e.message + '</p>';
});
