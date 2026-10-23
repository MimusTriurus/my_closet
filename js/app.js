// Точка входа: загрузка состояния, переключение вкладок, перерисовка.
import { fill, qs, qsa, h, toast } from './ui.js';
import { loadAll, subscribe, notices } from './state.js';
import { renderCloset, closetNav, startAddItem, goRoot } from './closet.js';
import { renderOutfits, outfitsNav, goOutfitsRoot } from './outfits.js';
import { renderCalendar, calendarNav, goCalendarHome } from './calendar.js';
import { renderPacking, packingNav, goPackingRoot } from './packing.js';
import { openSettings } from './settings.js';

// `home` — куда ведёт повторное нажатие на уже открытую вкладку
const TABS = {
  closet: { title: 'Гардероб', render: renderCloset, nav: closetNav, home: goRoot },
  outfits: { title: 'Образы', render: renderOutfits, nav: outfitsNav, home: goOutfitsRoot },
  calendar: { title: 'Календарь', render: renderCalendar, nav: calendarNav, home: goCalendarHome },
  packing: { title: 'Чемодан', render: renderPacking, nav: packingNav, home: goPackingRoot }
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
    inner?.action
      ? h('button', {
        class: 'icon-btn', title: inner.action.title, onclick: inner.action.onclick
      }, inner.action.icon)
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
  // Нажатие на уже открытую вкладку возвращает к её началу — так из
  // подкатегории попадают в корень одним движением, а не тремя «‹».
  // Отметки в режиме выбора при этом не трогаем: их гасит только «Отмена»
  qsa('#tabbar button').forEach(b => b.addEventListener('click', () => {
    const tab = b.dataset.tab;
    if (tab !== current) return setTab(tab);
    TABS[tab].home?.();
    qs('main#views').scrollTop = 0;
  }));
  render();
  // загрузка могла что-то поправить сама — не молчим об этом
  notices.forEach((msg, i) => setTimeout(() => toast(msg, 4200), 600 + i * 800));
}

boot().catch(e => {
  console.error(e);
  document.body.innerHTML = '<p style="padding:24px">Ошибка запуска: ' + e.message + '</p>';
});
