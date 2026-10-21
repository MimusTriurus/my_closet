// Универсальный выбор вещей / образов (для образов, календаря, чемодана).
import { fill, h, openModal, urlFor, nOutfits } from './ui.js';
import { state, catById, visibleItems, closetCats, outfitCats, archivedInOutfit } from './state.js';
import { bgCss } from './bgs.js';

export function pickItems({ title = 'Выбрать вещи', selected = [], multi = true } = {}) {
  return new Promise(res => {
    let sel = new Set(selected);
    let catId = null;
    let done = false;

    const grid = h('div', { class: 'grid' });
    const chips = h('div', { class: 'chips' });

    function renderChips() {
      fill(chips, 
        h('button', { class: 'chip' + (!catId ? ' active' : ''), onclick: () => { catId = null; renderChips(); renderGrid(); } }, 'Все'),
        ...closetCats().filter(c => visibleItems().some(i => i.catId === c.id)).map(c =>
          h('button', {
            class: 'chip' + (catId === c.id ? ' active' : ''),
            onclick: () => { catId = c.id; renderChips(); renderGrid(); }
          }, `${c.icon || ''} ${c.name}`))
      );
    }
    function renderGrid() {
      const list = visibleItems().filter(i => !catId || i.catId === catId);
      fill(grid, ...list.map(it => h('div', {
        class: 'tile' + (sel.has(it.id) ? ' sel' : ''),
        style: { background: bgCss(it.bg) },
        onclick: () => {
          if (multi) { sel.has(it.id) ? sel.delete(it.id) : sel.add(it.id); renderGrid(); }
          else { done = true; modal.close(); res([it.id]); }
        }
      }, h('img', { src: urlFor(it.img) }))));
      if (!list.length) fill(grid, h('div', { class: 'empty' }, 'Нет вещей'));
    }
    renderChips(); renderGrid();

    const modal = openModal({
      title, full: true,
      body: h('div', {}, chips, grid),
      foot: multi ? [
        h('button', { class: 'btn', onclick: () => modal.close() }, 'Отмена'),
        h('button', { class: 'btn primary', onclick: () => { done = true; modal.close(); res([...sel]); } }, 'Готово')
      ] : null,
      onClose: () => { if (!done) res(null); }
    });
  });
}

/**
 * Выбор образов. Устроен как вкладка: категория → подкатегория → образы,
 * с возвратом строкой «‹ назад» в самом списке. Строками фильтров это быть
 * не может — когда категорий станет много, горизонтальный ряд перестанет
 * помещаться, ровно как было в «Гардеробе» до перехода на папки.
 *
 * multi = false (календарь): нажатие на образ и есть выбор, «Готово» не нужно.
 * multi = true (чемодан): отмечаем несколько и подтверждаем.
 */
const NO_CAT = '__nocat';
const NO_SUB = '__nosub';

export function pickOutfits({ title = 'Выбрать образы', selected = [], multi = true } = {}) {
  return new Promise(res => {
    const sel = new Set(selected);
    let catId = null, subId = null;
    let done = false;

    const body = h('div', {});
    const titleEl = h('span', {}, title);

    const catOf = id => outfitCats().find(c => c.id === id) || null;
    const inCat = id => state.outfits.filter(o => (o.catId || null) === (id === NO_CAT ? null : id));
    const subsOf = cat => (cat?.subs || []).filter(sb => inCat(cat.id).some(o => o.subId === sb.id));

    function listed() {
      if (catId === null) return state.outfits;              // «Все образы»
      const cat = catOf(catId);
      const pool = inCat(catId);
      if (!subId) return pool;
      const own = new Set(subsOf(cat).map(sb => sb.id));
      return pool.filter(o => subId === NO_SUB ? !own.has(o.subId) : o.subId === subId);
    }

    const go = (c, sb = null) => { catId = c; subId = sb; render(); };

    const row = ({ label, note, onclick, muted, back }) => h('div', {
      class: 'lrow nav' + (muted ? ' soft' : ''), onclick
    },
      back ? h('span', { class: 'chev back' }, '‹') : null,
      h('div', { class: 't' }, h('b', {}, label), note ? h('span', {}, note) : null),
      back ? null : h('span', { class: 'chev' }, '›')
    );

    const tile = o => {
      const gone = archivedInOutfit(o).length;
      return h('div', {
        class: 'tile' + (sel.has(o.id) ? ' sel' : '') + (gone ? ' has-gone' : ''),
        onclick: () => {
          if (!multi) { done = true; modal.close(); return res([o.id]); }
          sel.has(o.id) ? sel.delete(o.id) : sel.add(o.id);
          render();
        }
      },
        h('img', { src: urlFor(o.preview) }),
        gone ? h('span', { class: 'gone-mark', title: 'В образе есть вещь из архива' }, '◷') : null,
        h('span', { class: 'lbl' }, o.name || 'Образ')
      );
    };

    function render() {
      const cats = outfitCats().filter(c => inCat(c.id).length);
      const loose = inCat(NO_CAT).length;

      // корень: папки. Без категорий показывать нечего — сразу сетка
      if (catId === null && cats.length) {
        titleEl.textContent = title;
        return fill(body,
          h('div', { class: 'list' },
            row({
              label: 'Все образы', note: nOutfits(state.outfits.length),
              onclick: () => { catId = '__all'; render(); }
            }),
            ...cats.map(c => row({
              label: c.name,
              note: nOutfits(inCat(c.id).length)
                + (subsOf(c).length ? ' · ' + subsOf(c).length + ' подкат.' : ''),
              onclick: () => go(c.id)
            })),
            loose ? row({
              label: 'Без категории', note: nOutfits(loose), muted: true,
              onclick: () => go(NO_CAT)
            }) : null
          )
        );
      }

      const cat = catOf(catId);
      const subs = cat ? subsOf(cat) : [];
      const sublessN = cat ? inCat(cat.id).filter(o => !subs.some(sb => sb.id === o.subId)).length : 0;
      titleEl.textContent = catId === '__all' ? 'Все образы'
        : catId === NO_CAT ? 'Без категории'
          : subId ? (subId === NO_SUB ? 'Другое' : subs.find(sb => sb.id === subId)?.name || cat.name)
            : cat?.name || title;

      // уровень подкатегорий — если они есть и мы ещё не внутри одной
      if (cat && subs.length && !subId) {
        return fill(body,
          h('div', { class: 'list' },
            row({ label: 'Категории', back: true, onclick: () => go(null) }),
            ...subs.map(sb => row({
              label: sb.name, note: nOutfits(inCat(cat.id).filter(o => o.subId === sb.id).length),
              onclick: () => go(cat.id, sb.id)
            })),
            sublessN ? row({
              label: 'Другое', note: nOutfits(sublessN), muted: true,
              onclick: () => go(cat.id, NO_SUB)
            }) : null
          )
        );
      }

      const list = catId === '__all' ? state.outfits : listed();
      const up = subId ? () => go(cat.id) : cats.length ? () => go(null) : null;
      fill(body,
        up ? h('div', { class: 'list' }, row({ label: 'Назад', back: true, onclick: up })) : null,
        list.length ? h('div', { class: 'grid g2' }, list.map(tile))
          : h('div', { class: 'empty' }, 'Здесь пусто')
      );
    }
    render();

    const modal = openModal({
      title: titleEl, full: true, body,
      foot: multi ? [
        h('button', { class: 'btn', onclick: () => modal.close() }, 'Отмена'),
        h('button', { class: 'btn primary', onclick: () => { done = true; modal.close(); res([...sel]); } }, 'Готово')
      ] : null,
      onClose: () => { if (!done) res(null); }
    });
  });
}
