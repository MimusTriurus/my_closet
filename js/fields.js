// Списочные поля карточки: выбор значения, пополнение и правка списка.
// Список настраивается там же, где используется, — отдельного места для
// справочников нет, как и у подкатегорий.
import { fill, h, openModal, actionSheet, promptDialog, alertDialog, nItems } from './ui.js';
import { colorDist } from './color.js';
import { scanColorFromCamera } from './capture.js';
import {
  LIST_DEFS, listItems, listEntry, listUsage,
  addListEntry, updateListEntry, deleteListEntry
} from './state.js';

const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Ближайший цвет палитры к снятому оттенку: камера выбирает, а не заводит. */
export function nearestColor(hex) {
  let best = null, bd = 1e9;
  for (const c of listItems('colors')) {
    if (!c.hex) continue;
    const d = colorDist(hex, c.hex);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

/**
 * Новый цвет: название и оттенок. Оттенки с фотографии предлагаются
 * подсказкой — чтобы шартрез завёлся тем самым цветом, что на юбке,
 * а не подобранным на глаз.
 */
function createColor(suggest) {
  return new Promise(res => {
    let done = false;
    const nameInput = h('input', { type: 'text', placeholder: 'Например, шартрез' });
    const hexInput = h('input', { type: 'color', class: 'hex', value: suggest[0] || '#8a9a5b' });
    const row = h('div', { class: 'palette-row' }, suggest.map((hex, i) => h('button', {
      class: 'swatch' + (i === 0 ? ' sel' : ''), style: { background: hex }, title: 'Цвет со снимка',
      onclick: e => {
        hexInput.value = hex;
        [...row.children].forEach(x => x.classList.remove('sel'));
        e.currentTarget.classList.add('sel');
      }
    })));
    const modal = openModal({
      title: 'Новый цвет',
      body: h('div', {},
        suggest.length ? h('div', { class: 'section-title' }, 'Со снимка') : null,
        suggest.length ? row : null,
        h('label', { class: 'field' }, h('span', {}, 'Оттенок'), hexInput),
        h('label', { class: 'field' }, h('span', {}, 'Название'), nameInput)),
      foot: [
        h('button', { class: 'btn', onclick: () => modal.close() }, 'Отмена'),
        h('button', {
          class: 'btn primary', onclick: () => {
            const name = nameInput.value.trim();
            if (!name) return nameInput.focus();
            done = true;
            res({ name, hex: hexInput.value });
            modal.close();
          }
        }, 'Добавить')
      ],
      onClose: () => { if (!done) res(null); }
    });
  });
}

/** Новое значение списка. Повтор не заводим — возвращаем то, что уже есть. */
async function createEntry(key, suggest = []) {
  const def = LIST_DEFS[key];
  const patch = key === 'colors'
    ? await createColor(suggest)
    : { name: (await promptDialog(def.add, '', 'Название') || '').trim() };
  if (!patch || !patch.name) return null;
  const twin = listItems(key).find(e => sameName(e.name, patch.name));
  if (twin) {
    await alertDialog(`«${twin.name}» в списке уже есть.`, 'Такое уже есть');
    return twin;
  }
  return addListEntry(key, patch);
}

/**
 * Удаление значения. Пустое уходит молча; то, на которое ссылаются вещи,
 * сначала предлагает перенос: вещь, потерявшая одну отметку из нескольких,
 * нигде потом не всплывёт.
 */
async function removeEntry(key, entry) {
  const n = listUsage(key, entry.id);
  if (!n) { await deleteListEntry(key, entry.id); return true; }

  const act = await actionSheet(`«${entry.name}» · ${nItems(n)}`, [
    { id: 'move', icon: '→', label: 'Перенести в другое значение' },
    { id: 'drop', label: 'Просто удалить отметку', muted: true }
  ]);
  if (act === 'drop') { await deleteListEntry(key, entry.id, null); return true; }
  if (act !== 'move') return false;

  const dest = await openListPicker(key, {
    title: `Перенести «${entry.name}» в…`, exclude: [entry.id], manage: false
  });
  if (!dest) return false;
  await deleteListEntry(key, entry.id, dest);
  return true;
}

/**
 * Окно выбора значения. single: нажатие на строку и есть выбор.
 * multi: строки отмечаются, результат отдаётся по «Готово».
 * Возвращает id (single), массив id (multi), '' — снять значение, null — отмена.
 */
export function openListPicker(key, {
  selected = null, multi = false, exclude = [], title = null, manage = true, suggest = [],
  first = null
} = {}) {
  const def = LIST_DEFS[key];
  return new Promise(res => {
    let done = false;
    const picked = new Set(multi ? (selected || []) : []);
    const finish = v => { done = true; res(v); modal.close(); };

    const body = h('div', {});
    const modal = openModal({
      title: title || def.title,
      body,
      foot: multi
        ? [h('button', { class: 'btn primary', onclick: () => finish([...picked]) }, 'Готово')]
        : (selected && !exclude.length
          ? [h('button', { class: 'btn', onclick: () => finish('') }, 'Убрать значение')]
          : null),
      onClose: () => { if (!done) res(null); }
    });

    function render() {
      const list = listItems(key).filter(e => !exclude.includes(e.id));
      fill(body,
        h('div', { class: 'list' },
          // особое значение фильтра — «без цвета» и ему подобные
          first ? h('div', {
            class: 'lrow' + (first.id === selected ? ' on' : ''),
            onclick: () => finish(first.id)
          }, h('div', { class: 't' }, h('b', { class: 'muted' }, first.name))) : null,
          list.map(e => {
            const on = multi ? picked.has(e.id) : e.id === selected;
            return h('div', {
              class: 'lrow' + (on ? ' on' : ''),
              onclick: () => {
                if (!multi) return finish(e.id);
                picked.has(e.id) ? picked.delete(e.id) : picked.add(e.id);
                render();
              }
            },
              e.hex ? h('span', { class: 'dot', style: { background: e.hex } }) : null,
              h('div', { class: 't' }, h('b', {}, e.name)),
              on ? h('span', { class: 'tick' }, '✓') : null,
              manage ? h('button', {
                class: 'icon-btn', title: 'Изменить',
                onclick: async ev => {
                  ev.stopPropagation();
                  const act = await actionSheet(e.name, [
                    { id: 'ren', icon: '✎', label: 'Переименовать' },
                    ...(e.hex ? [{ id: 'hue', icon: '🎨', label: 'Изменить оттенок' }] : []),
                    { id: 'del', icon: '🗑', label: 'Удалить из списка', danger: true }
                  ]);
                  if (act === 'ren') {
                    const n = await promptDialog('Переименовать', e.name);
                    if (n && !sameName(n, e.name)) await updateListEntry(key, e.id, { name: n.trim() });
                  } else if (act === 'hue') {
                    const hex = await pickHue(e);
                    if (hex) await updateListEntry(key, e.id, { hex });
                  } else if (act === 'del') {
                    if (await removeEntry(key, e)) picked.delete(e.id);
                  }
                  render();
                }
              }, '⋯') : null
            );
          }),
          list.length ? null : h('p', { class: 'muted small' }, 'Список пуст.')
        ),
        manage ? h('button', {
          class: 'btn block btn-add', style: { marginTop: '10px' },
          onclick: async () => {
            const e = await createEntry(key, suggest);
            if (!e) return render();
            if (multi) { picked.add(e.id); render(); } else finish(e.id);
          }
        }, '+ ' + def.add) : null,
        // камера подбирает ближайший цвет палитры — заводить новый она не должна
        key === 'colors' ? h('button', {
          class: 'btn block', style: { marginTop: '6px' },
          onclick: async () => {
            const hex = await scanColorFromCamera();
            const near = hex && nearestColor(hex);
            if (!near) return;
            if (multi) { picked.add(near.id); render(); } else finish(near.id);
          }
        }, '📷 Подобрать камерой') : null
      );
    }
    render();
  });
}

/** Смена оттенка существующего цвета: вещи хранят ссылку, правка общая. */
function pickHue(entry) {
  return new Promise(res => {
    let done = false;
    const input = h('input', { type: 'color', class: 'hex', value: entry.hex || '#808080' });
    const modal = openModal({
      title: entry.name,
      body: h('label', { class: 'field' }, h('span', {}, 'Оттенок'), input),
      foot: [
        h('button', { class: 'btn', onclick: () => modal.close() }, 'Отмена'),
        h('button', {
          class: 'btn primary',
          onclick: () => { done = true; res(input.value); modal.close(); }
        }, 'Сохранить')
      ],
      onClose: () => { if (!done) res(null); }
    });
  });
}

/** Подпись значения для карточки: пусто — приглушённое «не указано». */
export const entryName = (key, id) => listEntry(key, id)?.name || '';
