// Универсальный выбор вещей / образов (для образов, календаря, чемодана).
import { fill, h, openModal, urlFor } from './ui.js';
import { state, catById } from './state.js';
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
        ...state.cats.filter(c => state.items.some(i => i.catId === c.id)).map(c =>
          h('button', {
            class: 'chip' + (catId === c.id ? ' active' : ''),
            onclick: () => { catId = c.id; renderChips(); renderGrid(); }
          }, `${c.icon || ''} ${c.name}`))
      );
    }
    function renderGrid() {
      const list = state.items.filter(i => !catId || i.catId === catId);
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

export function pickOutfits({ title = 'Выбрать образы', selected = [], multi = true } = {}) {
  return new Promise(res => {
    let sel = new Set(selected);
    let done = false;
    const grid = h('div', { class: 'grid g2' });
    function renderGrid() {
      fill(grid, ...state.outfits.map(o => h('div', {
        class: 'tile' + (sel.has(o.id) ? ' sel' : ''),
        onclick: () => {
          if (multi) { sel.has(o.id) ? sel.delete(o.id) : sel.add(o.id); renderGrid(); }
          else { done = true; modal.close(); res([o.id]); }
        }
      }, h('img', { src: urlFor(o.preview) }), h('span', { class: 'lbl' }, o.name || 'Образ'))));
      if (!state.outfits.length) fill(grid, h('div', { class: 'empty' }, 'Образов пока нет'));
    }
    renderGrid();
    const modal = openModal({
      title, full: true, body: grid,
      foot: multi ? [
        h('button', { class: 'btn', onclick: () => modal.close() }, 'Отмена'),
        h('button', { class: 'btn primary', onclick: () => { done = true; modal.close(); res([...sel]); } }, 'Готово')
      ] : null,
      onClose: () => { if (!done) res(null); }
    });
  });
}
