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
export function toast(msg, ms = 2000) {
  const t = h('div', { class: 'toast' }, msg);
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

export function promptDialog(title, value = '', label = 'Название') {
  return new Promise(res => {
    const input = h('input', { type: 'text', value });
    let answered = false;
    const answer = v => { answered = true; res(v); m.close(); };
    const m = openModal({
      title,
      body: h('label', { class: 'field' }, h('span', {}, label), input),
      foot: [
        h('button', { class: 'btn', onclick: () => answer(null) }, 'Отмена'),
        h('button', { class: 'btn primary', onclick: () => answer(input.value.trim() || null) }, 'ОК')
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
          class: 'btn block' + (a.danger ? ' danger' : ''),
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
