// Вкладка «Гардероб»: категории, подкатегории, фильтр по цвету, сортировка, карточка вещи.
import { fill, h, qs, urlFor, toast, openModal, confirmDialog, promptDialog, actionSheet, busy } from './ui.js';
import {
  state, saveItem, deleteItem, saveCat, deleteCat, catById, subById, countInCat,
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
    }, state.cats.map(c => h('option', { value: c.id, selected: c.id === item.catId }, `${c.icon || ''} ${c.name}`)));

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
export function openItemCard(item) {
  const modal = openModal({
    title: item.name || 'Вещь',
    body: h('div', {},
      h('div', {
        class: 'tile', style: { aspectRatio: '1', background: bgCss(item.bg), marginBottom: '12px' }
      }, h('img', { src: urlFor(item.img) })),
      h('div', { class: 'lrow' },
        h('div', { class: 't' },
          h('b', {}, item.name || '—'),
          h('span', {}, [catById(item.catId)?.name, subById(item.catId, item.subId)?.name].filter(Boolean).join(' › ') || 'Без категории'))
      ),
      h('div', { class: 'section-title' }, 'Цвета'),
      h('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } },
        (item.colors || []).map(c => h('div', {
          class: 'chip', onclick: () => { filters.color = c.hex; nav.all = true; nav.catId = null; modal.close(); emit(); }
        }, h('span', { class: 'dot', style: { background: c.hex } }), colorName(c.hex)))
      )
    ),
    foot: [
      h('button', {
        class: 'btn', onclick: async () => { item.fav = !item.fav; await saveItem(item); toast(item.fav ? 'В избранном' : 'Убрано'); modal.close(); }
      }, item.fav ? '★ Избранное' : '☆ В избранное'),
      h('button', { class: 'btn', onclick: async () => { modal.close(); await openItemForm(item); } }, '✎ Изменить'),
      h('button', {
        class: 'btn danger', onclick: async () => {
          if (await confirmDialog('Удалить вещь из гардероба?')) { await deleteItem(item.id); modal.close(); toast('Удалено'); }
        }
      }, '🗑')
    ]
  });
}

/* ---------- фильтрация ---------- */
export function filteredItems() {
  let list = state.items.slice();
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
  for (const it of state.items) {
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
export function openCategoryManager() {
  const body = h('div', { class: 'list' });
  const modal = openModal({ title: 'Категории', body, full: true });

  function render() {
    fill(body, 
      ...state.cats.map(c => h('div', { class: 'lrow' },
        h('div', { style: { fontSize: '22px' } }, c.icon || '📦'),
        h('div', { class: 't' },
          h('b', {}, c.name),
          h('span', {}, c.system
            ? `${countInCat(c.id)} вещей · служебная категория`
            : `${countInCat(c.id)} вещей · ${c.subs.length} подкатегорий`)),
        h('button', {
          class: 'btn btn-sm', onclick: async () => {
            // служебную категорию можно только переименовать: ни подкатегорий, ни удаления
            const act = await actionSheet(c.name, c.system ? [
              { id: 'ren', icon: '✎', label: 'Переименовать' }
            ] : [
              { id: 'sub', icon: '➕', label: 'Добавить подкатегорию' },
              { id: 'subs', icon: '📂', label: 'Подкатегории' },
              { id: 'ren', icon: '✎', label: 'Переименовать' },
              { id: 'del', icon: '🗑', label: 'Удалить категорию', danger: true }
            ]);
            if (act === 'sub') {
              const n = await promptDialog('Новая подкатегория');
              if (n) { c.subs.push({ id: uid('s'), name: n }); await saveCat(c); render(); }
            } else if (act === 'subs') {
              openSubManager(c, render);
            } else if (act === 'ren') {
              const n = await promptDialog('Переименовать', c.name);
              if (n) { c.name = n; await saveCat(c); render(); }
            } else if (act === 'del') {
              if (await confirmDialog(`Удалить «${c.name}»? Вещи останутся, но потеряют категорию.`)) {
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
          await saveCat({ id: uid('c'), name: n, icon: '📦', order: state.cats.length, custom: true, subs: [] });
          render();
        }
      }, '+ Добавить категорию')
    );
  }
  render();
}

function openSubManager(cat, onDone) {
  const body = h('div', { class: 'list' });
  const modal = openModal({ title: cat.name, body, onClose: onDone });
  function render() {
    fill(body, 
      ...cat.subs.map(s => h('div', { class: 'lrow' },
        h('div', { class: 't' }, h('b', {}, s.name),
          h('span', {}, state.items.filter(i => i.subId === s.id).length + ' вещей')),
        h('button', {
          class: 'btn btn-sm', onclick: async () => {
            const n = await promptDialog('Переименовать', s.name);
            if (n) { s.name = n; await saveCat(cat); render(); }
          }
        }, '✎'),
        h('button', {
          class: 'btn btn-sm danger', onclick: async () => {
            cat.subs = cat.subs.filter(x => x.id !== s.id);
            state.items.filter(i => i.subId === s.id).forEach(i => { i.subId = null; saveItem(i); });
            await saveCat(cat); render();
          }
        }, '🗑')
      )),
      cat.subs.length ? null : h('p', { class: 'muted small' }, 'Пока пусто')
    );
  }
  render();
}

/* ---------- навигация по гардеробу ---------- */
/**
 * Гардероб устроен как папки: список категорий → подкатегории → вещи.
 * nav.catId пуст — показываем категории; есть категория без подкатегории —
 * её подкатегории (или сразу вещи, если подкатегорий нет); есть обе — вещи.
 * nav.all — плоский список всех вещей с фильтрами по цвету и избранному.
 */
export const OTHER = '__other';
export const nav = { all: false, catId: null, subId: null };

const goRoot = () => { nav.all = false; nav.catId = null; nav.subId = null; emit(); };
const openCat = id => { nav.catId = id; nav.subId = null; emit(); };
const openSub = id => { nav.subId = id; emit(); };

/** Вещи раздела. subId === OTHER — те, что лежат в категории без подкатегории. */
function itemsIn(catId, subId) {
  const list = state.items.filter(i => i.catId === catId
    && (subId == null || (subId === OTHER ? !i.subId : i.subId === subId)));
  return list.sort((a, b) => b.createdAt - a.createdAt);
}

/** Последняя добавленная вещь раздела — её миниатюра стоит в строке списка. */
const latestIn = (catId, subId) => itemsIn(catId, subId)[0] || null;

/** Что показать в верхней панели: заголовок раздела и кнопку «назад». */
export function closetNav() {
  if (nav.all) return { title: 'Все вещи', back: goRoot };
  const cat = catById(nav.catId);
  if (!cat) return null;
  if (!nav.subId) return { title: cat.name, back: goRoot };
  const name = nav.subId === OTHER ? 'Другое' : subById(cat.id, nav.subId)?.name;
  return { title: name || cat.name, back: () => { nav.subId = null; emit(); } };
}

/* ---------- рендер вкладки ---------- */

/** Строка списка: миниатюра, название, пояснение, стрелка вправо. */
function navRow({ thumb, icon, title, note, muted, onclick }) {
  return h('div', { class: 'lrow nav' + (muted ? ' soft' : ''), onclick },
    thumb
      ? h('img', { class: 'thumb', src: urlFor(thumb.img), style: { background: bgCss(thumb.bg) } })
      : h('div', { class: 'thumb ph' }, icon || '📦'),
    h('div', { class: 't' }, h('b', {}, title), note ? h('span', {}, note) : null),
    h('span', { class: 'chev' }, '›')
  );
}

const plural = (n, one, few, many) => {
  const a = Math.abs(n) % 100, b = a % 10;
  return n + ' ' + (a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many);
};

const nItems = n => plural(n, 'вещь', 'вещи', 'вещей');

/** Первый уровень: все вещи, служебные категории, затем обычные. */
function renderRoot(root) {
  const order = ['sorting', 'review'];
  const system = state.cats.filter(c => c.system)
    .sort((a, b) => order.indexOf(a.system) - order.indexOf(b.system));
  const rest = state.cats.filter(c => !c.system).sort((a, b) => a.order - b.order);

  fill(root,
    h('div', { class: 'list' },
      navRow({
        thumb: state.items[0], icon: '🧺', title: 'Все вещи',
        note: nItems(state.items.length),
        onclick: () => { nav.all = true; emit(); }
      }),
      ...[...system, ...rest].map(c => navRow({
        thumb: latestIn(c.id), icon: c.icon, title: c.name,
        note: nItems(countInCat(c.id))
          + (c.subs.length ? ' · ' + plural(c.subs.length, 'подкатегория', 'подкатегории', 'подкатегорий') : ''),
        onclick: () => openCat(c.id)
      }))
    ),
    h('button', {
      class: 'btn block ghost', style: { marginTop: '14px' }, onclick: openCategoryManager
    }, '⚙️ Управление категориями'),
    h('button', { class: 'fab', onclick: startAddItem, title: 'Добавить вещь' }, '+')
  );
}

/** Второй уровень: подкатегории. «Другое» появляется само, когда есть что показать. */
function renderCat(root, cat) {
  const loose = itemsIn(cat.id, OTHER).length;

  fill(root,
    h('div', { class: 'list' },
      ...cat.subs.map(s => navRow({
        thumb: latestIn(cat.id, s.id), icon: '📂', title: s.name,
        note: nItems(itemsIn(cat.id, s.id).length),
        onclick: () => openSub(s.id)
      })),
      // служебная строка: не хранится, не переименовывается, исчезает сама
      loose ? navRow({
        thumb: latestIn(cat.id, OTHER), icon: '📂', title: 'Другое', muted: true,
        note: nItems(loose) + ' без подкатегории',
        onclick: () => openSub(OTHER)
      }) : null
    ),
    h('button', { class: 'fab', onclick: startAddItem, title: 'Добавить вещь' }, '+')
  );
}

const itemTile = it => h('div', {
  class: 'tile', style: { background: bgCss(it.bg) }, onclick: () => openItemCard(it)
},
  h('img', { src: urlFor(it.img), alt: it.name }),
  it.fav ? h('span', { class: 'fav' }, '★') : null,
  it.name ? h('span', { class: 'lbl' }, it.name) : null
);

/** Сетка вещей раздела. */
function renderItems(root, list, emptyText) {
  fill(root,
    list.length ? h('div', { class: 'grid' }, list.map(itemTile)) : h('div', { class: 'empty' },
      h('div', { class: 'big' }, '🧺'),
      h('p', {}, emptyText)),
    h('button', { class: 'fab', onclick: startAddItem, title: 'Добавить вещь' }, '+')
  );
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
    list.length ? h('div', { class: 'grid' }, list.map(itemTile)) : h('div', { class: 'empty' },
      h('div', { class: 'big' }, '🧺'),
      h('p', {}, state.items.length
        ? 'Ничего не найдено по фильтрам'
        : 'Гардероб пуст. Чтобы добавить вещи, нажмите «+» внизу справа.')),
    h('button', { class: 'fab', onclick: startAddItem, title: 'Добавить вещь' }, '+')
  );
}

export function renderCloset(root) {
  if (nav.all) return renderAll(root);

  const cat = catById(nav.catId);
  if (!cat) { nav.catId = null; nav.subId = null; return renderRoot(root); }

  // подкатегории показываем только там, где они есть
  if (!nav.subId) {
    return cat.subs.length
      ? renderCat(root, cat)
      : renderItems(root, itemsIn(cat.id), `В разделе «${cat.name}» пока пусто. Нажмите «+» внизу справа.`);
  }
  const name = nav.subId === OTHER ? 'Другое' : subById(cat.id, nav.subId)?.name || cat.name;
  renderItems(root, itemsIn(cat.id, nav.subId), `В разделе «${name}» пока пусто.`);
}
