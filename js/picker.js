// Универсальный выбор вещей / образов (для образов, календаря, чемодана).
import { fill, h, openModal, urlFor } from './ui.js';
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
 * Выбор образов. Список плоским быть не может: у образов есть категории
 * и подкатегории, и когда их станет много, нужный придётся искать глазами.
 * Поэтому над сеткой — те же папки, но строками фильтров, а не переходами:
 * внутри окна выбора некуда ставить «назад».
 */
const NO_CAT = '__nocat';
const NO_SUB = '__nosub';

export function pickOutfits({ title = 'Выбрать образы', selected = [], multi = true } = {}) {
  return new Promise(res => {
    let sel = new Set(selected);
    let catId = null, subId = null;
    let done = false;

    const grid = h('div', { class: 'grid g2' });
    const chips = h('div', { class: 'chips' });
    const subChips = h('div', { class: 'chips' });

    const inCat = id => state.outfits.filter(o => (o.catId || null) === (id === NO_CAT ? null : id));

    function renderChips() {
      const cats = outfitCats().filter(c => inCat(c.id).length);
      const loose = inCat(NO_CAT).length;
      const pick = id => { catId = id; subId = null; renderAll(); };

      fill(chips,
        h('button', { class: 'chip' + (!catId ? ' active' : ''), onclick: () => pick(null) }, 'Все'),
        ...cats.map(c => h('button', {
          class: 'chip' + (catId === c.id ? ' active' : ''), onclick: () => pick(c.id)
        }, c.name, h('span', { class: 'cnt' }, inCat(c.id).length))),
        loose ? h('button', {
          class: 'chip' + (catId === NO_CAT ? ' active' : ''), onclick: () => pick(NO_CAT)
        }, 'Без категории', h('span', { class: 'cnt' }, loose)) : null
      );

      // вторая строка — только там, где подкатегории есть и в них что-то лежит
      const cat = catId && catId !== NO_CAT ? outfitCats().find(c => c.id === catId) : null;
      const subs = (cat?.subs || []).filter(sb => inCat(cat.id).some(o => o.subId === sb.id));
      const sublessN = cat ? inCat(cat.id).filter(o => !subs.some(sb => sb.id === o.subId)).length : 0;
      subChips.hidden = !subs.length;
      if (!subs.length) return;

      const pickSub = id => { subId = id; renderAll(); };
      fill(subChips,
        h('button', { class: 'chip' + (!subId ? ' active' : ''), onclick: () => pickSub(null) }, 'Вся категория'),
        ...subs.map(sb => h('button', {
          class: 'chip' + (subId === sb.id ? ' active' : ''), onclick: () => pickSub(sb.id)
        }, sb.name)),
        sublessN ? h('button', {
          class: 'chip' + (subId === NO_SUB ? ' active' : ''), onclick: () => pickSub(NO_SUB)
        }, 'Другое', h('span', { class: 'cnt' }, sublessN)) : null
      );
    }

    function renderGrid() {
      const cat = catId && catId !== NO_CAT ? outfitCats().find(c => c.id === catId) : null;
      const subIds = new Set((cat?.subs || []).map(sb => sb.id));
      const list = state.outfits.filter(o => {
        if (catId && (o.catId || null) !== (catId === NO_CAT ? null : catId)) return false;
        if (!subId) return true;
        const own = subIds.has(o.subId) ? o.subId : null;
        return subId === NO_SUB ? !own : own === subId;
      });

      fill(grid, ...list.map(o => {
        // метка видна до выбора — предупреждение потом лишь подстраховывает
        const gone = archivedInOutfit(o).length;
        return h('div', {
          class: 'tile' + (sel.has(o.id) ? ' sel' : '') + (gone ? ' has-gone' : ''),
          onclick: () => {
            if (multi) { sel.has(o.id) ? sel.delete(o.id) : sel.add(o.id); renderGrid(); }
            else { done = true; modal.close(); res([o.id]); }
          }
        },
          h('img', { src: urlFor(o.preview) }),
          gone ? h('span', { class: 'gone-mark', title: 'В образе есть вещь из архива' }, '◷') : null,
          h('span', { class: 'lbl' }, o.name || 'Образ'));
      }));
      if (!list.length) fill(grid, h('div', { class: 'empty' }, 'Здесь пусто'));
    }

    const renderAll = () => { renderChips(); renderGrid(); };
    renderAll();

    const modal = openModal({
      title, full: true,
      body: h('div', {}, chips, subChips, grid),
      foot: multi ? [
        h('button', { class: 'btn', onclick: () => modal.close() }, 'Отмена'),
        h('button', { class: 'btn primary', onclick: () => { done = true; modal.close(); res([...sel]); } }, 'Готово')
      ] : null,
      onClose: () => { if (!done) res(null); }
    });
  });
}
