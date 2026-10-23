// DOM-хелперы, модалки, тосты, индикатор занятости.

export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

export function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, v);
  }
  for (const kid of kids.flat(3)) {
    if (kid == null || kid === false) continue;
    e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return e;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

/* ---------- перенос строк пальцем ----------
 * Браузерное drag-and-drop на сенсорном экране не работает, а готовых
 * библиотек у нас нет — считаем сами по событиям указателя.
 *
 * Тянется только ручка. Тянись вся строка — список перестал бы листаться:
 * движение пальцем вверх принималось бы за перенос, и спасаться пришлось бы
 * удержанием. Ручка не нужна ни для чего другого, поэтому и ждать нечего:
 * перенос начинается сразу.
 */
export const dragHandle = () =>
  h('div', { class: 'drag-h', title: 'Перетащите, чтобы переставить' });

/** Та же ручка, но внутри текста подсказки: показать её надёжнее, чем описать. */
export const dragMark = () => h('span', { class: 'drag-mark' });

// порог: палец никогда не стоит ровно, и без него каждое касание ручки
// считалось бы переносом
const DRAG_MIN = 5;
const EDGE = 44;   // ближе этого к краю окно начинает подкручиваться

const scrollParent = el => {
  for (let n = el; n; n = n.parentElement) {
    if (n.scrollHeight > n.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(n).overflowY)) return n;
  }
  return null;
};

/**
 * Делает строки `.lrow` внутри `container` переставляемыми за ручку.
 * `onDrop(from, to)` — номера среди строк: кнопки и пояснения рядом не в счёт.
 * Вешается один раз на контейнер и переживает любые перерисовки.
 */
export function dragReorder(container, onDrop) {
  container.addEventListener('pointerdown', e => {
    const handle = e.target.closest ? e.target.closest('.drag-h') : null;
    if (!handle || !container.contains(handle)) return;
    const row = handle.closest('.lrow');
    const rows = [...container.children].filter(n => n.classList.contains('lrow'));
    const from = rows.indexOf(row);
    if (from < 0) return;

    e.preventDefault();
    // захват указателя: без него палец, уехавший со строки, теряется.
    // Бывает и недоступен — тогда работаем без него
    try { handle.setPointerCapture(e.pointerId); } catch (_) { }

    // высоты меряем, а не считаем: на узком экране подпись переносится,
    // и строки выходят разной высоты
    const rects = rows.map(r => r.getBoundingClientRect());
    const gap = rows.length > 1 ? Math.max(0, rects[1].top - rects[0].bottom) : 0;
    const step = rects[from].height + gap;
    const sc = scrollParent(container);
    const scroll0 = sc ? sc.scrollTop : 0;
    const y0 = e.clientY;
    let moving = false, to = from, lastY = y0, edge = 0, raf = 0;

    // строку ведём сдвигом, соседей раздвигаем тем же сдвигом: так никто
    // не перерисовывается на каждое движение пальца
    const place = dy => {
      row.style.transform = 'translateY(' + dy + 'px)';
      const mid = rects[from].top + rects[from].height / 2 + dy;
      let next = from;
      for (let i = 0; i < rows.length; i++) {
        const c = rects[i].top + rects[i].height / 2;
        if (i < from && mid < c) { next = i; break; }
        if (i > from && mid > c) next = i;
      }
      to = next;
      rows.forEach((r, i) => {
        if (i === from) return;
        const shift = (i > from && i <= to) ? -step : (i < from && i >= to) ? step : 0;
        r.style.transform = shift ? 'translateY(' + shift + 'px)' : '';
      });
    };

    // мерки сняты один раз, поэтому прокрутку окна добавляем к сдвигу сами
    const drift = () => (sc ? sc.scrollTop - scroll0 : 0);

    const tick = () => {
      raf = 0;
      if (!edge || !moving || !sc) return;
      const was = sc.scrollTop;
      sc.scrollTop += edge * 10;
      if (sc.scrollTop !== was) place(lastY - y0 + drift());
      raf = requestAnimationFrame(tick);
    };

    const move = ev => {
      lastY = ev.clientY;
      const dy = lastY - y0 + drift();
      if (!moving) {
        if (Math.abs(dy) < DRAG_MIN) return;
        moving = true;
        row.classList.add('dragging');
        document.body.style.userSelect = 'none';
      }
      edge = 0;
      if (sc) {
        const r = sc.getBoundingClientRect();
        if (lastY < r.top + EDGE) edge = -1;
        else if (lastY > r.bottom - EDGE) edge = 1;
      }
      if (edge && !raf) raf = requestAnimationFrame(tick);
      place(dy);
    };

    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      if (raf) cancelAnimationFrame(raf);
      document.body.style.userSelect = '';
      row.classList.remove('dragging');
      rows.forEach(r => { r.style.transform = ''; });
      if (moving && to !== from) onDrop(from, to);
    };

    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  });
}

/* ---- blob URL кэш ---- */
const urlCache = new WeakMap();
export function urlFor(blob) {
  if (!blob) return '';
  if (typeof blob === 'string') return blob;
  let u = urlCache.get(blob);
  if (!u) { u = URL.createObjectURL(blob); urlCache.set(blob, u); }
  return u;
}

/* ---- тосты ---- */
/**
 * `action` — кнопка внутри всплывашки: {label, onclick}. Нужна там, где
 * действие совершилось молча и его хочется вернуть, пока помнишь о нём.
 * Живёт столько же, сколько сама всплывашка: предложение, а не вопрос.
 */
/* ---- переход на другую вкладку ----
 * Вкладки переключает app.js, но просить об этом может любой модуль —
 * например, «Образы», когда вещь из образа открывается карточкой в
 * «Гардеробе». Прямой импорт сделал бы круг (app → closet → app),
 * поэтому app регистрирует обработчик здесь.
 */
let tabHandler = null;
export const setTabHandler = fn => { tabHandler = fn; };
export const goTab = tab => tabHandler && tabHandler(tab);

export function toast(msg, ms = 2000, action = null) {
  const t = h('div', { class: 'toast' }, msg);
  if (action) {
    t.append(h('button', {
      class: 'toast-act',
      onclick: () => { t.remove(); action.onclick(); }
    }, action.label));
  }
  qs('#toast-root').append(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .25s'; }, ms - 250);
  setTimeout(() => t.remove(), ms);
}

/* ---- busy ---- */
export function busy(on, text = 'Обработка…') {
  const b = qs('#busy');
  qs('#busy-text').textContent = text;
  b.hidden = !on;
}

/* ---- модальные окна ---- */
export function openModal({ title, body, foot, full = false, onClose, closeText = '✕', headAction }) {
  const bodyEl = h('div', { class: 'modal-body' }, body || '');
  const modal = h('div', { class: 'modal' + (full ? ' full' : '') },
    h('div', { class: 'modal-head' },
      h('h2', {}, title || ''),
      headAction || null,
      h('button', { class: 'icon-btn', onclick: () => close() }, closeText)
    ),
    bodyEl,
    foot && foot.length ? h('div', { class: 'modal-foot' }, foot) : null
  );
  const back = h('div', { class: 'modal-back' }, modal);
  back.addEventListener('mousedown', e => { if (e.target === back && !full) close(); });
  qs('#modal-root').append(back);

  function close() {
    back.remove();
    if (onClose) onClose();
  }
  return { close, root: modal, body: bodyEl };
}

export function confirmDialog(text, okText = 'Удалить') {
  return new Promise(res => {
    let answered = false;
    const answer = v => { answered = true; res(v); m.close(); };
    const m = openModal({
      title: 'Подтверждение',
      body: h('p', { style: { margin: '4px 0 8px' } }, text),
      foot: [
        h('button', { class: 'btn', onclick: () => answer(false) }, 'Отмена'),
        h('button', { class: 'btn primary', onclick: () => answer(true) }, okText)
      ],
      onClose: () => { if (!answered) res(false); }
    });
  });
}

/**
 * allowEmpty — когда пустое значение осмысленно (например, у образа можно
 * убрать название). Без него пустая строка неотличима от отмены.
 */
export function promptDialog(title, value = '', label = 'Название', allowEmpty = false) {
  return new Promise(res => {
    const input = h('input', { type: 'text', value });
    let answered = false;
    const answer = v => { answered = true; res(v); m.close(); };
    const m = openModal({
      title,
      body: h('label', { class: 'field' }, h('span', {}, label), input),
      foot: [
        h('button', { class: 'btn', onclick: () => answer(null) }, 'Отмена'),
        h('button', {
          class: 'btn primary',
          onclick: () => answer(allowEmpty ? input.value.trim() : input.value.trim() || null)
        }, 'ОК')
      ],
      onClose: () => { if (!answered) res(null); }
    });
    setTimeout(() => input.focus(), 60);
  });
}

/* ---- выбор из списка действий ---- */
export function actionSheet(title, actions) {
  return new Promise(res => {
    let done = false;
    const m = openModal({
      title,
      body: h('div', { class: 'list' },
        actions.map(a => h('button', {
          class: 'btn block' + (a.danger ? ' danger' : '') + (a.muted ? ' quiet' : ''),
          style: { textAlign: 'left', marginBottom: '2px' },
          onclick: () => { done = true; res(a.id); m.close(); }
        }, (a.icon ? a.icon + '  ' : '') + a.label))
      ),
      onClose: () => { if (!done) res(null); }
    });
  });
}

/** Сообщение без выбора — когда действие не выполнено и надо объяснить почему. */
export function alertDialog(text, title = 'Так нельзя') {
  return new Promise(res => {
    let answered = false;
    const m = openModal({
      title,
      body: h('p', { style: { margin: '4px 0 8px' } }, text),
      foot: [h('button', { class: 'btn primary', onclick: () => { answered = true; res(); m.close(); } }, 'Понятно')],
      onClose: () => { if (!answered) res(); }
    });
  });
}

export const plural = (n, one, few, many) => {
  const a = Math.abs(n) % 100, b = a % 10;
  return n + ' ' + (a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many);
};
export const nItems = n => plural(n, 'вещь', 'вещи', 'вещей');
export const nOutfits = n => plural(n, 'образ', 'образа', 'образов');
/** Только слово, без числа — для подписей под крупной цифрой. */
export const pluralWord = (n, one, few, many) =>
  plural(n, one, few, many).split(' ').slice(1).join(' ');

export const fmtDate = d => {
  const dt = typeof d === 'string' ? new Date(d + 'T00:00:00') : d;
  return dt.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
};
export const iso = d => {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** replaceChildren, но с отбрасыванием null/false — иначе в DOM попадает текст "null". */
export function fill(el, ...kids) {
  el.replaceChildren(...kids.flat(3).filter(k => k != null && k !== false));
  return el;
}
