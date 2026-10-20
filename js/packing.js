// Вкладка «Чемодан»: список вещей на поездку с отметками «уложено».
// Поездка хранит только идентификаторы вещей — образы здесь не живут,
// кнопка «из Образа» просто разворачивает образ в его вещи.
import { fill, h, urlFor, openModal, toast, confirmDialog, promptDialog, actionSheet } from './ui.js';
import { state, saveTrip, deleteTrip, itemById, outfitById, emit } from './state.js';
import { uid } from './db.js';
import { pickItems, pickOutfits } from './picker.js';
import { bgCss } from './bgs.js';

let archiveOpen = false;

const progress = t => ({
  total: t.itemIds?.length || 0,
  done: (t.itemIds || []).filter(id => t.checked?.[id]).length
});

/** Добавляет вещи, не трогая уже добавленные. Возвращает, сколько новых. */
async function addItems(trip, ids) {
  const have = new Set(trip.itemIds || []);
  const alive = ids.filter(id => itemById(id));
  const fresh = alive.filter(id => !have.has(id));
  if (!alive.length) { toast('Добавлять нечего'); return 0; }
  if (!fresh.length) { toast('Эти вещи уже в списке'); return 0; }
  trip.itemIds = [...(trip.itemIds || []), ...fresh];
  await saveTrip(trip);
  toast(fresh.length === alive.length
    ? `Добавлено ${fresh.length}`
    : `Добавлено ${fresh.length}, уже были ${alive.length - fresh.length}`);
  return fresh.length;
}

/** Выбор поездки, из которой копируются вещи (галочки не переносим). */
function pickTrip(exceptId) {
  return new Promise(res => {
    const list = state.trips.filter(t => t.id !== exceptId);
    let done = false;
    const modal = openModal({
      title: 'Из какой поездки',
      body: list.length
        ? h('div', { class: 'list' }, list.map(t => h('button', {
          class: 'btn block', style: { textAlign: 'left' },
          onclick: () => { done = true; res(t); modal.close(); }
        }, `${t.done ? '✓ ' : ''}${t.name} · ${t.itemIds?.length || 0} вещей`)))
        : h('div', { class: 'empty' }, 'Других поездок пока нет'),
      onClose: () => { if (!done) res(null); }
    });
  });
}

function openTrip(trip) {
  const body = h('div', {});
  const modal = openModal({ title: trip.name, body, full: true, onClose: emit });

  function render() {
    const items = (trip.itemIds || []).map(itemById).filter(Boolean);
    const { total, done } = progress(trip);

    fill(body,
      h('div', { class: 'stat-row' },
        h('div', { class: 'stat' }, h('b', {}, `${done}/${total}`), h('span', {}, 'уложено')),
        h('div', { class: 'stat' }, h('b', {}, trip.done ? '✓' : '—'), h('span', {}, trip.done ? 'состоялась' : 'предстоит'))
      ),

      h('div', { class: 'section-title' }, 'Добавить вещи'),
      h('div', { class: 'row', style: { gap: '8px' } },
        h('button', {
          class: 'btn', style: { flex: '1' }, onclick: async () => {
            const ids = await pickItems({ title: 'Вещи в поездку', selected: trip.itemIds || [] });
            if (!ids) return;
            // выбор приходит полным списком: что сняли — убираем
            trip.itemIds = ids.filter(id => itemById(id));
            await saveTrip(trip);
            render();
          }
        }, '🧺 из Гардероба'),
        h('button', {
          class: 'btn', style: { flex: '1' }, onclick: async () => {
            const ids = await pickOutfits({ title: 'Развернуть образ в вещи' });
            if (!ids || !ids.length) return;
            const fromOutfits = ids.flatMap(id => (outfitById(id)?.layers || []).map(l => l.itemId));
            await addItems(trip, [...new Set(fromOutfits)]);
            render();
          }
        }, '👗 из Образа'),
        h('button', {
          class: 'btn', style: { flex: '1' }, onclick: async () => {
            const src = await pickTrip(trip.id);
            if (!src) return;
            await addItems(trip, src.itemIds || []);
            render();
          }
        }, '🧳 из Поездки')
      ),

      items.length ? h('div', { class: 'section-title' }, `Список · ${total} вещей` ) : null,
      h('div', { class: 'list' }, items.map(row)),
      items.length ? null : h('div', { class: 'empty' }, 'Список пуст — добавьте вещи кнопками выше'),

      h('div', { class: 'section-title' }, 'Поездка'),
      h('div', { class: 'list' },
        h('button', {
          class: 'btn block', onclick: async () => {
            trip.done = !trip.done;
            await saveTrip(trip);
            toast(trip.done ? 'Отмечена как состоявшаяся' : 'Возвращена в активные');
            render();
          }
        }, trip.done ? '↩ Вернуть в активные' : '✓ Поездка состоялась'),
        h('button', {
          class: 'btn block', onclick: async () => {
            const n = await promptDialog('Переименовать поездку', trip.name, 'Название');
            if (!n) return;
            trip.name = n;
            await saveTrip(trip);
            modal.root.querySelector('.modal-head h2').textContent = n;
            render();
          }
        }, '✎ Переименовать'),
        h('button', {
          class: 'btn block danger', onclick: async () => {
            if (await confirmDialog(`Удалить поездку «${trip.name}»? Вещи останутся в гардеробе.`)) {
              await deleteTrip(trip.id);
              modal.close();
            }
          }
        }, '🗑 Удалить поездку')
      )
    );
  }

  function row(it) {
    const checked = !!trip.checked?.[it.id];
    return h('div', { class: 'lrow', style: { opacity: checked ? .55 : 1 } },
      h('input', {
        type: 'checkbox', checked,
        style: { width: '22px', height: '22px', accentColor: 'var(--accent)', flex: '0 0 auto' },
        onchange: async e => {
          trip.checked = trip.checked || {};
          trip.checked[it.id] = e.target.checked;
          await saveTrip(trip);
          render();
        }
      }),
      h('img', { class: 'thumb', src: urlFor(it.img), style: { background: bgCss(it.bg) } }),
      h('div', { class: 't' },
        h('b', { style: { textDecoration: checked ? 'line-through' : '' } }, it.name || 'Без названия')),
      h('button', {
        class: 'btn btn-sm', title: 'Убрать из поездки',
        onclick: async () => {
          trip.itemIds = trip.itemIds.filter(x => x !== it.id);
          if (trip.checked) delete trip.checked[it.id];
          await saveTrip(trip);
          render();
        }
      }, '✕')
    );
  }

  render();
}

async function newTrip() {
  const name = await promptDialog('Новая поездка', '', 'Название, например «Лиссабон, май»');
  if (!name) return;
  const trip = { id: uid('tr'), name, itemIds: [], checked: {}, done: false, createdAt: Date.now() };
  await saveTrip(trip);
  openTrip(trip);
}

function tripRow(t) {
  const { total, done } = progress(t);
  return h('div', { class: 'lrow', onclick: () => openTrip(t) },
    h('div', { style: { fontSize: '26px', opacity: t.done ? .5 : 1 } }, '🧳'),
    h('div', { class: 't' },
      h('b', {}, t.name),
      h('span', {}, t.done ? `состоялась · ${total} вещей` : `уложено ${done} из ${total}`))
  );
}

export function renderPacking(root) {
  const active = state.trips.filter(t => !t.done);
  const archived = state.trips.filter(t => t.done);

  fill(root,
    active.length
      ? h('div', { class: 'list' }, active.map(tripRow))
      : h('div', { class: 'empty' },
        h('div', { class: 'big' }, '🧳'),
        h('p', {}, 'Поездок пока нет. Чтобы собрать чемодан, нажмите «+» внизу справа.')),

    archived.length ? h('button', {
      class: 'btn block', style: { marginTop: '18px', textAlign: 'left' },
      onclick: () => { archiveOpen = !archiveOpen; emit(); }
    }, `${archiveOpen ? '▾' : '▸'} Архив поездок · ${archived.length}`) : null,

    archived.length && archiveOpen
      ? h('div', { class: 'list', style: { marginTop: '8px' } }, archived.map(tripRow))
      : null,

    h('button', { class: 'fab', onclick: newTrip }, '+')
  );
}
