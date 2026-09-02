// Вкладка «Чемодан»: списки вещей и образов на поездку с отметками «уложено».
import { fill, h, urlFor, openModal, toast, confirmDialog, promptDialog, fmtDate, iso } from './ui.js';
import { state, saveTrip, deleteTrip, tripById, itemById, outfitById, emit } from './state.js';
import { uid } from './db.js';
import { pickItems, pickOutfits } from './picker.js';
import { bgCss } from './bgs.js';

function tripProgress(t) {
  const total = (t.itemIds?.length || 0) + (t.outfitIds?.length || 0);
  const done = Object.values(t.checked || {}).filter(Boolean).length;
  return { total, done };
}

function openTrip(trip) {
  const body = h('div', {});
  const modal = openModal({ title: trip.name, body, full: true, onClose: emit });

  function render() {
    const items = (trip.itemIds || []).map(itemById).filter(Boolean);
    const outfits = (trip.outfitIds || []).map(outfitById).filter(Boolean);
    const { total, done } = tripProgress(trip);

    fill(body, 
      h('div', { class: 'stat-row' },
        h('div', { class: 'stat' }, h('b', {}, `${done}/${total}`), h('span', {}, 'уложено')),
        h('div', { class: 'stat' }, h('b', {}, outfits.length), h('span', {}, 'образов')),
        h('div', { class: 'stat' }, h('b', {}, items.length), h('span', {}, 'вещей'))
      ),
      trip.from ? h('p', { class: 'muted small center' }, `${fmtDate(trip.from)} — ${fmtDate(trip.to)}`) : null,
      h('div', { class: 'row', style: { gap: '8px', margin: '10px 0' } },
        h('button', {
          class: 'btn primary', style: { flex: '1' }, onclick: async () => {
            const ids = await pickOutfits({ selected: trip.outfitIds, title: 'Образы в поездку' });
            if (ids) { trip.outfitIds = ids; await saveTrip(trip); render(); }
          }
        }, '👗 Образы'),
        h('button', {
          class: 'btn', style: { flex: '1' }, onclick: async () => {
            const ids = await pickItems({ selected: trip.itemIds, title: 'Вещи в поездку' });
            if (ids) { trip.itemIds = ids; await saveTrip(trip); render(); }
          }
        }, '🧺 Вещи')
      ),
      outfits.length ? h('div', { class: 'section-title' }, 'Образы') : null,
      h('div', { class: 'list' }, outfits.map(o => row(o.id, o.preview, o.name || 'Образ', 'образ', o.bg))),
      items.length ? h('div', { class: 'section-title' }, 'Вещи' ) : null,
      h('div', { class: 'list' }, items.map(it => row(it.id, it.img, it.name || 'Вещь', '', it.bg))),
      (!items.length && !outfits.length) ? h('div', { class: 'empty' }, 'Добавьте вещи и образы в чемодан') : null
    );
  }

  function row(id, blob, title, sub, bg) {
    const checked = !!trip.checked?.[id];
    return h('label', { class: 'lrow', style: { opacity: checked ? .55 : 1 } },
      h('img', { class: 'thumb', src: urlFor(blob), style: { background: bgCss(bg) } }),
      h('div', { class: 't' }, h('b', { style: { textDecoration: checked ? 'line-through' : '' } }, title), sub ? h('span', {}, sub) : null),
      h('input', {
        type: 'checkbox', checked, style: { width: '22px', height: '22px', accentColor: 'var(--accent)' },
        onchange: async e => {
          trip.checked = trip.checked || {};
          trip.checked[id] = e.target.checked;
          await saveTrip(trip); render();
        }
      })
    );
  }
  render();
}

async function newTrip() {
  const name = await promptDialog('Новая поездка', '', 'Куда едем?');
  if (!name) return;
  const today = new Date();
  const later = new Date(Date.now() + 6 * 864e5);
  const trip = { id: uid('tr'), name, from: iso(today), to: iso(later), itemIds: [], outfitIds: [], checked: {}, createdAt: Date.now() };
  await saveTrip(trip);
  openTrip(trip);
}

export function renderPacking(root) {
  const list = state.trips;
  fill(root, 
    list.length ? h('div', { class: 'list' }, list.map(t => {
      const { total, done } = tripProgress(t);
      return h('div', { class: 'lrow', onclick: () => openTrip(t) },
        h('div', { style: { fontSize: '26px' } }, '🧳'),
        h('div', { class: 't' }, h('b', {}, t.name),
          h('span', {}, `${fmtDate(t.from)} — ${fmtDate(t.to)} · уложено ${done}/${total}`)),
        h('button', {
          class: 'btn btn-sm danger', onclick: async e => {
            e.stopPropagation();
            if (await confirmDialog(`Удалить поездку «${t.name}»?`)) await deleteTrip(t.id);
          }
        }, '🗑')
      );
    })) : h('div', { class: 'empty' },
      h('div', { class: 'big' }, '🧳'),
      h('p', {}, 'Поездок пока нет'),
      h('button', { class: 'btn primary', onclick: newTrip }, 'Собрать чемодан')),
    h('button', { class: 'fab', onclick: newTrip }, '+')
  );
}
