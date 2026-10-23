// Вкладка «Гардероб»: категории, подкатегории, фильтр по цвету, сортировка, карточка вещи.
import {
  fill, h, qs, urlFor, toast, openModal, confirmDialog, actionSheet, busy, plural, nItems, nOutfits
} from './ui.js';
import { openListPicker, entryName } from './fields.js';
import { openCategoryManager, openSubManager } from './cats.js';
import {
  state, saveItem, saveItems, deleteItem, catById, subById, countInCat,
  visibleItems, archivedItems, itemById, closetCats, archiveCats, countInArcCat,
  SCOPE_CLOSET, SCOPE_ARCHIVE,
  createItem, sortingCat, emit, listEntry, lastCurrency, wearCount, closetItems
} from './state.js';
import { extractPalette } from './color.js';
import { BGS, bgCss } from './bgs.js';
import { openImageEditor, imageFromBlob, downscaleBlob } from './editor.js';
import { pickImageFile, pickImageFiles, captureFromCamera } from './capture.js';

/**
 * Фильтры живут в «Все вещи» и «Весь архив» — по категориям ходит nav.
 * Наборы у гардероба и архива **раздельные**: это разные пространства, и
 * фильтр, выставленный в одном, не должен встречать в другом.
 */
const newFilters = () => ({ color: null, brand: null, material: null, favOnly: false, sort: 'new' });
const FILTERS = { closet: newFilters(), archive: newFilters() };
export const filters = (arc = nav.archive) => FILTERS[arc ? 'archive' : 'closet'];

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

  if (!added) { toast('Не удалось прочитать снимки', 3200); return; }
  nav.all = false;
  nav.catId = cat?.id ?? null;
  nav.subId = null;
  emit();
  const skipped = files.length - added;
  toast(`Добавлено ${added} в «${cat?.name || 'гардероб'}»` + (skipped ? ` · пропущено ${skipped}` : ''), 3000);
}

export async function startAddItem() {
  const src = await actionSheet('Добавить вещь', [
    { id: 'cam', icon: '📸', label: 'Сфотографировать' },
    { id: 'file', icon: '🖼', label: 'Выбрать из галереи' },
    { id: 'bulk', icon: '🗃', label: 'Добавить несколько' }
  ]);
  if (!src) return;
  if (src === 'bulk') return startBulkAdd();
  const blob = src === 'cam' ? await captureFromCamera() : await pickImageFile();
  if (!blob) return;
  await addItemFlow(blob);
}

/* ---------- поля-списки и состав ---------- */
/**
 * Поле, значение которого выбирается из общего списка. Пустое не прячем:
 * пустая строка напоминает, что её стоит заполнить.
 */
function listField(label, key, getId, setId, empty = 'не указано') {
  const btn = h('button', {
    class: 'btn block pick', onclick: async () => {
      const id = await openListPicker(key, { selected: getId() });
      if (id === null) return;
      setId(id || null);
      paint();
    }
  });
  const paint = () => {
    const name = entryName(key, getId());
    // род подписи задаётся снаружи: «не указан» у производителя,
    // «не указана» у цены — одного слова на все поля не существует
    fill(btn, h('span', { class: name ? '' : 'muted' }, name || empty));
  };
  paint();
  return h('label', { class: 'field' }, h('span', {}, label), btn);
}

/**
 * Состав: строки добавляются по «+». Пустая строка под единственным материалом
 * ничего не напоминает — правильного их числа не существует.
 */
const MAX_PARTS = 7;
function compositionGroup(label, list) {
  const box = h('div', {});
  function paint() {
    fill(box,
      h('div', { class: 'section-title' }, label),
      list.map((part, i) => h('div', { class: 'row part-row' },
        h('button', {
          class: 'btn pick spacer', onclick: async () => {
            const id = await openListPicker('materials', { selected: part.id });
            if (!id) return;
            part.id = id;
            paint();
          }
        }, entryName('materials', part.id) || 'не указан'),
        h('input', {
          type: 'number', class: 'pct', min: '1', max: '100', step: '1',
          inputmode: 'numeric', placeholder: '%', value: part.pct ?? '',
          oninput: e => {
            const v = parseInt(e.target.value, 10);
            part.pct = Number.isFinite(v) ? Math.min(100, Math.max(1, v)) : null;
          }
        }),
        h('button', {
          class: 'icon-btn', title: 'Убрать',
          onclick: () => { list.splice(i, 1); paint(); }
        }, '✕')
      )),
      list.length < MAX_PARTS ? h('button', {
        class: 'btn block btn-add', onclick: async () => {
          const id = await openListPicker('materials', {});
          if (!id) return;
          list.push({ id, pct: null });
          paint();
        }
      }, '+ Материал') : null
    );
  }
  paint();
  return box;
}

/**
 * Цвета вещи. Проставляются вручную: у человека своё видение цвета, и тот,
 * кто носит шартрез, ищет его как шартрез. Оттенки с фотографии идут
 * подсказкой при создании нового цвета палитры — не больше того.
 */
const MAX_COLORS = 5;
function colorsGroup(ids, suggest) {
  const box = h('div', {});
  function paint() {
    fill(box,
      h('div', { class: 'section-title' }, 'Цвета'),
      h('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } },
        ids.map((id, i) => {
          const c = listEntry('colors', id);
          return h('button', {
            class: 'chip', onclick: () => { ids.splice(i, 1); paint(); }
          }, h('span', { class: 'dot', style: { background: c?.hex } }), (c?.name || 'цвет') + ' ✕');
        }),
        ids.length < MAX_COLORS ? h('button', {
          class: 'chip add', onclick: async () => {
            const id = await openListPicker('colors', { exclude: ids, suggest });
            if (!id) return;
            ids.push(id);
            paint();
          }
        }, '+ Цвет') : null
      )
    );
  }
  paint();
  return box;
}

/**
 * Удаление вещи. Один вопрос, в котором сказано, **что именно пропадёт**:
 * вещь вычёркивается из образов, отмеченных дней и поездок молча, и это
 * опаснее исчезновения самой карточки — образ соберётся без неё, а понять
 * это потом будет не по чему.
 *
 * Если вещь где-то участвует, первым предлагаем архив: он убирает вещь из
 * выбора, но сохраняет и её, и всё, что на неё ссылается. Удаление — для
 * ошибок и дублей, а не для расставания с вещью.
 */
function removeItemFlow(item) {
  const outfits = state.outfits.filter(o => (o.layers || []).some(l => l.itemId === item.id)).length;
  const days = wearCount(item.id);
  const trips = state.trips.filter(t => (t.itemIds || []).includes(item.id)).length;

  // перечисляем только то, что есть на самом деле: предупреждение, которое
  // пугает выдуманными последствиями, перестают читать после первого раза
  const parts = [], loss = [];
  if (outfits) { parts.push('входит в ' + nOutfits(outfits)); loss.push('образы соберутся без неё'); }
  if (days) { parts.push('отмечена в календаре ' + plural(days, 'раз', 'раза', 'раз')); loss.push('отметки пропадут'); }
  if (trips) { parts.push('лежит в ' + plural(trips, 'поездке', 'поездках', 'поездках')); loss.push('из списка поездки уйдёт'); }
  const used = parts.length;

  return new Promise(res => {
    let done = false;
    const finish = async what => {
      done = true; m.close();
      if (what === 'arc') { if (await archiveItem(item)) closeCard(); }
      else if (what === 'del') { closeCard(); await deleteItem(item.id); toast('Удалено'); }
      res(what);
    };

    const m = openModal({
      title: 'Удалить вещь?',
      body: h('div', {},
        h('p', { style: { margin: '4px 0 8px' } }, used
          ? `Вещь ${parts.join(', ')}. Оттуда она исчезнет — ${loss.join(', ')}.`
          : 'Вещь нигде не используется — ни в образах, ни в календаре, ни в поездках.'),
        used && !item.archived ? h('p', { class: 'muted small', style: { margin: '0 0 10px' } },
          'Если вещь просто больше не носится, лучше убрать её в архив: там сохранится и она сама, и всё, где она записана.') : null,
        used && !item.archived ? h('button', {
          class: 'btn block primary', onclick: () => finish('arc')
        }, '📦 Переместить в архив') : null
      ),
      foot: [
        h('button', { class: 'btn', onclick: () => m.close() }, 'Отмена'),
        h('button', { class: 'btn danger', onclick: () => finish('del') }, 'Удалить')
      ],
      onClose: () => { if (!done) res(null); }
    });
  });
}

/* ---------- форма вещи ---------- */
export function openItemForm(item, isNew = false) {
  return new Promise(res => {
    let resolved = false;
    // правим копии: отмена не должна оставлять следов в вещи
    const mat = {
      main: (item.material?.main || []).map(p => ({ ...p })),
      lining: (item.material?.lining || []).map(p => ({ ...p }))
    };
    let brandId = item.brandId || null;
    const colorIds = [...(item.colorIds || [])];
    // подсказка для новых цветов палитры — оттенки, снятые с этой фотографии
    const suggest = (item.colors || []).map(c => c.hex);

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

    // Фотография правится отдельно от полей, но применяется вместе с ними:
    // пока форма открыта, «Отмена» обязана вернуть прежний снимок.
    let img = item.img;
    let colors = item.colors || [];

    // снимок не нажимается: под ним стоят подписанные кнопки, а нажатие без
    // опознавательных знаков — та же скрытая функция, от которой мы уходим
    const preview = h('div', {
      class: 'tile', style: { aspectRatio: '1', maxWidth: '190px', margin: '0 auto 10px', background: bgCss(item.bg) }
    }, h('img', { src: urlFor(img) }));

    async function applyPhoto(blob) {
      img = blob;
      preview.querySelector('img').src = urlFor(blob);
      // строка молчит до тех пор, пока терять нечего: предупреждать заранее
      // значит показывать её тем, кто ещё передумает, — а к частому
      // предупреждению привыкают и перестают читать
      warnEl.hidden = isNew;
      try {
        colors = extractPalette(await imageFromBlob(blob), 5);
        // подсказки для новых цветов палитры берём уже с нового снимка
        suggest.splice(0, suggest.length, ...colors.map(c => c.hex));
      } catch (e) { console.warn(e); }
    }

    /**
     * Правка снимка и его замена разведены по двум кнопкам, хотя обе ведут
     * в один редактор. Правят почти всегда, заменяют изредка — а спрятанное
     * в списке частое действие стоит лишнего нажатия каждый раз.
     */
    async function editCurrent() {
      const blob = await openImageEditor(img, { autoAI: false });
      if (blob) await applyPhoto(blob);
    }

    async function replacePhoto() {
      const act = await actionSheet('Заменить снимок', [
        // «фото» в нашем словаре означает камеру, поэтому называть её
        // отдельно незачем — и «новое» не нужно: что это замена, сказано
        // в заголовке списка
        { id: 'cam', icon: '📸', label: 'Сфотографировать' },
        { id: 'file', icon: '🖼', label: 'Выбрать из галереи' }
      ]);
      if (!act) return;
      const src = act === 'cam' ? await captureFromCamera() : await pickImageFile();
      if (!src) return;
      // новый снимок проходит тот же путь, что и при добавлении вещи:
      // та же обрезка и то же удаление фона
      const blob = await openImageEditor(src, { autoAI: true });
      if (blob) await applyPhoto(blob);
    }

    // прежний снимок нигде не сохраняется, поэтому «Сохранить» здесь —
    // точка невозврата. Про «Отмену» говорим прямо: сама по себе она
    // не выглядит спасением
    const warnEl = h('p', { class: 'warn-line', hidden: true, style: { margin: '-6px 0 14px' } },
      'Прежний снимок будет заменён. Отмена вернёт его.');

    const photoBtns = h('div', { class: 'photo-btns' },
      h('button', { class: 'btn block', onclick: editCurrent }, '✎ Редактировать текущий снимок'),
      // рамка та же: без неё кнопка читается как подпись. Второстепенность
      // показываем цветом текста, а не отсутствием очертаний
      h('button', { class: 'btn block sub', onclick: replacePhoto }, 'Заменить снимок')
    );

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

    const priceInput = h('input', {
      type: 'number', min: '0', step: '1', inputmode: 'numeric',
      placeholder: 'не указана', value: item.price?.value ?? ''
    });
    const curInput = h('input', {
      type: 'text', class: 'cur', maxlength: '4', value: item.price?.cur || lastCurrency()
    });
    const noteInput = h('textarea', { rows: '3', placeholder: 'не заполнен' }, item.note || '');

    const modal = openModal({
      title: isNew ? 'Новая вещь' : 'Редактировать',
      body: h('div', {},
        preview, photoBtns, warnEl,
        h('div', { class: 'section-title' }, 'Фон карточки'), bgRow,
        h('label', { class: 'field' }, h('span', {}, 'Категория'), catSel),
        h('label', { class: 'field' }, h('span', {}, 'Подкатегория'), subSel),
        listField('Производитель', 'brands', () => brandId, v => { brandId = v; }, 'не указан'),
        colorsGroup(colorIds, suggest),
        compositionGroup('Состав', mat.main),
        compositionGroup('Подкладка', mat.lining),
        h('label', { class: 'field' }, h('span', {}, 'Цена'),
          h('div', { class: 'row' }, priceInput, curInput)),
        h('label', { class: 'field' }, h('span', {}, 'Комментарий'), noteInput)
      ),
      foot: [
        h('button', { class: 'btn', onclick: () => modal.close() }, 'Отмена'),
        h('button', {
          class: 'btn primary', onclick: async () => {
            item.catId = catSel.value || null;
            item.subId = subSel.value || null;
            // значение списка могли удалить, пока форма была открыта
            const alive = (key, id) => (listEntry(key, id) ? id : null);
            item.brandId = alive('brands', brandId);
            item.colorIds = colorIds.filter(id => alive('colors', id));
            item.material = {
              main: mat.main.filter(p => alive('materials', p.id)),
              lining: mat.lining.filter(p => alive('materials', p.id))
            };
            const price = parseFloat(priceInput.value);
            item.price = Number.isFinite(price)
              ? { value: price, cur: curInput.value.trim() || lastCurrency() }
              : null;
            item.note = noteInput.value.trim();
            item.img = img;
            item.colors = colors;
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
/**
 * Карточка — отдельный экран, а не окно: открывают её ради фотографии,
 * а в окне фотография ужата полями. Возврат — тем же «‹» в верхней панели,
 * что и во всём гардеробе.
 */
// у какой вещи развёрнут нижний блок; при открытии карточки — ни у какой
let cardOpen = null;

export function openItemCard(item) {
  nav.itemId = item.id;
  cardOpen = null;
  emit();
}

const closeCard = () => { nav.itemId = null; cardOpen = null; emit(); };

/** Подпись вещи: производитель, а если его нет — категория. */
export const itemLabel = item =>
  entryName('brands', item.brandId) || catById(item.catId)?.name || 'Вещь';

const composition = parts => (parts || [])
  .map(p => entryName('materials', p.id) + (p.pct ? ` ${p.pct}%` : ''))
  .filter(Boolean).join(' · ');

/** Строка подробностей: пустую не прячем — она напоминает, что не заполнена. */
const detail = (label, value, empty = 'не указано') => h('div', { class: 'detail' },
  h('span', { class: 'k' }, label),
  h('span', { class: value ? 'v' : 'v muted' }, value || empty));

function renderItemCard(root, item) {
  const place = [catById(item.catId)?.name, subById(item.catId, item.subId)?.name]
    .filter(Boolean).join(' › ') || 'Без категории';
  const worn = wearCount(item.id);
  const open = cardOpen === item.id;

  fill(root,
    h('div', { class: 'card-photo', style: { background: bgCss(item.bg) } },
      h('img', { src: urlFor(item.img), alt: itemLabel(item) })),

    h('div', { class: 'lrow' },
      h('div', { class: 't' },
        h('b', { class: item.brandId ? '' : 'muted' },
          entryName('brands', item.brandId) || 'производитель не указан'),
        h('span', {}, place)),
      h('span', { class: 'worn' }, worn ? plural(worn, 'надевание', 'надевания', 'надеваний') : 'ещё не надето')
    ),

    // цена — цифра, которую не всегда хочется видеть, поэтому блок всегда
    // открывается свёрнутым и своё состояние не запоминает
    h('button', {
      class: 'btn block more' + (open ? ' on' : ''),
      onclick: () => { cardOpen = open ? null : item.id; emit(); }
    }, open ? 'Свернуть ⌃' : 'Подробнее ⌄'),

    open ? h('div', { class: 'card-details' },
      h('div', { class: 'detail' },
        h('span', { class: 'k' }, 'Цвета'),
        (item.colorIds || []).length
          ? h('span', { class: 'v chips' }, (item.colorIds || []).map(id => {
            const c = listEntry('colors', id);
            return c ? h('span', {
              class: 'chip', onclick: () => {
                // архивная вещь ведёт в архив, гардеробная — в гардероб
                const arc = !!item.archived;
                filters(arc).color = c.id;
                nav.itemId = null; nav.archive = arc; nav.catId = null; nav.subId = null; nav.all = true;
                emit();
              }
            }, h('span', { class: 'dot', style: { background: c.hex } }), c.name) : null;
          }))
          : h('span', { class: 'v muted' }, 'не указаны')),
      detail('Состав', composition(item.material?.main), 'не указан'),
      // подкладка и комментарий — дополнительные: пустыми не показываются,
      // напоминать о них незачем. В форме поля на месте
      composition(item.material?.lining)
        ? detail('Подкладка', composition(item.material.lining)) : null,
      detail('Цена', item.price ? `${item.price.value} ${item.price.cur}` : '', 'не указана'),
      item.note ? detail('Комментарий', item.note) : null
    ) : null,

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
      // удаление убрано из ряда: необратимая кнопка не должна стоять вплотную
      // к безобидной. Там же, где у поездок и категорий, — в «⋯»
      h('button', {
        class: 'btn', title: 'Ещё', onclick: async () => {
          // в заголовке — марка, если она есть: itemLabel подставил бы
          // название категории, а «Сортировка» над кнопкой «Удалить вещь»
          // читается как удаление раздела
          const act = await actionSheet(entryName('brands', item.brandId) || 'Вещь', [
            { id: 'del', icon: '🗑', label: 'Удалить вещь', danger: true }
          ]);
          if (act === 'del') await removeItemFlow(item);
        }
      }, '⋯')
    )
  );
  root.style.paddingBottom = '';
}

/* ---------- фильтрация ---------- */
export function filteredItems(arc = nav.archive) {
  const f = filters(arc);
  let list = arc ? archivedItems() : closetItems();
  if (f.favOnly) list = list.filter(i => i.fav);
  if (f.color === NONE) list = list.filter(i => !(i.colorIds || []).length);
  else if (f.color) list = list.filter(i => (i.colorIds || []).includes(f.color));
  if (f.brand === NONE) list = list.filter(i => !i.brandId);
  else if (f.brand) list = list.filter(i => i.brandId === f.brand);
  // по основному составу и без оглядки на проценты: ищут «что у меня
  // шерстяного», а не «шерсть ровно восемьдесят»
  if (f.material === NONE) list = list.filter(i => !(i.material?.main || []).length);
  else if (f.material) {
    list = list.filter(i => (i.material?.main || []).some(p => p.id === f.material));
  }
  return list.sort(f.sort === 'old'
    ? (a, b) => a.createdAt - b.createdAt
    : (a, b) => b.createdAt - a.createdAt);
}

/* ---------- палитра гардероба ---------- */


/* ---------- менеджер категорий ---------- */
/** Один и тот же менеджер обслуживает гардероб и архив — разница только в scope. */
/**
 * Два пространства «Гардероба» для общего механизма категорий: сам гардероб
 * и архив вещей. Третье — образы — описано в своей вкладке.
 */
const space = arc => ({
  scope: arc ? SCOPE_ARCHIVE : SCOPE_CLOSET,
  title: arc ? 'Категории архива' : 'Категории',
  cats: () => arc ? archiveCats() : closetCats().filter(c => !c.system),
  n: nItems,
  thumb: c => thumbOf(latestIn(c.id, null, arc)),
  countSub: (cat, subId) => (arc ? archivedItems() : visibleItems())
    .filter(i => (arc ? i.arcSubId : i.subId) === subId).length,
  detachSub: async subId => {
    const touched = state.items.filter(i => (arc ? i.arcSubId : i.subId) === subId);
    touched.forEach(i => { arc ? (i.arcSubId = null) : (i.subId = null); });
    await saveItems(touched);
  },
  moveHint: 'Откройте её, нажмите «Выбрать» и переместите вещи — '
    + 'после этого категорию можно будет удалить.'
});

export const openClosetCats = (scope = SCOPE_CLOSET) => openCategoryManager(space(scope === SCOPE_ARCHIVE));

/* ---------- навигация ---------- */
/**
 * Гардероб устроен как папки: список категорий → подкатегории → вещи.
 * nav.catId пуст — показываем категории; есть категория без подкатегории —
 * её подкатегории (или сразу вещи, если подкатегорий нет); есть обе — вещи.
 * nav.all — плоский список всех вещей с фильтрами по цвету и избранному.
 * nav.archive — то же дерево, но по архивным вещам и архивным категориям.
 */
export const OTHER = '__other';
// отдельное значение фильтра: вещи, у которых это поле не заполнено
export const NONE = '__none';
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
    if (it) return { title: itemLabel(it), back: closeCard };
  }
  if (nav.all) return nav.archive
    ? { title: 'Весь архив', back: goArchive }
    : { title: 'Все вещи', back: goRoot };
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
        onclick: () => openSubManager(space(nav.archive), cat, emit)
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

export function navRow({ thumb, thumbNode, title, note, muted, onclick }) {
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
/** Мозаика из четырёх последних. pic — где лежит картинка: у вещи это img,
 *  у образа preview, поэтому источник передаётся снаружи. */
export function collageThumb(list, pic = it => it.img) {
  const four = list.slice(0, 4);
  if (!four.length) return h('div', { class: 'thumb ph' });
  return h('div', { class: 'thumb grid4' },
    four.map(it => h('img', { src: urlFor(pic(it)), style: { background: bgCss(it.bg) } })));
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

  // «Сортировка», «На рассмотрении» и архив — рабочие полки, а не гардероб.
  // Они закреплены внизу: при листании категорий их место не меняется.
  // Архив показывается всегда, даже пустой: это часть устройства гардероба,
  // а не следствие того, что в нём что-то лежит. Полка, появляющаяся только
  // после первой архивации, читается как пропажа — и о самой возможности
  // убрать вещь, не удаляя, узнать неоткуда.
  const bars = [
    ...system.map(c => serviceBar({
      icon: c.icon, title: c.name, count: countInCat(c.id), onclick: () => openCat(c.id)
    })),
    serviceBar({ icon: '📦', title: 'Архив вещей', count: archived, onclick: goArchive })
  ];
  const barsH = bars.length * SERVICE_BAR_H + 1;

  fill(root,
    h('div', { class: 'list' },
      navRow({
        thumbNode: collageThumb(closetItems()), title: 'Все вещи',
        note: nItems(closetItems().length),
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
      class: 'btn block ghost', style: { marginTop: '14px' }, onclick: () => openClosetCats()
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
      // как «Все вещи» в гардеробе: плоский список с фильтрами,
      // чтобы вещь находилась и тогда, когда забыто, в какой она категории
      navRow({
        thumbNode: collageThumb(archivedItems()), title: 'Весь архив',
        note: nItems(archivedItems().length),
        onclick: () => { nav.all = true; emit(); }
      }),
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

    // кнопка видна и в пустом архиве: иначе завести категории можно было бы
    // только после первой архивации — то есть ровно тогда, когда выбирать
    // уже поздно, вещь просит место прямо сейчас
    h('button', {
      class: 'btn block ghost', style: { marginTop: '14px' },
      onclick: () => openClosetCats(SCOPE_ARCHIVE)
    }, '⚙️ Категории архива')
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
    h('img', { src: urlFor(it.img), alt: itemLabel(it) }),
    it.fav && !selectable ? h('span', { class: 'fav' }, '★') : null,
    selectable ? h('span', { class: 'check' + (picked ? ' on' : '') }, picked ? '✓' : '') : null,
    it.brandId ? h('span', { class: 'lbl' }, entryName('brands', it.brandId)) : null
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

/**
 * «Все вещи»: единственное место с фильтрами. Все они устроены одинаково —
 * именованный чип открывает тот же список, что и в карточке, выбранное
 * написано прямо в чипе. Сортировка стоит отдельно и только сортирует:
 * «по производителю» ничего не находит, а лишь расставляет по алфавиту.
 */
function renderAll(root) {
  const arc = nav.archive;
  const f = filters(arc);
  const list = filteredItems(arc);
  const pool = arc ? archivedItems() : closetItems();
  const set = (field, v) => { f[field] = v; emit(); };

  // «без …» показываем, только когда такие вещи есть: иначе это пустая строка
  const blanks = {
    color: pool.filter(i => !(i.colorIds || []).length).length,
    brand: pool.filter(i => !i.brandId).length,
    material: pool.filter(i => !(i.material?.main || []).length).length
  };

  const filterChip = (label, field, key, noneLabel) => {
    const id = f[field];
    const name = id === NONE ? noneLabel.toLowerCase() : id ? entryName(key, id) : null;
    return h('button', {
      class: 'chip' + (name ? ' active' : ''),
      onclick: async () => {
        const v = await openListPicker(key, {
          selected: id, title: label,
          first: blanks[field] ? { id: NONE, name: noneLabel } : null
        });
        if (v !== null) set(field, v || null);
      }
    },
      id && id !== NONE && key === 'colors'
        ? h('span', { class: 'dot', style: { background: listEntry('colors', id)?.hex } }) : null,
      name ? `${label}: ${name}` : label,
      name ? h('span', {
        class: 'x', onclick: e => { e.stopPropagation(); set(field, null); }
      }, '✕') : null
    );
  };

  const filterRow = h('div', { class: 'chips filters' },
    filterChip('Цвет', 'color', 'colors', 'Без цвета'),
    filterChip('Производитель', 'brand', 'brands', 'Без производителя'),
    filterChip('Материал', 'material', 'materials', 'Без материала'),
    h('button', {
      class: 'chip' + (f.favOnly ? ' active' : ''),
      onclick: () => set('favOnly', !f.favOnly)
    }, '★ Избранное')
  );

  const controls = h('div', { class: 'row', style: { margin: '6px 0 4px' } },
    h('span', { class: 'small muted spacer' }, nItems(list.length)),
    h('select', {
      style: { width: 'auto', padding: '5px 8px', fontSize: '12px' },
      onchange: e => set('sort', e.target.value)
    },
      [['new', 'Сначала новые'], ['old', 'Сначала старые']]
        .map(([v, t]) => h('option', { value: v, selected: f.sort === v }, t)))
  );

  fill(root, filterRow, controls,
    list.length ? h('div', { class: 'grid' }, list.map(it => itemTile(it))) : h('div', { class: 'empty' },
      h('div', { class: 'big' }, arc ? '📦' : '🧺'),
      h('p', {}, pool.length
        ? 'Ничего не найдено по фильтрам'
        : arc
          ? 'Архив пуст.'
          : 'Гардероб пуст. Чтобы добавить вещи, нажмите «+» внизу справа.')),
    arc ? null : h('button', { class: 'fab', onclick: startAddItem, title: 'Добавить вещь' }, '+')
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
