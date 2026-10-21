// Вкладка «Чемодан»: список вещей на поездку с отметками «уложено».
// Поездка хранит только идентификаторы вещей — образы здесь не живут,
// кнопка «из Образа» просто разворачивает образ в его вещи.
import { fill, h, urlFor, openModal, toast, confirmDialog, promptDialog, actionSheet } from './ui.js';
import { state, saveTrip, deleteTrip, itemById, outfitById, emit } from './state.js';
import { uid } from './db.js';
import { pickItems, pickOutfits } from './picker.js';
import { itemLabel } from './closet.js';
import { bgCss } from './bgs.js';

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
        }, `${t.done ? '📦 ' : ''}${t.name} · ${t.itemIds?.length || 0} вещей`)))
        : h('div', { class: 'empty' }, 'Других поездок пока нет'),
      onClose: () => { if (!done) res(null); }
    });
  });
}

function openTrip(trip) {
  const body = h('div', {});
  const modal = openModal({
    title: trip.name, body, full: true, onClose: emit,
    // действия над поездкой живут в шапке — иначе до них пришлось бы
    // прокручивать весь список вещей
    headAction: h('button', {
      class: 'icon-btn', title: 'Действия с поездкой',
      onclick: async () => {
        const act = await actionSheet(trip.name, [
          { id: 'arch', icon: trip.done ? '↩' : '📦', label: trip.done ? 'Вернуть из архива' : 'Переместить в архив' },
          { id: 'ren', icon: '✎', label: 'Переименовать' },
          { id: 'del', icon: '🗑', label: 'Удалить поездку', danger: true }
        ]);
        if (act === 'arch') {
          trip.done = !trip.done;
          await saveTrip(trip);
          toast(trip.done ? 'Перемещена в архив' : 'Возвращена в активные');
          render();
        } else if (act === 'ren') {
          const n = await promptDialog('Переименовать поездку', trip.name, 'Название');
          if (!n) return;
          trip.name = n;
          await saveTrip(trip);
          modal.root.querySelector('.modal-head h2').textContent = n;
        } else if (act === 'del') {
          if (await confirmDialog(`Удалить поездку «${trip.name}»? Вещи останутся в гардеробе.`)) {
            await deleteTrip(trip.id);
            modal.close();
          }
        }
      }
    }, '⋯')
  });

  function render() {
    const items = (trip.itemIds || []).map(itemById).filter(Boolean);
    const { total, done } = progress(trip);

    fill(body,
      // закреплено под шапкой: добавление доступно на любой длине списка
      h('div', { class: 'sticky-add' },
        h('div', { class: 'meta' },
          h('span', { class: 'section-title' }, 'Добавить вещи'),
          h('span', { class: 'trip-progress' },
            total ? `Уложено ${done} из ${total}` : 'Список пуст',
            trip.done ? ' · в архиве' : '')
        ),
        h('div', { class: 'row', style: { gap: '8px' } },
          h('button', {
            class: 'btn btn-sm btn-add', style: { flex: '1' }, onclick: async () => {
              const ids = await pickItems({ title: 'Вещи в поездку', selected: trip.itemIds || [] });
              if (!ids) return;
              trip.itemIds = ids.filter(id => itemById(id));
              await saveTrip(trip);
              render();
            }
          }, '🧺 Гардероб'),
          h('button', {
            class: 'btn btn-sm btn-add', style: { flex: '1' }, onclick: async () => {
              const ids = await pickOutfits({ title: 'Развернуть образ в вещи' });
              if (!ids || !ids.length) return;
              const fromOutfits = ids.flatMap(id => (outfitById(id)?.layers || []).map(l => l.itemId));
              await addItems(trip, [...new Set(fromOutfits)]);
              render();
            }
          }, '👗 Образ'),
          h('button', {
            class: 'btn btn-sm btn-add', style: { flex: '1' }, onclick: async () => {
              const src = await pickTrip(trip.id);
              if (!src) return;
              await addItems(trip, src.itemIds || []);
              render();
            }
          }, '🧳 Поездка')
        )
      ),

      h('div', { class: 'list' }, items.map(row)),
      items.length ? null : h('div', { class: 'empty' }, 'Добавьте вещи кнопками выше')
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
        h('b', { style: { textDecoration: checked ? 'line-through' : '' } }, itemLabel(it))),
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
      h('span', {}, t.done ? `в архиве · ${total} вещей` : `уложено ${done} из ${total}`))
  );
}

function openArchive() {
  const body = h('div', {});
  const modal = openModal({ title: 'Архив поездок', body, full: true, onClose: emit });
  const render = () => {
    const archived = state.trips.filter(t => t.done);
    fill(body, archived.length
      ? h('div', { class: 'list' }, archived.map(tripRow))
      : h('div', { class: 'empty' }, 'Архив пуст'));
  };
  render();
}

export function renderPacking(root) {
  const active = state.trips.filter(t => !t.done);
  const archived = state.trips.filter(t => t.done);

  fill(root,
    active.length
      ? h('div', { class: 'list' }, active.map(tripRow))
      : h('div', { class: 'empty' },
        h('div', { class: 'big' }, '🧳'),
        h('p', {}, archived.length
          ? 'Активных поездок нет — все лежат в архиве.'
          : 'Поездок пока нет. Чтобы собрать чемодан, нажмите «+» внизу справа.')),

    // архив всегда на одном месте — закреплён над панелью вкладок
    archived.length ? h('div', { class: 'archive-bar', onclick: openArchive },
      h('span', {}, '📦'),
      h('b', { class: 'spacer' }, 'Архив поездок'),
      h('span', { class: 'muted' }, archived.length),
      h('span', { class: 'muted' }, '›')
    ) : null,

    h('button', { class: 'fab' + (archived.length ? ' raised' : ''), onclick: newTrip }, '+')
  );

  root.style.paddingBottom = archived.length ? '140px' : '';
}
