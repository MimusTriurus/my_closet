// Универсальный выбор вещей / образов (для образов, календаря, чемодана).
import { fill, h, openModal, urlFor, nItems, nOutfits } from './ui.js';
import { state, visibleItems, closetCats, outfitCats, archivedInOutfit } from './state.js';
import { bgCss } from './bgs.js';

const NO_CAT = '__nocat';
const NO_SUB = '__nosub';
const ALL = '__all';

/** Строка-папка. Одна на оба выбора: вещи и образы ходят одинаково. */
const pickRow = ({ label, note, onclick, muted, back }) => h('div', {
  class: 'lrow nav' + (muted ? ' soft' : ''), onclick
},
  back ? h('span', { class: 'chev back' }, '\u2039') : null,
  h('div', { class: 't' }, h('b', {}, label), note ? h('span', {}, note) : null),
  back ? null : h('span', { class: 'chev' }, '\u203a')
);

/**
 * Выбор вещей: категория → подкатегория → сетка, как в «Гардеробе» и в
 * выборе образов. Рядом чипов это быть не может — когда категорий станет
 * много, горизонтальный ряд перестанет помещаться.
 *
 * Архивные вещи сюда не попадают: «Гардероб» — это то, что есть на руках.
 * Архивное приходит в поездку другим путём — из прошлой поездки или образа.
 */
export function pickItems({ title = 'Выбрать вещи', selected = [], multi = true, pool = null } = {}) {
  return new Promise(res => {
    // `pool` — уже отобранный набор (например, вещи нужного цвета). Папки
    // при этом остаются: искать глазами удобнее там, где привычно
    const all = () => pool || visibleItems();
    const sel = new Set(selected);
    // с готовым набором сразу показываем сетку: папок всегда больше, чем
    // отобранного, и ходить по пустым незачем. Вернуться к ним можно «‹»
    let catId = pool ? ALL : null, subId = null;
    let done = false;

    const body = h('div', {});
    const titleEl = h('span', {}, title);
    const doneBtn = h('button', {
      class: 'btn primary',
      onclick: () => { done = true; modal.close(); res([...sel]); }
    }, 'Готово');

    const catOf = id => closetCats().find(c => c.id === id) || null;
    const inCat = id => all().filter(i => (i.catId || null) === (id === NO_CAT ? null : id));
    const subsOf = cat => cat?.subs || [];

    function listed() {
      if (catId === ALL) return all();
      const cat = catOf(catId);
      const pool = inCat(catId);
      if (!subId) return pool;
      const own = new Set(subsOf(cat).map(sb => sb.id));
      return pool.filter(i => subId === NO_SUB ? !own.has(i.subId) : i.subId === subId);
    }

    const go = (c, sb = null) => { catId = c; subId = sb; render(); };

    const tile = it => h('div', {
      class: 'tile' + (sel.has(it.id) ? ' sel' : ''),
      style: { background: bgCss(it.bg) },
      onclick: () => {
        if (!multi) { done = true; modal.close(); return res([it.id]); }
        sel.has(it.id) ? sel.delete(it.id) : sel.add(it.id);
        render();
      }
    }, h('img', { src: urlFor(it.img) }));

    function render() {
      doneBtn.textContent = sel.size ? `Готово · ${sel.size}` : 'Готово';
      // пустые категории показываем: человек их завёл сам, и встреча с пустой
      // папкой — напоминание либо наполнить её, либо убрать. Прятать значило
      // бы показывать в «Гардеробе» одно, а в выборе другое, без объяснений
      const cats = closetCats();
      const loose = inCat(NO_CAT).length;

      // корень: папки. Категорий нет — показывать нечего, сразу сетка
      if (catId === null && cats.length) {
        titleEl.textContent = title;
        return fill(body,
          h('div', { class: 'list' },
            pickRow({
              label: 'Все вещи', note: nItems(all().length),
              onclick: () => go(ALL)
            }),
            ...cats.map(c => pickRow({
              label: `${c.icon || ''} ${c.name}`.trim(),
              note: nItems(inCat(c.id).length)
                + (subsOf(c).length ? ' · ' + subsOf(c).length + ' подкат.' : ''),
              onclick: () => go(c.id)
            })),
            loose ? pickRow({
              label: 'Без категории', note: nItems(loose), muted: true,
              onclick: () => go(NO_CAT)
            }) : null
          )
        );
      }

      const cat = catOf(catId);
      const subs = cat ? subsOf(cat) : [];
      const sublessN = cat ? inCat(cat.id).filter(i => !subs.some(sb => sb.id === i.subId)).length : 0;
      // с готовым набором «Все вещи» — неправда: их там не все, а отобранные.
      // Заголовок остаётся тем, с которым выбор открыли
      titleEl.textContent = catId === ALL ? (pool ? title : 'Все вещи')
        : catId === NO_CAT ? 'Без категории'
          : subId ? (subId === NO_SUB ? 'Другое' : subs.find(sb => sb.id === subId)?.name || cat.name)
            : cat?.name || title;

      if (cat && subs.length && !subId) {
        return fill(body,
          h('div', { class: 'list' },
            pickRow({ label: 'Категории', back: true, onclick: () => go(null) }),
            ...subs.map(sb => pickRow({
              label: sb.name, note: nItems(inCat(cat.id).filter(i => i.subId === sb.id).length),
              onclick: () => go(cat.id, sb.id)
            })),
            sublessN ? pickRow({
              label: 'Другое', note: nItems(sublessN), muted: true,
              onclick: () => go(cat.id, NO_SUB)
            }) : null
          )
        );
      }

      const list = listed();
      const up = subId ? () => go(cat.id) : cats.length ? () => go(null) : null;
      fill(body,
        up ? h('div', { class: 'list' }, pickRow({ label: 'Назад', back: true, onclick: up })) : null,
        list.length ? h('div', { class: 'grid' }, list.map(tile))
          : h('div', { class: 'empty' }, 'Здесь пусто')
      );
    }
    render();

    const modal = openModal({
      title: titleEl, full: true, body,
      foot: multi ? [
        h('button', { class: 'btn', onclick: () => modal.close() }, 'Отмена'),
        doneBtn
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
export function pickOutfits({ title = 'Выбрать образы', selected = [], multi = true } = {}) {
  return new Promise(res => {
    const sel = new Set(selected);
    let catId = null, subId = null;
    let done = false;

    const body = h('div', {});
    const titleEl = h('span', {}, title);

    const catOf = id => outfitCats().find(c => c.id === id) || null;
    const inCat = id => state.outfits.filter(o => (o.catId || null) === (id === NO_CAT ? null : id));
    const subsOf = cat => cat?.subs || [];

    function listed() {
      if (catId === null) return state.outfits;              // «Все образы»
      const cat = catOf(catId);
      const pool = inCat(catId);
      if (!subId) return pool;
      const own = new Set(subsOf(cat).map(sb => sb.id));
      return pool.filter(o => subId === NO_SUB ? !own.has(o.subId) : o.subId === subId);
    }

    const go = (c, sb = null) => { catId = c; subId = sb; render(); };

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
      const cats = outfitCats();   // в том числе пустые — см. pickItems
      const loose = inCat(NO_CAT).length;

      // корень: папки. Без категорий показывать нечего — сразу сетка
      if (catId === null && cats.length) {
        titleEl.textContent = title;
        return fill(body,
          h('div', { class: 'list' },
            pickRow({
              label: 'Все образы', note: nOutfits(state.outfits.length),
              onclick: () => { catId = ALL; render(); }
            }),
            ...cats.map(c => pickRow({
              label: c.name,
              note: nOutfits(inCat(c.id).length)
                + (subsOf(c).length ? ' · ' + subsOf(c).length + ' подкат.' : ''),
              onclick: () => go(c.id)
            })),
            loose ? pickRow({
              label: 'Без категории', note: nOutfits(loose), muted: true,
              onclick: () => go(NO_CAT)
            }) : null
          )
        );
      }

      const cat = catOf(catId);
      const subs = cat ? subsOf(cat) : [];
      const sublessN = cat ? inCat(cat.id).filter(o => !subs.some(sb => sb.id === o.subId)).length : 0;
      titleEl.textContent = catId === ALL ? 'Все образы'
        : catId === NO_CAT ? 'Без категории'
          : subId ? (subId === NO_SUB ? 'Другое' : subs.find(sb => sb.id === subId)?.name || cat.name)
            : cat?.name || title;

      // уровень подкатегорий — если они есть и мы ещё не внутри одной
      if (cat && subs.length && !subId) {
        return fill(body,
          h('div', { class: 'list' },
            pickRow({ label: 'Категории', back: true, onclick: () => go(null) }),
            ...subs.map(sb => pickRow({
              label: sb.name, note: nOutfits(inCat(cat.id).filter(o => o.subId === sb.id).length),
              onclick: () => go(cat.id, sb.id)
            })),
            sublessN ? pickRow({
              label: 'Другое', note: nOutfits(sublessN), muted: true,
              onclick: () => go(cat.id, NO_SUB)
            }) : null
          )
        );
      }

      const list = catId === ALL ? state.outfits : listed();
      const up = subId ? () => go(cat.id) : cats.length ? () => go(null) : null;
      fill(body,
        up ? h('div', { class: 'list' }, pickRow({ label: 'Назад', back: true, onclick: up })) : null,
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
