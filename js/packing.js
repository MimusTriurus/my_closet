// Вкладка «Чемодан»: список вещей на поездку с отметками «уложено».
// Поездка хранит только идентификаторы вещей — образы здесь не живут,
// кнопка «из Образа» просто разворачивает образ в его вещи.
//
// Вкладка ходит по уровням, как «Гардероб»: список поездок → архив или
// поездка. Раньше и архив, и поездка открывались модальными окнами, и
// закрывались «✕» — знаком отмены, хотя отменять нечего: всё здесь
// сохраняется сразу. «✕» оставлен тому, где есть что отменять.
import { fill, h, urlFor, openModal, toast, confirmDialog, promptDialog, actionSheet } from './ui.js';
import { state, saveTrip, deleteTrip, itemById, outfitById, tripById, emit } from './state.js';
import { uid } from './db.js';
import { pickItems, pickOutfits } from './picker.js';
import { itemLabel } from './closet.js';
import { bgCss } from './bgs.js';

// где мы внутри вкладки. Поездка открывается и из списка, и из архива —
// `archive` помнит, откуда пришли, и туда же возвращает «‹»
const pnav = { archive: false, tripId: null };

export const goPackingRoot = () => { pnav.archive = false; pnav.tripId = null; emit(); };
const openTrip = t => { pnav.tripId = t.id; emit(); };
const closeTrip = () => { pnav.tripId = null; emit(); };

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

/**
 * Выбор поездки, из которой копируются вещи (галочки не переносим).
 * Это по-прежнему окно: выбор — короткий разговор, а не место.
 */
function pickTrip(exceptId) {
  return new Promise(res => {
    const list = byNewest(state.trips.filter(t => t.id !== exceptId));
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

/** Действия над поездкой. Живут в шапке вкладки — иначе до них пришлось
 *  бы прокручивать весь список вещей. */
async function tripActions(trip) {
  const act = await actionSheet(trip.name, [
    { id: 'arch', icon: trip.done ? '↩' : '📦', label: trip.done ? 'Вернуть из архива' : 'Переместить в архив' },
    { id: 'ren', icon: '✎', label: 'Переименовать' },
    { id: 'del', icon: '🗑', label: 'Удалить поездку', danger: true }
  ]);
  if (act === 'arch') {
    trip.done = !trip.done;
    await saveTrip(trip);
    toast(trip.done ? 'Перемещена в архив' : 'Возвращена в активные');
  } else if (act === 'ren') {
    const n = await promptDialog('Переименовать поездку', trip.name, 'Название');
    if (!n) return;
    trip.name = n;
    await saveTrip(trip);          // saveTrip перерисует и шапку: заголовок её
  } else if (act === 'del') {
    if (await confirmDialog(`Удалить поездку «${trip.name}»? Вещи останутся в гардеробе.`)) {
      await deleteTrip(trip.id);
      closeTrip();
    }
  }
}

/** Что показать в верхней панели: заголовок уровня и кнопку «назад». */
export function packingNav() {
  const trip = pnav.tripId ? tripById(pnav.tripId) : null;
  if (trip) {
    return {
      title: trip.name, back: closeTrip,
      action: { icon: '⋯', title: 'Действия с поездкой', onclick: () => tripActions(trip) }
    };
  }
  if (pnav.archive) return { title: 'Архив поездок', back: goPackingRoot };
  return null;
}

/**
 * Поездки — сверху новые. Дат у поездки нет, поэтому «новая» означает
 * «заведена позже». Сортируем при показе, а не полагаемся на то, в каком
 * порядке они оказались в памяти.
 */
const byNewest = list => [...list].sort((a, b) => b.createdAt - a.createdAt);

async function newTrip() {
  const name = await promptDialog('Новая поездка', '', 'Название, например «Лиссабон, май»');
  if (!name) return;
  const trip = { id: uid('tr'), name, itemIds: [], checked: {}, done: false, createdAt: Date.now() };
  await saveTrip(trip);
  openTrip(trip);
}

function tripRow(t) {
  const { total, done } = progress(t);
  return h('div', { class: 'lrow nav', onclick: () => openTrip(t) },
    h('div', { style: { fontSize: '26px', opacity: t.done ? .5 : 1 } }, '🧳'),
    h('div', { class: 't' },
      h('b', {}, t.name),
      h('span', {}, t.done ? `в архиве · ${total} вещей` : `уложено ${done} из ${total}`)),
    h('span', { class: 'chev' }, '›')
  );
}

function renderTrip(root, trip) {
  const items = (trip.itemIds || []).map(itemById).filter(Boolean);
  const { total, done } = progress(trip);
  const gone = items.filter(i => i.archived).length;

  const row = it => {
    const checked = !!trip.checked?.[it.id];
    // архивная вещь в списке — не ошибка, а подсказка: такую вещь надо
    // либо заменить, либо вычеркнуть. Поэтому помечаем, а не прячем
    return h('div', { class: 'lrow' + (it.archived ? ' gone' : ''), style: { opacity: checked ? .55 : 1 } },
      h('input', {
        type: 'checkbox', checked,
        style: { width: '22px', height: '22px', accentColor: 'var(--accent)', flex: '0 0 auto' },
        onchange: async e => {
          trip.checked = trip.checked || {};
          trip.checked[it.id] = e.target.checked;
          await saveTrip(trip);
        }
      }),
      h('img', { class: 'thumb', src: urlFor(it.img), style: { background: bgCss(it.bg) } }),
      h('div', { class: 't' },
        h('b', { style: { textDecoration: checked ? 'line-through' : '' } }, itemLabel(it)),
        it.archived ? h('span', {}, '◷ в архиве') : null),
      h('button', {
        class: 'btn btn-sm', title: 'Убрать из поездки',
        onclick: async () => {
          trip.itemIds = trip.itemIds.filter(x => x !== it.id);
          if (trip.checked) delete trip.checked[it.id];
          await saveTrip(trip);
        }
      }, '✕')
    );
  };

  fill(root,
    // закреплено под шапкой: добавление доступно на любой длине списка
    h('div', { class: 'sticky-add' },
      h('div', { class: 'meta' },
        h('span', { class: 'section-title' }, 'Добавить вещи'),
        h('span', { class: 'trip-progress' },
          total ? `Уложено ${done} из ${total}` : 'Список пуст',
          gone ? ` · ${gone} из архива` : '',
          trip.done ? ' · в архиве' : '')
      ),
      h('div', { class: 'row', style: { gap: '8px' } },
        h('button', {
          class: 'btn btn-sm btn-add', style: { flex: '1' }, onclick: async () => {
            const ids = await pickItems({ title: 'Вещи в поездку', selected: trip.itemIds || [] });
            if (!ids) return;
            trip.itemIds = ids.filter(id => itemById(id));
            await saveTrip(trip);
          }
        }, '🧺 Гардероб'),
        h('button', {
          class: 'btn btn-sm btn-add', style: { flex: '1' }, onclick: async () => {
            const ids = await pickOutfits({ title: 'Развернуть образ в вещи' });
            if (!ids || !ids.length) return;
            // архивное берём: список для сборов — напоминание, а не опись
            // гардероба. Лишнее пользователь уберёт сам, а вот про шарф,
            // которого уже нет, лучше вспомнить до отъезда
            const fromOutfits = ids
              .flatMap(id => (outfitById(id)?.layers || []).map(l => l.itemId))
              .filter(id => itemById(id));
            await addItems(trip, [...new Set(fromOutfits)]);
          }
        }, '👗 Образ'),
        h('button', {
          class: 'btn btn-sm btn-add', style: { flex: '1' }, onclick: async () => {
            const src = await pickTrip(trip.id);
            if (!src) return;
            await addItems(trip, src.itemIds || []);
          }
        }, '🧳 Поездка')
      )
    ),

    h('div', { class: 'list' }, items.map(row)),
    items.length ? null : h('div', { class: 'empty' }, 'Добавьте вещи кнопками выше')
  );
  root.style.paddingBottom = '';
}

function renderArchive(root) {
  const archived = byNewest(state.trips.filter(t => t.done));
  fill(root, archived.length
    ? h('div', { class: 'list' }, archived.map(tripRow))
    : h('div', { class: 'empty' }, 'Архив пуст'));
  root.style.paddingBottom = '';
}

function renderTripList(root) {
  const active = byNewest(state.trips.filter(t => !t.done));
  const archived = byNewest(state.trips.filter(t => t.done));

  fill(root,
    active.length
      ? h('div', { class: 'list' }, active.map(tripRow))
      : h('div', { class: 'empty' },
        h('div', { class: 'big' }, '🧳'),
        h('p', {}, archived.length
          ? 'Активных поездок нет — все лежат в архиве.'
          : 'Поездок пока нет. Чтобы собрать чемодан, нажмите «+» внизу справа.')),

    // архив всегда на одном месте — закреплён над панелью вкладок, и виден
    // даже пустым: это постоянная полка, а не след от первой архивации.
    // Полка, появляющаяся задним числом, читается как пропажа, и о самой
    // возможности убрать поездку, не удаляя её, узнать было бы неоткуда.
    // То же правило, что у архива вещей в «Гардеробе»
    h('div', { class: 'archive-bar', onclick: () => { pnav.archive = true; emit(); } },
      h('span', {}, '📦'),
      h('b', { class: 'spacer' }, 'Архив поездок'),
      archived.length ? h('span', { class: 'muted' }, archived.length) : null,
      h('span', { class: 'muted' }, '›')
    ),

    h('button', { class: 'fab raised', onclick: newTrip }, '+')
  );

  root.style.paddingBottom = '140px';
}

export function renderPacking(root) {
  // поездку могли удалить — тогда уровень исчезает вместе с ней
  const trip = pnav.tripId ? tripById(pnav.tripId) : null;
  if (pnav.tripId && !trip) pnav.tripId = null;
  if (trip) return renderTrip(root, trip);
  if (pnav.archive) return renderArchive(root);
  renderTripList(root);
}
