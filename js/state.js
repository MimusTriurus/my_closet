// Единое состояние приложения + персистентность в IndexedDB.
import { dbAll, dbPut, dbDel, uid } from './db.js';
import { nItems } from './ui.js';

export const state = {
  items: [], outfits: [], collections: [], cats: [], calendar: [], trips: []
};

const listeners = new Set();
export const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };
export const emit = () => listeners.forEach(f => f());

export const DEFAULT_CATS = [
  { name: 'Верх', icon: '👕', subs: ['Футболки', 'Рубашки', 'Свитеры', 'Топы', 'Худи'] },
  { name: 'Низ', icon: '👖', subs: ['Джинсы', 'Брюки', 'Юбки', 'Шорты'] },
  { name: 'Платья', icon: '👗', subs: ['Повседневные', 'Вечерние', 'Комбинезоны'] },
  { name: 'Верхняя одежда', icon: '🧥', subs: ['Куртки', 'Пальто', 'Пиджаки', 'Жилеты'] },
  { name: 'Обувь', icon: '👟', subs: ['Кроссовки', 'Ботинки', 'Туфли', 'Сандалии'] },
  { name: 'Аксессуары', icon: '👜', subs: ['Сумки', 'Головные уборы', 'Ремни', 'Очки', 'Шарфы'] },
  { name: 'Украшения', icon: '💍', subs: ['Серьги', 'Цепочки', 'Браслеты', 'Кольца'] },
  { name: 'Спорт', icon: '🏃', subs: ['Верх', 'Низ', 'Обувь'] }
];

/**
 * Служебные категории. «Сортировка» — куда падает массовое добавление до разбора,
 * «На рассмотрении» — вещи, которые ещё не куплены. Обе нельзя удалить, можно
 * переименовать, подкатегорий у них нет, и в статистике гардероба они не считаются.
 */
export const SORTING_ICON = '🗃';
export const SYSTEM_CATS = [
  { system: 'sorting', name: 'Сортировка', icon: SORTING_ICON, order: -2 },
  { system: 'review', name: 'На рассмотрении', icon: '🔍', order: -1 }
];
export const sortingCat = () => state.cats.find(c => c.system === 'sorting') || null;
export const isSystemCat = id => !!catById(id)?.system;

async function ensureSystemCats() {
  for (const def of SYSTEM_CATS) {
    if (state.cats.some(c => c.system === def.system)) continue;
    const cat = { id: uid('c'), custom: false, subs: [], ...def };
    state.cats.unshift(cat);
    await dbPut('cats', cat);
  }
}

/** Сообщения, которые показываются сразу после загрузки: что приложение починило само. */
export const notices = [];

/**
 * Вещь без категории в гардеробе не видна — отдельного списка «без категории» нет
 * и не будет. Такие вещи приходят из старых резервных копий; отправляем их
 * в «Сортировку», где и лежит всё неразобранное.
 */
async function adoptOrphans() {
  const cat = sortingCat();
  if (!cat) return;
  const lost = state.items.filter(i => !catById(i.catId));
  for (const it of lost) {
    it.catId = cat.id;
    it.subId = null;
    await dbPut('items', it);
  }
  if (lost.length) notices.push(lost.length === 1
    ? `Вещь без категории перенесена в «${cat.name}»`
    : `${nItems(lost.length)} без категории перенесены в «${cat.name}»`);
}

/** Единая точка создания вещи — чтобы все новые поля появлялись в одном месте. */
export function createItem(patch = {}) {
  return {
    id: uid('it'),
    name: '',
    catId: null,
    subId: null,
    img: null,
    colors: [],
    bg: 'none',
    fav: false,
    source: 'photo',
    createdAt: Date.now(),
    ...patch
  };
}

/**
 * Поездки раньше хранили образы и даты. Образы разворачиваем в вещи,
 * даты убираем, добавляем признак «состоялась».
 */
async function migrateTrips() {
  for (const t of state.trips) {
    if (!('outfitIds' in t) && !('from' in t) && 'done' in t) continue;
    const fromOutfits = (t.outfitIds || [])
      .flatMap(id => (state.outfits.find(o => o.id === id)?.layers || []).map(l => l.itemId));
    t.itemIds = [...new Set([...(t.itemIds || []), ...fromOutfits])];
    t.done = t.done ?? false;
    delete t.outfitIds;
    delete t.from;
    delete t.to;
    await dbPut('trips', t);
  }
}

export async function loadAll() {
  const [items, outfits, collections, cats, calendar, trips] = await Promise.all(
    ['items', 'outfits', 'collections', 'cats', 'calendar', 'trips'].map(dbAll)
  );
  state.items = items.sort((a, b) => b.createdAt - a.createdAt);
  state.outfits = outfits.sort((a, b) => b.createdAt - a.createdAt);
  state.collections = collections;
  state.calendar = calendar;
  state.trips = trips.sort((a, b) => b.createdAt - a.createdAt);
  await migrateTrips();

  if (!cats.length) {
    state.cats = DEFAULT_CATS.map((c, i) => ({
      id: uid('c'), name: c.name, icon: c.icon, order: i, custom: false,
      subs: c.subs.map(s => ({ id: uid('s'), name: s }))
    }));
    await Promise.all(state.cats.map(c => dbPut('cats', c)));
  } else {
    state.cats = cats.sort((a, b) => a.order - b.order);
  }
  await ensureSystemCats();
  await adoptOrphans();
}

/* ---------- items ---------- */
export async function saveItem(item) {
  const idx = state.items.findIndex(i => i.id === item.id);
  if (idx >= 0) state.items[idx] = item; else state.items.unshift(item);
  await dbPut('items', item);
  emit();
  return item;
}
export async function deleteItem(id) {
  state.items = state.items.filter(i => i.id !== id);
  // подчищаем ссылки
  for (const o of state.outfits) {
    if (o.layers.some(l => l.itemId === id)) {
      o.layers = o.layers.filter(l => l.itemId !== id);
      await dbPut('outfits', o);
    }
  }
  for (const d of state.calendar) {
    if (d.itemIds?.includes(id)) { d.itemIds = d.itemIds.filter(x => x !== id); await dbPut('calendar', d); }
  }
  for (const t of state.trips) {
    if (t.itemIds?.includes(id)) {
      t.itemIds = t.itemIds.filter(x => x !== id);
      if (t.checked) delete t.checked[id];
      await dbPut('trips', t);
    }
  }
  await dbDel('items', id);
  emit();
}
export const itemById = id => state.items.find(i => i.id === id);

/**
 * Единственный источник списка вещей для всего приложения: сетки гардероба,
 * выбор вещей для образа и чемодана, палитра, счётчики. Архивные сюда не
 * попадают, поэтому пометку «в архиве» достаточно будет учесть здесь одной.
 */
export const visibleItems = () => state.items.filter(i => !i.archived);
export const archivedItems = () => state.items.filter(i => i.archived);

/** Сохранение пачкой: перерисовка одна на всю пачку, а не на каждую вещь. */
export async function saveItems(items) {
  for (const item of items) {
    const idx = state.items.findIndex(i => i.id === item.id);
    if (idx >= 0) state.items[idx] = item; else state.items.unshift(item);
    await dbPut('items', item);
  }
  emit();
}

/* ---------- outfits ---------- */
export async function saveOutfit(o) {
  const idx = state.outfits.findIndex(x => x.id === o.id);
  if (idx >= 0) state.outfits[idx] = o; else state.outfits.unshift(o);
  await dbPut('outfits', o);
  emit();
  return o;
}
export async function deleteOutfit(id) {
  state.outfits = state.outfits.filter(o => o.id !== id);
  for (const d of state.calendar) {
    if (d.outfitIds?.includes(id)) { d.outfitIds = d.outfitIds.filter(x => x !== id); await dbPut('calendar', d); }
  }
  await dbDel('outfits', id);
  emit();
}
export const outfitById = id => state.outfits.find(o => o.id === id);

/* ---------- collections (Style Book) ---------- */
export async function saveCollection(c) {
  const idx = state.collections.findIndex(x => x.id === c.id);
  if (idx >= 0) state.collections[idx] = c; else state.collections.push(c);
  await dbPut('collections', c);
  emit();
  return c;
}
export async function deleteCollection(id) {
  state.collections = state.collections.filter(c => c.id !== id);
  for (const o of state.outfits) {
    if (o.collectionId === id) { o.collectionId = null; await dbPut('outfits', o); }
  }
  await dbDel('collections', id);
  emit();
}

/* ---------- categories ---------- */
export async function saveCat(c) {
  const idx = state.cats.findIndex(x => x.id === c.id);
  if (idx >= 0) state.cats[idx] = c; else state.cats.push(c);
  await dbPut('cats', c);
  emit();
  return c;
}
export async function deleteCat(id) {
  if (catById(id)?.system) return false;      // служебную категорию удалять нельзя
  state.cats = state.cats.filter(c => c.id !== id);
  for (const it of state.items) {
    if (it.catId === id) { it.catId = null; it.subId = null; await dbPut('items', it); }
  }
  await dbDel('cats', id);
  emit();
}
export const catById = id => state.cats.find(c => c.id === id);
export function subById(catId, subId) {
  return catById(catId)?.subs.find(s => s.id === subId) || null;
}
export const countInCat = id => visibleItems().filter(i => i.catId === id).length;

/** Вещи, которые считаются гардеробом: без служебных категорий. */
export const closetCount = () => visibleItems().filter(i => !isSystemCat(i.catId)).length;
export const countInSystem = system =>
  countInCat(state.cats.find(c => c.system === system)?.id);

/* ---------- calendar ---------- */
export async function saveDay(day) {
  const idx = state.calendar.findIndex(d => d.id === day.id);
  if (idx >= 0) state.calendar[idx] = day; else state.calendar.push(day);
  await dbPut('calendar', day);
  emit();
  return day;
}
export const dayByDate = date => state.calendar.find(d => d.id === date);

/* ---------- trips ---------- */
export async function saveTrip(t) {
  const idx = state.trips.findIndex(x => x.id === t.id);
  if (idx >= 0) state.trips[idx] = t; else state.trips.unshift(t);
  await dbPut('trips', t);
  emit();
  return t;
}
export async function deleteTrip(id) {
  state.trips = state.trips.filter(t => t.id !== id);
  await dbDel('trips', id);
  emit();
}
export const tripById = id => state.trips.find(t => t.id === id);
