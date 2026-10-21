// Вкладка «Календарь»: какой образ надет в какой день. Только образы —
// отдельные вещи сюда не кладутся, иначе у счётчика носок два источника.
import {
  fill, h, urlFor, openModal, actionSheet, confirmDialog, iso, fmtDate, plural
} from './ui.js';
import { state, saveDay, dayByDate, outfitById, itemById, archivedInOutfit, emit } from './state.js';
import { pickOutfits } from './picker.js';
import { askArchivedInDay, copyOutfit } from './outfits.js';
import { bgCss } from './bgs.js';

let cursor = new Date();
const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль',
  'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

/**
 * Сверяет добавленные образы: нет ли в них вещей, ушедших в архив.
 * Спрашиваем только про сегодня и вперёд — см. askArchivedInDay.
 */
async function vetOutfits(dateStr, ids, before) {
  if (dateStr < iso(new Date())) return ids;        // строки «ГГГГ-ММ-ДД» сравниваются как даты
  const out = [...ids];
  for (const id of ids.filter(x => !before.includes(x))) {
    const o = outfitById(id);
    const gone = o ? archivedInOutfit(o) : [];
    if (!gone.length) continue;
    const act = await askArchivedInDay(o, gone);
    if (act === 'keep') continue;
    // и отказ, и сборка копии убирают исходный образ со дня
    out.splice(out.indexOf(id), 1);
    if (act !== 'copy') continue;
    const copy = await copyOutfit(o, gone.map(i => i.id));
    if (copy) out.push(copy.id);
  }
  return out;
}

function openDay(dateStr) {
  const day = dayByDate(dateStr) || { id: dateStr, outfitIds: [], itemIds: [] };
  const body = h('div', {});
  openModal({ title: fmtDate(dateStr), body, full: true });

  async function dropOutfit(id) {
    day.outfitIds = (day.outfitIds || []).filter(x => x !== id);
    await saveDay(day);
    render();
  }

  function render() {
    const outfits = (day.outfitIds || []).map(outfitById).filter(Boolean);
    // отдельные вещи в календарь больше не кладутся — только образы, иначе
    // у счётчика носок два источника. Но то, что уже записано, не прячем
    const legacy = (day.itemIds || []).map(itemById).filter(Boolean);

    fill(body,
      h('button', {
        // по одному: нажатие на образ и есть выбор. Несколько образов на день
        // бывают, но редко — ради них незачем просить «Готово» каждый раз
        class: 'btn primary block', onclick: async () => {
          const picked = await pickOutfits({ title: 'Выбрать образ', multi: false });
          if (!picked) return;
          const before = day.outfitIds || [];
          const ids = [...new Set([...before, ...picked])];
          day.outfitIds = await vetOutfits(dateStr, ids, before);
          await saveDay(day);
          render();
        }
      }, outfits.length ? '👗 Добавить образ' : '👗 Выбрать образ'),

      outfits.length ? h('div', { class: 'section-title' }, 'Надето') : null,
      outfits.length ? h('div', { class: 'grid g2' }, outfits.map(o => {
        const gone = archivedInOutfit(o).length;
        return h('div', {
          class: 'tile' + (gone ? ' has-gone' : ''), style: { background: bgCss(o.bg) },
          onclick: async () => {
            const act = await actionSheet(o.name || 'Образ', [
              { id: 'drop', icon: '✕', label: 'Убрать с этого дня' }
            ]);
            if (act === 'drop') dropOutfit(o.id);
          }
        },
          h('img', { src: urlFor(o.preview) }),
          gone ? h('span', { class: 'gone-mark', title: 'В образе есть вещь из архива' }, '◷') : null,
          h('span', { class: 'lbl' }, o.name || 'Образ'));
      })) : null,

      legacy.length ? h('div', { class: 'section-title' }, 'Вещи из старых записей') : null,
      legacy.length ? h('p', { class: 'muted small', style: { margin: '0 0 8px' } },
        'Отдельные вещи в календарь больше не добавляются — только образы.') : null,
      legacy.length ? h('div', { class: 'grid' }, legacy.map(it => h('div', {
        class: 'tile', style: { background: bgCss(it.bg) },
        onclick: async () => {
          if (!await confirmDialog('Убрать вещь с этого дня?', 'Убрать')) return;
          day.itemIds = (day.itemIds || []).filter(x => x !== it.id);
          await saveDay(day);
          render();
        }
      }, h('img', { src: urlFor(it.img) })))) : null,

      (!outfits.length && !legacy.length)
        ? h('div', { class: 'empty' },
          h('div', { class: 'big' }, '📅'),
          h('p', {}, 'На этот день ничего не отмечено.'))
        : null
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

  const prefix = `${y}-${String(m + 1).padStart(2, '0')}`;
  const monthDays = state.calendar.filter(d =>
    d.id.startsWith(prefix) && ((d.outfitIds?.length || 0) + (d.itemIds?.length || 0)));

  fill(root, 
    h('div', { class: 'row', style: { marginBottom: '10px' } },
      h('button', { class: 'btn btn-sm', onclick: () => { cursor = new Date(y, m - 1, 1); emit(); } }, '‹'),
      h('b', { class: 'spacer center', style: { textAlign: 'center' } }, `${MONTHS[m]} ${y}`),
      h('button', { class: 'btn btn-sm', onclick: () => { cursor = new Date(y, m + 1, 1); emit(); } }, '›')
    ),
    // одна строка вместо двух крупных цифр: счётчик носок живёт в карточке
    // вещи, где он что-то решает, а здесь важно только, что месяц не пуст
    h('p', { class: 'muted small center', style: { margin: '0 0 10px' } },
      monthDays.length
        ? plural(monthDays.length, 'день отмечен', 'дня отмечено', 'дней отмечено') + ' в этом месяце'
        : 'В этом месяце ничего не отмечено'),
    h('div', { class: 'cal-head' }, WD.map(d => h('div', {}, d))),
    h('div', { class: 'cal-grid' }, cells),
    h('button', { class: 'btn block', style: { marginTop: '12px' }, onclick: () => { cursor = new Date(); emit(); } }, 'Сегодня')
  );
}
