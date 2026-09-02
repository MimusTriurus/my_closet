// Вкладка «Календарь»: планирование образов и отдельных вещей по дням.
import { fill, h, urlFor, openModal, toast, iso, fmtDate } from './ui.js';
import { state, saveDay, dayByDate, outfitById, itemById, emit } from './state.js';
import { pickItems, pickOutfits } from './picker.js';
import { bgCss } from './bgs.js';

let cursor = new Date();
const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль',
  'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

function openDay(dateStr) {
  const day = dayByDate(dateStr) || { id: dateStr, outfitIds: [], itemIds: [] };
  const body = h('div', {});
  const modal = openModal({ title: fmtDate(dateStr), body, full: true });

  function render() {
    const outfits = (day.outfitIds || []).map(outfitById).filter(Boolean);
    const items = (day.itemIds || []).map(itemById).filter(Boolean);
    fill(body, 
      h('div', { class: 'row', style: { gap: '8px', marginBottom: '10px' } },
        h('button', {
          class: 'btn primary', style: { flex: '1' }, onclick: async () => {
            const ids = await pickOutfits({ selected: day.outfitIds, title: 'Образы на день' });
            if (ids) { day.outfitIds = ids; await saveDay(day); render(); }
          }
        }, '👗 Образы'),
        h('button', {
          class: 'btn', style: { flex: '1' }, onclick: async () => {
            const ids = await pickItems({ selected: day.itemIds, title: 'Вещи на день' });
            if (ids) { day.itemIds = ids; await saveDay(day); render(); }
          }
        }, '🧺 Вещи')
      ),
      outfits.length ? h('div', { class: 'section-title' }, 'Образы') : null,
      outfits.length ? h('div', { class: 'grid g2' }, outfits.map(o =>
        h('div', { class: 'tile', style: { background: bgCss(o.bg) } },
          h('img', { src: urlFor(o.preview) }), h('span', { class: 'lbl' }, o.name)))) : null,
      items.length ? h('div', { class: 'section-title' }, 'Вещи') : null,
      items.length ? h('div', { class: 'grid' }, items.map(it =>
        h('div', { class: 'tile', style: { background: bgCss(it.bg) } }, h('img', { src: urlFor(it.img) })))) : null,
      (!outfits.length && !items.length) ? h('div', { class: 'empty' }, 'На этот день ничего не запланировано') : null
    );
  }
  render();
}

export function renderCalendar(root) {
  const y = cursor.getFullYear(), m = cursor.getMonth();
  const first = new Date(y, m, 1);
  const startShift = (first.getDay() + 6) % 7;           // неделя с понедельника
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const todayIso = iso(new Date());

  const cells = [];
  for (let i = 0; i < 42; i++) {
    const dayNum = i - startShift + 1;
    const date = new Date(y, m, dayNum);
    const ds = iso(date);
    const rec = dayByDate(ds);
    const outfit = rec?.outfitIds?.length ? outfitById(rec.outfitIds[0]) : null;
    const firstItem = !outfit && rec?.itemIds?.length ? itemById(rec.itemIds[0]) : null;
    const total = (rec?.outfitIds?.length || 0) + (rec?.itemIds?.length || 0);
    cells.push(h('div', {
      class: 'cal-cell' + (dayNum < 1 || dayNum > daysInMonth ? ' out' : '') + (ds === todayIso ? ' today' : ''),
      onclick: () => openDay(ds)
    },
      h('div', { class: 'd' }, date.getDate()),
      h('div', { class: 'pv' },
        outfit ? h('img', { src: urlFor(outfit.preview) })
          : firstItem ? h('img', { src: urlFor(firstItem.img) }) : null),
      total > 1 ? h('span', { class: 'n' }, total) : null
    ));
  }

  const monthPlanned = state.calendar.filter(d =>
    d.id.startsWith(`${y}-${String(m + 1).padStart(2, '0')}`) && ((d.outfitIds?.length || 0) + (d.itemIds?.length || 0))).length;

  fill(root, 
    h('div', { class: 'row', style: { marginBottom: '10px' } },
      h('button', { class: 'btn btn-sm', onclick: () => { cursor = new Date(y, m - 1, 1); emit(); } }, '‹'),
      h('b', { class: 'spacer center', style: { textAlign: 'center' } }, `${MONTHS[m]} ${y}`),
      h('button', { class: 'btn btn-sm', onclick: () => { cursor = new Date(y, m + 1, 1); emit(); } }, '›')
    ),
    h('div', { class: 'stat-row' },
      h('div', { class: 'stat' }, h('b', {}, monthPlanned), h('span', {}, 'дней распланировано')),
      h('div', { class: 'stat' }, h('b', {}, state.outfits.length), h('span', {}, 'образов в базе'))
    ),
    h('div', { class: 'cal-head' }, WD.map(d => h('div', {}, d))),
    h('div', { class: 'cal-grid' }, cells),
    h('button', { class: 'btn block', style: { marginTop: '12px' }, onclick: () => { cursor = new Date(); emit(); } }, 'Сегодня')
  );
}
