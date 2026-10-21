// Вкладка «Гардероб»: категории, подкатегории, фильтр по цвету, сортировка, карточка вещи.
import {
  fill, h, qs, urlFor, toast, openModal, confirmDialog, promptDialog, actionSheet,
  alertDialog, busy, plural, nItems
} from './ui.js';
import {
  state, saveItem, saveItems, deleteItem, saveCat, deleteCat, catById, subById, countInCat,
  visibleItems, archivedItems, itemById, closetCats, archiveCats, countInArcCat, countIn, SCOPE_ARCHIVE,
  createItem, sortingCat, emit
} from './state.js';
import { uid } from './db.js';
import { BASE_COLORS, colorName, itemMatchesColor, extractPalette, oklab } from './color.js';
import { BGS, bgCss } from './bgs.js';
import { openImageEditor, imageFromBlob, downscaleBlob } from './editor.js';
import { pickImageFile, pickImageFiles, captureFromCamera, scanColorFromCamera } from './capture.js';

// фильтры живут только в разделе «Все вещи» — по категориям ходит nav
export const filters = { color: null, sort: 'new', favOnly: false };

/* ---------- добавление вещи ---------- */
export async function addItemFlow(sourceBlob, preset = {}) {
  const blob = await openImageEditor(sourceBlob, { autoAI: preset.autoAI !== false });
  if (!blob) return null;
  busy(true, 'Анализирую цвета…');
  let colors = [];
  try {
    const img = await imageFromBlob(blob);
    colors = extractPalette(img, 5);
  } catch (e) { console.warn(e); }
  busy(false);

  const item = createItem({
    name: preset.name || '',
    catId: preset.catId ?? nav.catId ?? state.cats.find(c => !c.system)?.id ?? null,
    subId: preset.subId ?? (nav.subId && nav.subId !== OTHER ? nav.subId : null),
    img: blob,
    colors,
    source: preset.source || 'photo'
  });
  const saved = await openItemForm(item, true);
  return saved;
}

/**
 * Массовое добавление: изображения сохраняются как есть, без обработки,
 * в служебную категорию «Сортировка» — разбирать их пользователь будет потом.
 */
export async function startBulkAdd(max = 10) {
  const files = await pickImageFiles(max);
  if (!files || !files.length) return;
  return importFiles(files);
}

export async function importFiles(files) {
  const cat = sortingCat();

  let added = 0;
  for (const file of files) {
    busy(true, `Добавляю ${added + 1} из ${files.length}…`);
    try {
      const img = await downscaleBlob(file, 1600);
      await saveItem(createItem({ img, catId: cat?.id ?? null, source: 'bulk' }));
      added++;
    } catch (e) {
      console.warn('не удалось добавить', file.name, e);
    }
  }
  busy(false);

  if (!added) { toast('Не удалось прочитать изображения', 3200); return; }
  nav.all = false;
  nav.catId = cat?.id ?? null;
  nav.subId = null;
  emit();
  const skipped = files.length - added;
  toast(`Добавлено ${added} в «${cat?.name || 'гардероб'}»` + (skipped ? ` · пропущено ${skipped}` : ''), 3000);
}

export async function startAddItem() {
  const src = await actionSheet('Добавить вещь', [
    { id: 'cam', icon: '📸', label: 'Сделать фото' },
    { id: 'file', icon: '🖼', label: 'Выбрать из галереи' },
    { id: 'bulk', icon: '🗃', label: 'Добавить несколько' }
  ]);
  if (!src) return;
  if (src === 'bulk') return startBulkAdd();
  const blob = src === 'cam' ? await captureFromCamera() : await pickImageFile();
  if (!blob) return;
  await addItemFlow(blob);
}

/* ---------- форма вещи ---------- */
export function openItemForm(item, isNew = false) {
  return new Promise(res => {
    let resolved = false;
    const nameInput = h('input', { type: 'text', value: item.name, placeholder: 'Например, белая рубашка' });

    const subSel = h('select', {});
    const catSel = h('select', {
      onchange: () => { item.catId = catSel.value; fillSubs(); }
    }, closetCats().map(c => h('option', { value: c.id, selected: c.id === item.catId }, c.name)));

    function fillSubs() {
      const cat = catById(catSel.value);
      fill(subSel, 
        h('option', { value: '' }, '— без подкатегории —'),
        ...(cat?.subs || []).map(s => h('option', { value: s.id, selected: s.id === item.subId }, s.name))
      );
    }
    fillSubs();

    const preview = h('div', {
      class: 'tile', style: { aspectRatio: '1', maxWidth: '190px', margin: '0 auto 12px', background: bgCss(item.bg) }
    }, h('img', { src: urlFor(item.img) }));

    const bgRow = h('div', { class: 'palette-row' }, BGS.map(b =>
      h('button', {
        class: 'swatch' + (item.bg === b.id ? ' sel' : ''),
        style: { background: b.css, border: b.id === 'none' ? '1px dashed #bbb' : '' },
        title: b.name,
        onclick: e => {
          item.bg = b.id;
          preview.style.background = b.css;
          [...bgRow.children].forEach(x => x.classList.remove('sel'));
          e.currentTarget.classList.add('sel');
        }
      })
    ));

    const colorsRow = h('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } },
      (item.colors || []).map(c => h('div', { class: 'row', style: { gap: '4px' } },
        h('span', { class: 'dot', style: { background: c.hex, width: '18px', height: '18px' } }),
        h('span', { class: 'small muted' }, `${colorName(c.hex)} ${Math.round(c.ratio * 100)}%`)))
    );

    const modal = openModal({
      title: isNew ? 'Новая вещь' : 'Редактировать',
      body: h('div', {},
        preview,
        h('div', { class: 'section-title' }, 'Фон карточки'), bgRow,
        h('label', { class: 'field' }, h('span', {}, 'Название'), nameInput),
        h('label', { class: 'field' }, h('span', {}, 'Категория'), catSel),
        h('label', { class: 'field' }, h('span', {}, 'Подкатегория'), subSel),
        h('div', { class: 'section-title' }, 'Цвета вещи'), colorsRow,
        h('button', {
          class: 'btn block', style: { marginTop: '14px' }, onclick: async () => {
            const blob = await openImageEditor(item.img, { autoAI: false });
            if (!blob) return;
            item.img = blob;
            preview.querySelector('img').src = urlFor(blob);
            try { item.colors = extractPalette(await imageFromBlob(blob), 5); } catch (e) { }
          }
        }, '✂️ Переобработать фото')
      ),
      foot: [
        h('button', { class: 'btn', onclick: () => modal.close() }, 'Отмена'),
        h('button', {
          class: 'btn primary', onclick: async () => {
            item.name = nameInput.value.trim() || (item.colors?.[0] ? colorName(item.colors[0].hex) + ' вещь' : 'Без названия');
            item.catId = catSel.value || null;
            item.subId = subSel.value || null;
            await saveItem(item);
            resolved = true;
            modal.close();
            toast(isNew ? 'Вещь добавлена' : 'Сохранено');
            res(item);
          }
        }, 'Сохранить')
      ],
      onClose: () => { if (!resolved) res(null); }
    });
  });
}

/* ---------- карточка вещи ---------- */
/* ---------- карточка вещи ---------- */
/**
 * Карточка — отдельный экран, а не окно: фотография и есть то, ради чего её
 * открывают, а в модальном окне она ужата полями. Возврат — тем же «‹»
 * в верхней панели, что и во всём гардеробе.
 */
export function openItemCard(item) {
  nav.itemId = item.id;
  emit();
}

const closeCard = () => { nav.itemId = null; emit(); };

function renderItemCard(root, item) {
  const place = [catById(item.catId)?.name, subById(item.catId, item.subId)?.name]
    .filter(Boolean).join(' › ') || 'Без категории';

  fill(root,
    h('div', { class: 'card-photo', style: { background: bgCss(item.bg) } },
      h('img', { src: urlFor(item.img), alt: item.name || '' })),

    h('div', { class: 'lrow' },
      h('div', { class: 't' },
        h('b', {}, item.name || '—'),
        h('span', {}, place))),

    (item.colors || []).length ? h('div', { class: 'section-title' }, 'Цвета') : null,
    h('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } },
      (item.colors || []).map(c => h('div', {
        class: 'chip',
        onclick: () => {
          filters.color = c.hex;
          nav.itemId = null; nav.archive = false; nav.catId = null; nav.subId = null; nav.all = true;
          emit();
        }
      }, h('span', { class: 'dot', style: { background: c.hex } }), colorName(c.hex)))),

    h('div', { class: 'card-actions' },
      h('button', {
        class: 'btn', title: 'В избранное',
        onclick: async () => {
          item.fav = !item.fav;
          await saveItem(item);
          toast(item.fav ? 'В избранном' : 'Убрано');
        }
      }, item.fav ? '★' : '☆'),
      item.archived
        ? h('button', {
          class: 'btn', onclick: async () => { closeCard(); await unarchiveItem(item); }
        }, '↩ Из архива')
        : h('button', {
          class: 'btn', onclick: async () => { if (await archiveItem(item)) closeCard(); }
        }, '📦 В архив'),
      h('button', { class: 'btn', onclick: () => openItemForm(item) }, '✎ Изменить'),
      h('button', {
        class: 'btn danger', onclick: async () => {
          if (await confirmDialog('Удалить вещь из гардероба?')) {
            closeCard();
            await deleteItem(item.id);
            toast('Удалено');
          }
        }
      }, '🗑')
    )
  );
  root.style.paddingBottom = '';
}

/* ---------- фильтрация ---------- */
export function filteredItems() {
  let list = visibleItems();
  if (filters.favOnly) list = list.filter(i => i.fav);
  if (filters.color) list = list.filter(i => itemMatchesColor(i, filters.color));
  const hue = i => {
    const c = i.colors?.[0]?.hex;
    if (!c) return 999;
    const [L, a, b] = oklab(...[1, 3, 5].map(k => parseInt(c.substr(k, 2), 16)));
    return Math.atan2(b, a);
  };
  const sorters = {
    new: (a, b) => b.createdAt - a.createdAt,
    old: (a, b) => a.createdAt - b.createdAt,
    name: (a, b) => (a.name || '').localeCompare(b.name || '', 'ru'),
    color: (a, b) => hue(a) - hue(b)
  };
  return list.sort(sorters[filters.sort] || sorters.new);
}

/* ---------- палитра гардероба ---------- */
function closetColors() {
  // группируем цвета вещей по базовой палитре
  const counts = new Map();
  for (const it of visibleItems()) {
    const seen = new Set();
    for (const c of it.colors || []) {
      if (c.ratio < 0.08) continue;
      const base = BASE_COLORS.find(bc => itemMatchesColor({ colors: [c] }, bc.hex, 0.13)) || null;
      if (base && !seen.has(base.hex)) { seen.add(base.hex); counts.set(base.hex, (counts.get(base.hex) || 0) + 1); }
    }
  }
  return BASE_COLORS.filter(c => counts.has(c.hex)).map(c => ({ ...c, n: counts.get(c.hex) }))
    .sort((a, b) => b.n - a.n);
}

/* ---------- менеджер категорий ---------- */
/** Один и тот же менеджер обслуживает гардероб и архив — разница только в scope. */
export function openCategoryManager(scope = 'closet') {
  const arc = scope === SCOPE_ARCHIVE;
  const body = h('div', { class: 'list' });
  const modal = openModal({ title: arc ? 'Категории архива' : 'Категории', body, full: true });

  function render() {
    fill(body,
      ...(arc ? archiveCats() : closetCats().filter(c => !c.system)).map(c => h('div', { class: 'lrow' },
        // та же миниатюра, что и в списке разделов: фотография, а не пиктограмма
        thumbOf(latestIn(c.id, null, arc)),
        h('div', { class: 't' },
          h('b', {}, c.name),
          h('span', {}, `${nItems(countIn(c))} · ${plural(c.subs.length, 'подкатегория', 'подкатегории', 'подкатегорий')}`)),
        h('button', {
          class: 'btn btn-sm', onclick: async () => {
            // здесь — только действия над самой категорией. Её подкатегории
            // настраиваются изнутри неё, кнопкой в заголовке раздела
            const act = await actionSheet(c.name, [
              { id: 'ren', icon: '✎', label: 'Переименовать' },
              { id: 'del', icon: '🗑', label: 'Удалить категорию', danger: true }
            ]);
            if (act === 'ren') {
              const n = await promptDialog('Переименовать', c.name);
              if (n) { c.name = n; await saveCat(c); render(); }
            } else if (act === 'del') {
              // непустую категорию не удаляем: иначе её вещи разом остались бы
              // без места. Сначала перенос — он есть прямо в разделе
              const n = countIn(c);
              if (n) {
                await alertDialog(
                  `В категории «${c.name}» ${nItems(n)}. Откройте её, нажмите «Выбрать» и переместите вещи — `
                  + 'после этого категорию можно будет удалить.',
                  'Категория не пуста');
              } else if (await confirmDialog(`Удалить «${c.name}»?`)) {
                await deleteCat(c.id); render();
              }
            }
          }
        }, '⋯')
      )),
      h('button', {
        class: 'btn block primary', style: { marginTop: '12px' }, onclick: async () => {
          const n = await promptDialog('Новая категория');
          if (!n) return;
          await saveCat({
            id: uid('c'), name: n, order: state.cats.length,
            custom: true, scope, subs: []
          });
          render();
        }
      }, '+ Добавить категорию')
    );
  }
  render();
}

function openSubManager(cat, onDone) {
  const arc = cat.scope === SCOPE_ARCHIVE;
  const pool = () => arc ? archivedItems() : visibleItems();
  const subOf = i => arc ? i.arcSubId : i.subId;

  const body = h('div', { class: 'list' });
  const modal = openModal({ title: cat.name, body, onClose: onDone });
  function render() {
    fill(body,
      ...cat.subs.map(s => h('div', { class: 'lrow' },
        h('div', { class: 't' }, h('b', {}, s.name),
          h('span', {}, nItems(pool().filter(i => subOf(i) === s.id).length))),
        h('button', {
          class: 'btn btn-sm', onclick: async () => {
            const n = await promptDialog('Переименовать', s.name);
            if (n) { s.name = n; await saveCat(cat); render(); }
          }
        }, '✎'),
        h('button', {
          class: 'btn btn-sm danger', onclick: async () => {
            // вещи остаются в категории: их подхватит «Другое»
            cat.subs = cat.subs.filter(x => x.id !== s.id);
            state.items.filter(i => subOf(i) === s.id)
              .forEach(i => { arc ? (i.arcSubId = null) : (i.subId = null); saveItem(i); });
            await saveCat(cat); render();
          }
        }, '🗑')
      )),
      cat.subs.length ? null : h('p', { class: 'muted small' }, 'Пока пусто'),
      h('button', {
        class: 'btn block primary', style: { marginTop: '12px' }, onclick: async () => {
          const n = await promptDialog('Новая подкатегория');
          if (!n) return;
          cat.subs.push({ id: uid('s'), name: n });
          await saveCat(cat);
          render();
        }
      }, '+ Добавить подкатегорию')
    );
  }
  render();
}

/* ---------- навигация ---------- */
/**
 * Гардероб устроен как папки: список категорий → подкатегории → вещи.
 * nav.catId пуст — показываем категории; есть категория без подкатегории —
 * её подкатегории (или сразу вещи, если подкатегорий нет); есть обе — вещи.
 * nav.all — плоский список всех вещей с фильтрами по цвету и избранному.
 * nav.archive — то же дерево, но по архивным вещам и архивным категориям.
 */
export const OTHER = '__other';
// высота закреплённой строки внизу — должна совпадать с .service-bar в стилях
const SERVICE_BAR_H = 42;
export const nav = { all: false, archive: false, catId: null, subId: null, itemId: null };

const goRoot = () => { nav.all = false; nav.archive = false; nav.catId = null; nav.subId = null; nav.itemId = null; emit(); };
const goArchive = () => { nav.all = false; nav.archive = true; nav.catId = null; nav.subId = null; nav.itemId = null; emit(); };
const openCat = id => { nav.catId = id; nav.subId = null; emit(); };
const openSub = id => { nav.subId = id; emit(); };

const curCats = (arc = nav.archive) => arc ? archiveCats() : closetCats();
const curCat = (id, arc = nav.archive) => curCats(arc).find(c => c.id === id) || null;

/**
 * Вещи раздела. subId === OTHER — те, что лежат в категории без подкатегории;
 * catId === OTHER — вещи, которым не задана категория (бывает только в архиве).
 * Ссылка на удалённую подкатегорию считается отсутствующей: иначе вещь пропала бы
 * и из списка подкатегорий, и из «Другого», то есть из раздела целиком.
 */
function itemsIn(catId, subId, arc = nav.archive) {
  const want = catId === OTHER ? null : catId;
  const subs = new Set((curCat(want, arc)?.subs || []).map(s => s.id));
  const catOf = i => (arc ? i.arcCatId : i.catId) || null;
  const subOf = i => {
    const v = arc ? i.arcSubId : i.subId;
    return subs.has(v) ? v : null;
  };
  const pool = arc ? archivedItems() : visibleItems();
  return pool
    .filter(i => catOf(i) === want && (subId == null || (subId === OTHER ? !subOf(i) : subOf(i) === subId)))
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Последняя добавленная вещь раздела — её миниатюра стоит в строке списка. */
const latestIn = (catId, subId, arc) => itemsIn(catId, subId, arc)[0] || null;

/** Что показать в верхней панели: заголовок раздела и кнопку «назад». */
export function closetNav() {
  if (nav.itemId) {
    const it = itemById(nav.itemId);
    if (it) return { title: it.name || 'Вещь', back: closeCard };
  }
  if (nav.all) return { title: 'Все вещи', back: goRoot };
  if (nav.archive && !nav.catId) return { title: 'Архив вещей', back: goRoot };
  if (nav.archive && nav.catId === OTHER) return { title: 'Другое', back: goArchive };

  const cat = curCat(nav.catId);
  if (!cat) return null;
  const up = nav.archive ? goArchive : goRoot;
  // Подкатегории настраиваются изнутри своей категории — и у гардероба,
  // и у архива. Исключение «Сортировка»: это временная стопка, её разбирают,
  // а не обустраивают. Названия рабочих полок не меняются, как и у архива
  if (!nav.subId) {
    return {
      title: cat.name, back: up,
      action: cat.system === 'sorting' ? null : {
        icon: '📂', title: 'Подкатегории',
        onclick: () => openSubManager(cat, emit)
      }
    };
  }
  const name = nav.subId === OTHER ? 'Другое' : subById(cat.id, nav.subId)?.name;
  return { title: name || cat.name, back: () => { nav.subId = null; emit(); } };
}

/* ---------- архив ---------- */
/**
 * Архив — пометка на вещи, а не категория: платье остаётся платьем и при
 * возврате встаёт на своё прежнее место в гардеробе. Из уже собранных образов
 * архивная вещь не исчезает, иначе календарь перестал бы соответствовать тому,
 * что было надето.
 */
export async function archiveItem(item) {
  const cats = archiveCats();
  // пока архивных категорий нет, не спрашиваем ни о чём: вещь уходит в архив
  // как есть, разложить её можно будет потом, уже внутри архива
  if (cats.length) {
    const dest = await pickDestination(true);
    if (!dest) return false;
    item.arcCatId = dest.catId;
    item.arcSubId = dest.subId;
  } else {
    item.arcCatId = null;
    item.arcSubId = null;
  }
  item.archived = true;
  await saveItem(item);
  toast('Перемещено в архив');
  return true;
}

export async function unarchiveItem(item) {
  item.archived = false;
  item.arcCatId = null;
  item.arcSubId = null;
  // категории могло не стать, пока вещь лежала в архиве
  if (!catById(item.catId)) {
    const sorting = sortingCat();
    item.catId = sorting?.id || null;
    item.subId = null;
    await saveItem(item);
    toast(`Категории больше нет — вещь в «${sorting?.name || 'гардеробе'}»`, 3400);
    return;
  }
  await saveItem(item);
  toast('Возвращено из архива');
}

/* ---------- множественный выбор ---------- */
/**
 * Выделение работает только внутри раздела, где видно, куда вещь положена.
 * В «Все вещи» его нет намеренно: там вещь вырвана из контекста, и перенос
 * вслепую слишком легко сделать не туда. Удаления здесь тоже нет — только
 * перенос, который всегда можно повторить.
 */
let selection = null;      // Set с id, пока режим включён
let selectionKey = null;   // раздел, в котором его включили

const sectionKey = () => `${nav.archive ? 'a' : 'c'}/${nav.catId || ''}/${nav.subId || ''}`;
const selectionOn = () => {
  if (selection && selectionKey !== sectionKey()) selection = null;
  return !!selection;
};
function toggleSelection(on) {
  selection = on ? new Set() : null;
  selectionKey = sectionKey();
  emit();
}

/** Куда переместить: сначала категория, затем её подкатегория. */
function pickDestination(arc = nav.archive) {
  return new Promise(res => {
    let done = false;
    const body = h('div', {});
    const finish = v => { done = true; res(v); modal.close(); };
    const modal = openModal({
      title: arc ? 'Куда в архиве' : 'Переместить в…', body, full: true,
      onClose: () => { if (!done) res(null); }
    });

    const showCats = () => fill(body,
      h('div', { class: 'list' },
        ...curCats(arc).map(c => navRow({
          thumb: latestIn(c.id, null, arc), title: c.name,
          note: c.subs.length
            ? plural(c.subs.length, 'подкатегория', 'подкатегории', 'подкатегорий')
            : nItems(itemsIn(c.id, null, arc).length),
          onclick: () => c.subs.length ? showSubs(c) : finish({ catId: c.id, subId: null })
        })),
        // в архиве вещь имеет право лежать вообще без категории
        arc ? navRow({
          thumb: latestIn(OTHER, null, true), title: 'Без категории', muted: true,
          note: 'в корень архива, в «Другое»',
          onclick: () => finish({ catId: null, subId: null })
        }) : null
      )
    );

    const showSubs = cat => fill(body,
      h('button', { class: 'btn btn-sm', onclick: showCats }, '‹ Все категории'),
      h('div', { class: 'section-title' }, cat.name),
      h('div', { class: 'list' },
        ...cat.subs.map(s => navRow({
          thumb: latestIn(cat.id, s.id, arc), title: s.name,
          note: nItems(itemsIn(cat.id, s.id, arc).length),
          onclick: () => finish({ catId: cat.id, subId: s.id })
        })),
        navRow({
          title: 'Без подкатегории', muted: true,
          note: 'в саму категорию, в «Другое»',
          onclick: () => finish({ catId: cat.id, subId: null })
        })
      )
    );

    showCats();
  });
}

async function moveSelected() {
  const arc = nav.archive;
  const dest = await pickDestination(arc);
  if (!dest) return;
  const items = [...selection].map(itemById).filter(Boolean);
  items.forEach(it => {
    if (arc) { it.arcCatId = dest.catId; it.arcSubId = dest.subId; }
    else { it.catId = dest.catId; it.subId = dest.subId; }
  });
  selection = null;                 // гасим режим до сохранения: оно перерисует экран
  await saveItems(items);
  const cat = dest.catId ? curCat(dest.catId, arc) : null;
  const sub = dest.subId ? subById(dest.catId, dest.subId) : null;
  toast(`${nItems(items.length)} → ${cat ? cat.name : 'без категории'}${sub ? ' › ' + sub.name : ''}`, 3000);
}

/* ---------- рендер вкладки ---------- */

/**
 * Строка списка: миниатюра, название, пояснение, стрелка вправо.
 * Пока в разделе нет вещей, миниатюра остаётся пустой — подставлять вместо неё
 * значок незачем, гардероб наполняют фотографии, а не пиктограммы.
 */
const thumbOf = item => item
  ? h('img', { class: 'thumb', src: urlFor(item.img), style: { background: bgCss(item.bg) } })
  : h('div', { class: 'thumb ph' });

function navRow({ thumb, thumbNode, title, note, muted, onclick }) {
  return h('div', { class: 'lrow nav' + (muted ? ' soft' : ''), onclick },
    thumbNode || thumbOf(thumb),
    h('div', { class: 't' }, h('b', {}, title), note ? h('span', {}, note) : null),
    h('span', { class: 'chev' }, '›')
  );
}

/**
 * Миниатюра «Всех вещей» — мозаика из четырёх последних добавленных.
 * Одна фотография повторяла бы картинку соседней строки.
 */
function collageThumb(items) {
  const four = items.slice(0, 4);
  if (!four.length) return h('div', { class: 'thumb ph' });
  return h('div', { class: 'thumb grid4' },
    four.map(it => h('img', { src: urlFor(it.img), style: { background: bgCss(it.bg) } })));
}

/** Закреплённая внизу строка: рабочие полки, которые не должны уезжать. */
function serviceBar({ icon, title, count, onclick }) {
  return h('div', { class: 'service-bar', onclick },
    h('span', {}, icon),
    h('b', { class: 'spacer' }, title),
    count ? h('span', { class: 'muted' }, count) : null,
    h('span', { class: 'muted' }, '›')
  );
}

/** Первый уровень гардероба: все вещи, служебные категории, затем обычные. */
function renderRoot(root) {
  const order = ['sorting', 'review'];
  const cats = closetCats();
  const system = cats.filter(c => c.system)
    .sort((a, b) => order.indexOf(a.system) - order.indexOf(b.system));
  const rest = cats.filter(c => !c.system).sort((a, b) => a.order - b.order);
  const archived = archivedItems().length;
  // полоска нужна и при пустом архиве, если категории в нём уже заведены —
  // иначе до них будет не добраться
  const hasArchive = archived || archiveCats().length;

  // «Сортировка», «На рассмотрении» и архив — рабочие полки, а не гардероб.
  // Они закреплены внизу: при листании категорий их место не меняется
  const bars = [
    ...system.map(c => serviceBar({
      icon: c.icon, title: c.name, count: countInCat(c.id), onclick: () => openCat(c.id)
    })),
    hasArchive ? serviceBar({
      icon: '📦', title: 'Архив вещей', count: archived, onclick: goArchive
    }) : null
  ].filter(Boolean);
  const barsH = bars.length * SERVICE_BAR_H + 1;

  fill(root,
    h('div', { class: 'list' },
      navRow({
        thumbNode: collageThumb(visibleItems()), title: 'Все вещи',
        note: nItems(visibleItems().length),
        onclick: () => { nav.all = true; emit(); }
      }),
      ...rest.map(c => navRow({
        thumb: latestIn(c.id, null, false), title: c.name,
        note: nItems(countInCat(c.id))
          + (c.subs.length ? ' · ' + plural(c.subs.length, 'подкатегория', 'подкатегории', 'подкатегорий') : ''),
        onclick: () => openCat(c.id)
      }))
    ),
    h('button', {
      class: 'btn block ghost', style: { marginTop: '14px' }, onclick: () => openCategoryManager()
    }, '⚙️ Управление категориями'),

    h('div', { class: 'pinned-bottom' }, bars),

    h('button', {
      class: 'fab', style: { bottom: `calc(var(--tabh) + ${barsH + 14}px)` },
      onclick: startAddItem, title: 'Добавить вещь'
    }, '+')
  );
  // запас, чтобы «Управление категориями» не оказалось под круглой кнопкой
  root.style.paddingBottom = barsH + 74 + 'px';
}

/** Первый уровень архива: его собственные категории плюс «Другое». */
function renderArchiveRoot(root) {
  const cats = archiveCats().sort((a, b) => a.order - b.order);
  const loose = itemsIn(OTHER, null, true).length;

  fill(root,
    cats.length || loose ? h('div', { class: 'list' },
      ...cats.map(c => navRow({
        thumb: latestIn(c.id, null, true), title: c.name,
        note: nItems(countInArcCat(c.id))
          + (c.subs.length ? ' · ' + plural(c.subs.length, 'подкатегория', 'подкатегории', 'подкатегорий') : ''),
        onclick: () => openCat(c.id)
      })),
      loose ? navRow({
        thumb: latestIn(OTHER, null, true), title: 'Другое', muted: true,
        note: nItems(loose) + ' без категории',
        onclick: () => openCat(OTHER)
      }) : null
    ) : h('div', { class: 'empty' },
      h('div', { class: 'big' }, '📦'),
      h('p', {}, 'Архив пуст. Вещи попадают сюда из карточки — «В архив».')),

    cats.length || loose ? h('button', {
      class: 'btn block ghost', style: { marginTop: '14px' },
      onclick: () => openCategoryManager(SCOPE_ARCHIVE)
    }, '⚙️ Категории архива') : null
  );
  root.style.paddingBottom = '';
}

/** Второй уровень: подкатегории. «Другое» появляется само, когда есть что показать. */
function renderCat(root, cat) {
  const loose = itemsIn(cat.id, OTHER).length;

  fill(root,
    h('div', { class: 'list' },
      ...cat.subs.map(s => navRow({
        thumb: latestIn(cat.id, s.id), title: s.name,
        note: nItems(itemsIn(cat.id, s.id).length),
        onclick: () => openSub(s.id)
      })),
      // служебная строка: не хранится, не переименовывается, исчезает сама
      loose ? navRow({
        thumb: latestIn(cat.id, OTHER), title: 'Другое', muted: true,
        note: nItems(loose) + ' без подкатегории',
        onclick: () => openSub(OTHER)
      }) : null
    ),
    nav.archive ? null : h('button', { class: 'fab', onclick: startAddItem, title: 'Добавить вещь' }, '+')
  );
  root.style.paddingBottom = '';
}

const itemTile = (it, selectable = false) => {
  const picked = selectable && selection.has(it.id);
  return h('div', {
    class: 'tile' + (picked ? ' sel' : ''), style: { background: bgCss(it.bg) },
    onclick: () => {
      if (!selectable) return openItemCard(it);
      picked ? selection.delete(it.id) : selection.add(it.id);
      emit();
    }
  },
    h('img', { src: urlFor(it.img), alt: it.name }),
    it.fav && !selectable ? h('span', { class: 'fav' }, '★') : null,
    selectable ? h('span', { class: 'check' + (picked ? ' on' : '') }, picked ? '✓' : '') : null,
    it.name ? h('span', { class: 'lbl' }, it.name) : null
  );
};

/** Сетка вещей раздела — единственное место, где работает множественный выбор. */
function renderItems(root, list, emptyText) {
  const on = selectionOn();
  const all = on && list.length && list.every(i => selection.has(i.id));

  fill(root,
    h('div', { class: 'row', style: { margin: '2px 0 8px' } },
      h('span', { class: 'small muted spacer' }, on ? `Выбрано ${selection.size}` : nItems(list.length)),
      list.length ? h('button', {
        class: 'btn btn-sm', onclick: () => toggleSelection(!on)
      }, on ? 'Отмена' : 'Выбрать') : null
    ),

    list.length ? h('div', { class: 'grid' }, list.map(it => itemTile(it, on))) : h('div', { class: 'empty' },
      h('div', { class: 'big' }, '🧺'),
      h('p', {}, emptyText)),

    on ? h('div', { class: 'select-bar' },
      h('button', {
        class: 'btn btn-sm', onclick: () => {
          selection = all ? new Set() : new Set(list.map(i => i.id));
          emit();
        }
      }, all ? 'Снять все' : 'Выбрать все'),
      h('span', { class: 'spacer' }),
      h('button', {
        class: 'btn btn-sm btn-add', disabled: !selection.size, onclick: moveSelected
      }, 'Переместить в…')
    ) : null,

    on || nav.archive ? null : h('button', { class: 'fab', onclick: startAddItem, title: 'Добавить вещь' }, '+')
  );
  root.style.paddingBottom = on ? '140px' : '';
}

/** «Все вещи»: единственное место, где работают фильтры по цвету и избранному. */
function renderAll(root) {
  const palette = closetColors();
  const list = filteredItems();

  const colorRow = h('div', { class: 'palette-row' },
    h('button', {
      class: 'swatch', title: 'Сканировать цвет камерой',
      style: { background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px' },
      onclick: async () => { const hex = await scanColorFromCamera(); if (hex) { filters.color = hex; emit(); } }
    }, '📷'),
    ...(palette.length ? palette : BASE_COLORS).map(c => h('button', {
      class: 'swatch' + (filters.color === c.hex ? ' sel' : ''),
      style: { background: c.hex }, title: `${c.name}${c.n ? ' · ' + c.n : ''}`,
      onclick: () => { filters.color = filters.color === c.hex ? null : c.hex; emit(); }
    }))
  );

  const controls = h('div', { class: 'row', style: { margin: '8px 0 4px' } },
    h('span', { class: 'small muted spacer' }, nItems(list.length)),
    filters.color ? h('button', {
      class: 'chip active', onclick: () => { filters.color = null; emit(); }
    }, h('span', { class: 'dot', style: { background: filters.color } }), colorName(filters.color), ' ✕') : null,
    h('button', {
      class: 'chip' + (filters.favOnly ? ' active' : ''),
      onclick: () => { filters.favOnly = !filters.favOnly; emit(); }
    }, '★'),
    h('select', {
      style: { width: 'auto', padding: '5px 8px', fontSize: '12px' },
      onchange: e => { filters.sort = e.target.value; emit(); }
    },
      [['new', 'Сначала новые'], ['old', 'Сначала старые'], ['name', 'По названию'], ['color', 'По цвету']]
        .map(([v, t]) => h('option', { value: v, selected: filters.sort === v }, t)))
  );

  fill(root, colorRow, controls,
    list.length ? h('div', { class: 'grid' }, list.map(it => itemTile(it))) : h('div', { class: 'empty' },
      h('div', { class: 'big' }, '🧺'),
      h('p', {}, visibleItems().length
        ? 'Ничего не найдено по фильтрам'
        : 'Гардероб пуст. Чтобы добавить вещи, нажмите «+» внизу справа.')),
    h('button', { class: 'fab', onclick: startAddItem, title: 'Добавить вещь' }, '+')
  );
  root.style.paddingBottom = '';
}

export function renderCloset(root) {
  // карточка вещи лежит поверх любого раздела: возврат ведёт туда, откуда открыли
  if (nav.itemId) {
    const it = itemById(nav.itemId);
    if (it) return renderItemCard(root, it);
    nav.itemId = null;
  }
  if (nav.all) return renderAll(root);
  if (nav.archive && !nav.catId) return renderArchiveRoot(root);
  // «Другое» существует, только пока в нём что-то есть: разложили всё —
  // возвращаемся на уровень выше, а не смотрим на пустой экран
  if (nav.archive && nav.catId === OTHER) {
    const loose = itemsIn(OTHER, null, true);
    if (!loose.length) { nav.catId = null; return renderArchiveRoot(root); }
    return renderItems(root, loose, 'Здесь пусто.');
  }

  const cat = curCat(nav.catId);
  if (!cat) {
    nav.catId = null;
    nav.subId = null;
    return nav.archive ? renderArchiveRoot(root) : renderRoot(root);
  }

  // подкатегории показываем только там, где они есть
  if (!nav.subId) {
    return cat.subs.length
      ? renderCat(root, cat)
      : renderItems(root, itemsIn(cat.id), nav.archive
        ? `В разделе «${cat.name}» пока пусто.`
        : `В разделе «${cat.name}» пока пусто. Нажмите «+» внизу справа.`);
  }
  const list = itemsIn(cat.id, nav.subId);
  if (nav.subId === OTHER && !list.length) { nav.subId = null; return renderCat(root, cat); }
  const name = nav.subId === OTHER ? 'Другое' : subById(cat.id, nav.subId)?.name || cat.name;
  renderItems(root, list, `В разделе «${name}» пока пусто.`);
}
