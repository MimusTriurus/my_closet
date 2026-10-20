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

export const filters = { catId: null, subId: null, color: null, sort: 'new', favOnly: false };

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
    catId: preset.catId ?? filters.catId ?? state.cats.find(c => !c.system)?.id ?? null,
    subId: preset.subId ?? null,
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
  filters.catId = cat?.id ?? null;
  filters.subId = null;
  filters.color = null;
  filters.favOnly = false;
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
          class: 'chip', onclick: () => { filters.color = c.hex; modal.close(); emit(); }
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
  if (filters.catId) list = list.filter(i => i.catId === filters.catId);
  if (filters.subId) list = list.filter(i => i.subId === filters.subId);
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

/* ---------- рендер вкладки ---------- */
export function renderCloset(root) {
  const cats = state.cats;
  const cur = catById(filters.catId);
  const palette = closetColors();

  const catChips = h('div', { class: 'chips' },
    h('button', {
      class: 'chip' + (!filters.catId ? ' active' : ''),
      onclick: () => { filters.catId = null; filters.subId = null; emit(); }
    }, 'Все', h('span', { class: 'cnt' }, state.items.length)),
    ...cats.map(c => h('button', {
      class: 'chip' + (filters.catId === c.id ? ' active' : ''),
      onclick: () => { filters.catId = c.id; filters.subId = null; emit(); }
    }, `${c.icon || ''} ${c.name}`, h('span', { class: 'cnt' }, countInCat(c.id)))),
    h('button', { class: 'chip', onclick: openCategoryManager }, '⚙️')
  );

  const subChips = cur && cur.subs.length ? h('div', { class: 'chips' },
    h('button', {
      class: 'chip' + (!filters.subId ? ' active' : ''),
      onclick: () => { filters.subId = null; emit(); }
    }, 'Все'),
    ...cur.subs.map(s => h('button', {
      class: 'chip' + (filters.subId === s.id ? ' active' : ''),
      onclick: () => { filters.subId = s.id; emit(); }
    }, s.name, h('span', { class: 'cnt' }, state.items.filter(i => i.subId === s.id).length)))
  ) : null;

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

  const list = filteredItems();

  const controls = h('div', { class: 'row', style: { margin: '8px 0 4px' } },
    h('span', { class: 'small muted spacer' }, `${list.length} вещей`),
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

  const grid = list.length ? h('div', { class: 'grid' },
    list.map(it => h('div', {
      class: 'tile', style: { background: bgCss(it.bg) }, onclick: () => openItemCard(it)
    },
      h('img', { src: urlFor(it.img), alt: it.name }),
      it.fav ? h('span', { class: 'fav' }, '★') : null,
      it.name ? h('span', { class: 'lbl' }, it.name) : null
    ))
  ) : h('div', { class: 'empty' },
    h('div', { class: 'big' }, '🧺'),
    // добавление живёт только на кнопке «+» — здесь лишь подсказка, куда нажать
    h('p', {}, state.items.length
      ? 'Ничего не найдено по фильтрам'
      : 'Гардероб пуст. Нажмите + внизу справа, чтобы добавить первую вещь.')
  );

  fill(root, catChips, subChips, colorRow, controls, grid,
    h('button', { class: 'fab', onclick: startAddItem, title: 'Добавить вещь' }, '+'));
}
