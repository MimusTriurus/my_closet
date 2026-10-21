// Единое состояние приложения + персистентность в IndexedDB.
import { dbAll, dbGet, dbPut, dbDel, uid } from './db.js';
import { nItems } from './ui.js';

export const state = {
  items: [], outfits: [], collections: [], cats: [], calendar: [], trips: [],
  lists: { brands: [], materials: [], colors: [] }
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
  // архивные не трогаем: их гардеробная категория нужна только при возврате,
  // и разбирается этот случай там же
  const lost = state.items.filter(i => !i.archived && !catById(i.catId));
  for (const it of lost) {
    it.catId = cat.id;
    it.subId = null;
    await dbPut('items', it);
  }
  if (lost.length) notices.push(lost.length === 1
    ? `Вещь без категории перенесена в «${cat.name}»`
    : `${nItems(lost.length)} без категории перенесены в «${cat.name}»`);
}


/* ---------- списочные поля ---------- */
/**
 * Поле, по которому ищут, — всегда выбор из общего списка; поле, которое
 * только читают, — свободный ввод. Иначе один и тот же шартрез в разных
 * карточках напишется тремя способами, и фильтр покажет три значения.
 *
 * Списки лежат в meta одной записью на список — отдельное хранилище ради
 * десятка строк заводить незачем.
 */
const DEFAULT_MATERIALS = [
  'Хлопок', 'Лён', 'Вискоза', 'Шерсть', 'Кашемир', 'Шёлк',
  'Полиэстер', 'Полиамид', 'Эластан', 'Акрил', 'Кожа', 'Замша'
];

/**
 * Палитра, с которой начинает гардероб: дальше её переименовывают, удаляют
 * и дополняют. Пустой список означал бы, что первая же вещь требует завести
 * цвет с нуля.
 */
const DEFAULT_COLORS = [
  { name: 'Чёрный', hex: '#1a1a1a' }, { name: 'Белый', hex: '#f5f3ef' },
  { name: 'Серый', hex: '#808080' }, { name: 'Бежевый', hex: '#e0cfb4' },
  { name: 'Коричневый', hex: '#8b5e3c' }, { name: 'Красный', hex: '#c8443c' },
  { name: 'Оранжевый', hex: '#e08a3c' }, { name: 'Жёлтый', hex: '#e3c34a' },
  { name: 'Зелёный', hex: '#6f9a5c' }, { name: 'Голубой', hex: '#6ba3cc' },
  { name: 'Синий', hex: '#2b4472' }, { name: 'Фиолетовый', hex: '#7b5ea7' },
  { name: 'Розовый', hex: '#d98fb0' }
];

export const LIST_DEFS = {
  brands: { title: 'Производитель', add: 'Добавить производителя', one: 'производителя', seed: [] },
  materials: { title: 'Материал', add: 'Добавить материал', one: 'материал', seed: DEFAULT_MATERIALS },
  colors: { title: 'Цвет', add: 'Добавить цвет', one: 'цвет', seed: DEFAULT_COLORS }
};

const listKey = key => 'list:' + key;

async function loadLists() {
  for (const key of Object.keys(LIST_DEFS)) {
    const rec = await dbGet('meta', listKey(key));
    // засеваем один раз и помним об этом: иначе удалённые значения
    // возвращались бы при каждой загрузке
    if (rec && (rec.seeded || rec.items?.length)) { state.lists[key] = rec.items || []; continue; }
    state.lists[key] = (LIST_DEFS[key].seed || [])
      .map(x => ({ id: uid('l'), ...(typeof x === 'string' ? { name: x } : x) }));
    await dbPut('meta', { id: listKey(key), items: state.lists[key], seeded: true });
  }
}

/**
 * Списки всегда отдаются по алфавиту — и в фильтрах, и в карточке. Порядок
 * добавления ничего не говорит тому, кто ищет в списке глазами.
 * Сравнение в русской локали: кириллица идёт перед латиницей, как и везде
 * в телефоне с русским языком.
 */
export const listItems = key =>
  [...(state.lists[key] || [])].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
export const listEntry = (key, id) => listItems(key).find(e => e.id === id) || null;
export const listName = (key, id) => listEntry(key, id)?.name || '';

async function saveList(key) {
  await dbPut('meta', { id: listKey(key), items: state.lists[key], seeded: true });
  emit();
}

export async function addListEntry(key, patch) {
  const entry = { id: uid('l'), ...patch };
  state.lists[key] = [...listItems(key), entry];
  await saveList(key);
  return entry;
}
export async function updateListEntry(key, id, patch) {
  const entry = listEntry(key, id);
  if (!entry) return null;
  Object.assign(entry, patch);
  await saveList(key);
  return entry;
}

/** Сколько вещей ссылается на значение списка — чтобы правка не была вслепую. */
export function listUsage(key, id) {
  return state.items.filter(it => {
    if (key === 'brands') return it.brandId === id;
    if (key === 'colors') return (it.colorIds || []).includes(id);
    const m = it.material || {};
    return ['main', 'lining'].some(g => (m[g] || []).some(c => c.id === id));
  }).length;
}

/**
 * Перевод вещей с одного значения списка на другое; newId === null — просто
 * снять отметку. Нужен при удалении: вещь, потерявшая один цвет из трёх,
 * нигде не всплывает, поэтому удаление предлагает перенос, а не спрашивает
 * «точно?».
 */
export async function replaceListRef(key, id, newId = null) {
  const touched = [];
  for (const it of state.items) {
    let changed = false;
    if (key === 'brands') {
      if (it.brandId === id) { it.brandId = newId; changed = true; }
    } else if (key === 'colors') {
      const list = it.colorIds || [];
      if (list.includes(id)) {
        const next = list.filter(x => x !== id);
        if (newId && !next.includes(newId)) next.push(newId);
        it.colorIds = next;
        changed = true;
      }
    } else {
      const m = it.material || {};
      for (const grp of ['main', 'lining']) {
        const list = m[grp] || [];
        if (!list.some(c => c.id === id)) continue;
        // если новое значение в составе уже есть, строка не задваивается
        m[grp] = !newId || list.some(c => c.id === newId)
          ? list.filter(c => c.id !== id)
          : list.map(c => c.id === id ? { ...c, id: newId } : c);
        changed = true;
      }
      if (changed) it.material = m;
    }
    if (changed) touched.push(it);
  }
  if (touched.length) await saveItems(touched);
}

export async function deleteListEntry(key, id, newId = null) {
  await replaceListRef(key, id, newId);
  state.lists[key] = listItems(key).filter(e => e.id !== id);
  await saveList(key);
}

/** Единая точка создания вещи — чтобы все новые поля появлялись в одном месте. */
export function createItem(patch = {}) {
  return {
    id: uid('it'),
    catId: null,
    subId: null,
    img: null,
    colors: [],
    colorIds: [],
    bg: 'none',

    brandId: null,
    material: { main: [], lining: [] },   // [{ id, pct }] — проценты необязательны
    price: null,                          // { value, cur }
    note: '',
    fav: false,
    archived: false,
    arcCatId: null,     // место в архиве — своё, гардеробное при этом сохраняется,
    arcSubId: null,     // чтобы возврат вёл вещь ровно туда, откуда она ушла

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

/**
 * Коллекции образов были плоским списком-чипами — тем же, от чего отказался
 * гардероб. Превращаем их в категории образов: у образов теперь папки, как
 * у вещей, с подкатегориями и полным набором действий.
 */
async function migrateCollections() {
  if (!state.collections.length) return;
  for (const col of state.collections) {
    const cat = {
      id: col.id, name: col.name, order: state.cats.length,
      custom: true, scope: SCOPE_OUTFIT, subs: []
    };
    state.cats.push(cat);
    await dbPut('cats', cat);
    await dbDel('collections', col.id);
  }
  // номер категории совпадает с номером коллекции, поэтому образы
  // переставлять не нужно — достаточно переименовать поле
  for (const o of state.outfits) {
    if (!('collectionId' in o)) continue;
    o.catId = o.collectionId || null;
    o.subId = null;
    delete o.collectionId;
    await dbPut('outfits', o);
  }
  state.collections = [];
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
  await loadLists();
  await ensureSystemCats();
  await migrateCollections();
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

/**
 * У архива свои категории, отдельные от гардеробных: раскладывать проданное
 * можно грубее или, наоборот, подробнее, чем то, что носится. Принадлежность
 * хранится в scope, и списки категорий всегда берутся через эти две функции —
 * иначе архивные категории рано или поздно просочатся в гардероб.
 */
export const SCOPE_CLOSET = 'closet';
export const SCOPE_ARCHIVE = 'archive';
export const SCOPE_OUTFIT = 'outfit';
export const catsIn = scope => state.cats.filter(c => (c.scope || SCOPE_CLOSET) === scope);
export const closetCats = () => catsIn(SCOPE_CLOSET);
export const archiveCats = () => catsIn(SCOPE_ARCHIVE);
export const outfitCats = () => catsIn(SCOPE_OUTFIT);

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

/**
 * Вещи образа. Вещь, ушедшая в архив, из образа не исчезает — иначе
 * календарь перестал бы соответствовать тому, что было надето. Но знать
 * о ней нужно: именно она портит счётчик носок при записи «на сегодня».
 */
export const outfitItems = o => (o.layers || []).map(l => itemById(l.itemId)).filter(Boolean);
export const archivedInOutfit = o => outfitItems(o).filter(i => i.archived);

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
  // номер категории уникален, поэтому чистим обе ссылки разом — гардеробную
  // и архивную: какая из них была, та и обнулится
  for (const it of state.items) {
    if (it.catId === id) { it.catId = null; it.subId = null; await dbPut('items', it); }
    else if (it.arcCatId === id) { it.arcCatId = null; it.arcSubId = null; await dbPut('items', it); }
  }
  for (const o of state.outfits) {
    if (o.catId === id) { o.catId = null; o.subId = null; await dbPut('outfits', o); }
  }
  await dbDel('cats', id);
  emit();
}
export const catById = id => state.cats.find(c => c.id === id);
export function subById(catId, subId) {
  return catById(catId)?.subs.find(s => s.id === subId) || null;
}
export const countInCat = id => visibleItems().filter(i => i.catId === id).length;
export const countInArcCat = id => archivedItems().filter(i => i.arcCatId === id).length;
export const outfitsIn = catId => state.outfits.filter(o => (o.catId || null) === catId);
export const countInOutfitCat = id => outfitsIn(id).length;

/** Сколько вещей в категории — с учётом того, гардеробная она или архивная. */
export const countIn = cat => cat.scope === SCOPE_ARCHIVE ? countInArcCat(cat.id)
  : cat.scope === SCOPE_OUTFIT ? countInOutfitCat(cat.id)
    : countInCat(cat.id);

/**
 * Гардероб как таковой: без архива и без рабочих полок. «Сортировка» ещё не
 * разобрана, «На рассмотрении» ещё не куплено — ни то, ни другое гардеробом
 * пока не является, поэтому «Все вещи», счётчики и фильтры берут этот список.
 */
export const closetItems = () => visibleItems().filter(i => !isSystemCat(i.catId));
export const closetCount = () => closetItems().length;
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

/**
 * Счётчик носок не хранится числом, а считается по календарю: день, в котором
 * вещь встретилась, даёт +1, сколько бы образов на нём ни стояло. Разойтись
 * с реальностью он не может и чинить его не нужно.
 */
export const wearCount = itemId => state.calendar.filter(d =>
  (d.itemIds || []).includes(itemId) ||
  (d.outfitIds || []).some(oid => outfitById(oid)?.layers?.some(l => l.itemId === itemId))
).length;

/** Валюта последней заполненной цены — разумное умолчание для следующей вещи. */
export const lastCurrency = () =>
  state.items.find(i => i.price?.cur)?.price.cur || '₽';

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
