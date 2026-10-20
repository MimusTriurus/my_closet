// Единое состояние приложения + персистентность в IndexedDB.
import { dbAll, dbPut, dbDel, uid } from './db.js';

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

// Служебная категория: сюда попадают вещи, добавленные пачкой, до разбора.
// Её нельзя удалить, подкатегорий у неё нет, но переименовать можно.
export const SORTING_ICON = '🗃';
export const sortingCat = () => state.cats.find(c => c.system === 'sorting') || null;

async function ensureSortingCat() {
  if (sortingCat()) return;
  const cat = {
    id: uid('c'), name: 'Сортировка', icon: SORTING_ICON,
    order: -1, custom: false, system: 'sorting', subs: []
  };
  state.cats.unshift(cat);
  await dbPut('cats', cat);
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

export async function loadAll() {
  const [items, outfits, collections, cats, calendar, trips] = await Promise.all(
    ['items', 'outfits', 'collections', 'cats', 'calendar', 'trips'].map(dbAll)
  );
  state.items = items.sort((a, b) => b.createdAt - a.createdAt);
  state.outfits = outfits.sort((a, b) => b.createdAt - a.createdAt);
  state.collections = collections;
  state.calendar = calendar;
  state.trips = trips.sort((a, b) => b.createdAt - a.createdAt);

  if (!cats.length) {
    state.cats = DEFAULT_CATS.map((c, i) => ({
      id: uid('c'), name: c.name, icon: c.icon, order: i, custom: false,
      subs: c.subs.map(s => ({ id: uid('s'), name: s }))
    }));
    await Promise.all(state.cats.map(c => dbPut('cats', c)));
  } else {
    state.cats = cats.sort((a, b) => a.order - b.order);
  }
  await ensureSortingCat();
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
    if (t.itemIds?.includes(id)) { t.itemIds = t.itemIds.filter(x => x !== id); await dbPut('trips', t); }
  }
  await dbDel('items', id);
  emit();
}
export const itemById = id => state.items.find(i => i.id === id);

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
  for (const t of state.trips) {
    if (t.outfitIds?.includes(id)) { t.outfitIds = t.outfitIds.filter(x => x !== id); await dbPut('trips', t); }
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
export const countInCat = id => state.items.filter(i => i.catId === id).length;

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
