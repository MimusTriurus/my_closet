// Редактор изображения вещи: ML-удаление фона + ручные инструменты (волшебная палочка,
// ластик, восстановление, прямоугольный и свободный кроп).
import { fill, h, qs, openModal, toast, busy } from './ui.js';

const IMGLY_URL = 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.5.8/+esm';
const MAX_SIDE = 1400;
let mlModule = null;   // кэшируем модуль между вызовами

export function imageFromBlob(blob) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = typeof blob === 'string' ? blob : URL.createObjectURL(blob);
  });
}

const canvasToBlob = (c, type = 'image/png') =>
  new Promise(res => c.toBlob(res, type, 0.92));

/** Обрезает прозрачные поля вокруг вещи. */
export function trimTransparent(src) {
  const ctx = src.getContext('2d', { willReadFrequently: true });
  const { width: w, height: h2 } = src;
  const d = ctx.getImageData(0, 0, w, h2).data;
  let minX = w, minY = h2, maxX = -1, maxY = -1;
  for (let y = 0; y < h2; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 12) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return src;
  const pad = Math.round(Math.max(maxX - minX, maxY - minY) * 0.03);
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad); maxY = Math.min(h2 - 1, maxY + pad);
  const out = document.createElement('canvas');
  out.width = maxX - minX + 1; out.height = maxY - minY + 1;
  out.getContext('2d').drawImage(src, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

/**
 * Открывает редактор. Возвращает Promise<Blob|null> — PNG с прозрачным фоном.
 * @param {Blob|string} source исходное изображение
 * @param {boolean} autoAI сразу запустить ML-удаление фона
 */
export async function openImageEditor(source, { autoAI = false } = {}) {
  const img = await imageFromBlob(source);

  // рабочий холст (ограничиваем размер — иначе тормозит на телефоне)
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const W = Math.round(img.naturalWidth * scale), H = Math.round(img.naturalHeight * scale);

  const orig = document.createElement('canvas');
  orig.width = W; orig.height = H;
  orig.getContext('2d').drawImage(img, 0, 0, W, H);

  let work = document.createElement('canvas');
  work.width = W; work.height = H;
  work.getContext('2d', { willReadFrequently: true }).drawImage(orig, 0, 0);

  const history = [];
  const pushHistory = () => {
    if (history.length > 7) history.shift();
    const c = document.createElement('canvas');
    c.width = work.width; c.height = work.height;
    c.getContext('2d').drawImage(work, 0, 0);
    history.push(c);
    updateChrome();
  };

  /* ---------- разметка ---------- */
  const canvas = h('canvas', { id: 'ed-canvas' });
  const wrap = h('div', { id: 'ed-wrap' }, canvas);
  const opts = h('div', { class: 'tool-opts' });
  const toolbar = h('div', { class: 'tools' });

  let tool = 'wand';
  let tolerance = 0.18, brush = 34;

  const TOOLS = [
    { id: 'ai', ic: '✨', label: 'ИИ-фон', action: runAI },
    { id: 'wand', ic: '🪄', label: 'Палочка' },
    { id: 'erase', ic: '🧽', label: 'Ластик' },
    { id: 'restore', ic: '↩️', label: 'Вернуть' },
    { id: 'crop', ic: '⬛', label: 'Кроп' },
    { id: 'lasso', ic: '✂️', label: 'Лассо' },
    { id: 'undo', ic: '⟲', label: 'Отменить', action: undo },
    { id: 'reset', ic: '⟳', label: 'Сброс', action: reset }
  ];

  function renderToolbar() {
    fill(toolbar, ...TOOLS.map(t =>
      h('button', {
        class: 'tool' + (tool === t.id ? ' active' : ''),
        onclick: () => {
          if (t.action) { t.action(); return; }
          tool = t.id; cropRect = null; renderToolbar(); renderOpts(); render();
        }
      }, h('span', { class: 'ic' }, t.ic), h('span', {}, t.label))
    ));
  }

  function renderOpts() {
    opts.replaceChildren();
    if (tool === 'wand') {
      const r = h('input', { type: 'range', min: 2, max: 60, value: Math.round(tolerance * 100), oninput: e => { tolerance = e.target.value / 100; lbl.textContent = `Чувствительность: ${e.target.value}%`; } });
      const lbl = h('div', { class: 'muted small' }, `Чувствительность: ${Math.round(tolerance * 100)}%`);
      opts.append(lbl, r, h('div', { class: 'muted small' }, 'Нажмите на фон — область удалится.'));
    } else if (tool === 'erase' || tool === 'restore') {
      const lbl = h('div', { class: 'muted small' }, `Кисть: ${brush} px`);
      opts.append(lbl, h('input', { type: 'range', min: 6, max: 140, value: brush, oninput: e => { brush = +e.target.value; lbl.textContent = `Кисть: ${brush} px`; } }));
    } else if (tool === 'crop') {
      opts.append(h('div', { class: 'row' },
        h('span', { class: 'muted small spacer' }, 'Выделите прямоугольник'),
        h('button', { class: 'btn btn-sm primary', onclick: applyCrop }, 'Применить')));
    } else if (tool === 'lasso') {
      opts.append(h('div', { class: 'muted small' }, 'Обведите вещь пальцем — всё снаружи удалится.'));
    }
  }

  const doneBtn = h('button', { class: 'btn primary', onclick: finish }, 'Готово');
  let resolveFn;
  const modal = openModal({
    title: 'Обработка фото',
    full: true,
    body: h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', margin: '-12px' } }, wrap, opts, toolbar),
    foot: [h('button', { class: 'btn', onclick: () => { modal.close(); } }, 'Отмена'), doneBtn],
    onClose: () => resolveFn && resolveFn(null)
  });

  function updateChrome() {
    const u = TOOLS.find(t => t.id === 'undo');
    const btn = [...toolbar.children][TOOLS.indexOf(u)];
    if (btn) btn.disabled = history.length === 0;
  }

  /* ---------- отрисовка ---------- */
  let cropRect = null, lassoPts = null, hoverPt = null;
  function render() {
    canvas.width = work.width; canvas.height = work.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(work, 0, 0);
    if (cropRect) {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.beginPath();
      ctx.rect(0, 0, canvas.width, canvas.height);
      ctx.rect(cropRect.x, cropRect.y, cropRect.w, cropRect.h);
      ctx.fill('evenodd');
      ctx.strokeStyle = '#c1785c'; ctx.lineWidth = 3;
      ctx.strokeRect(cropRect.x, cropRect.y, cropRect.w, cropRect.h);
      ctx.restore();
    }
    if (lassoPts && lassoPts.length > 1) {
      ctx.save();
      ctx.strokeStyle = '#c1785c'; ctx.lineWidth = 3; ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(lassoPts[0].x, lassoPts[0].y);
      lassoPts.forEach(p => ctx.lineTo(p.x, p.y));
      ctx.stroke();
      ctx.restore();
    }
    if (hoverPt && (tool === 'erase' || tool === 'restore')) {
      ctx.save();
      ctx.strokeStyle = tool === 'erase' ? '#d94f45' : '#4f8a5b'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(hoverPt.x, hoverPt.y, brush / 2, 0, 7); ctx.stroke();
      ctx.restore();
    }
  }

  /* ---------- ввод ---------- */
  const toWork = e => {
    const r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * canvas.width / r.width,
      y: (e.clientY - r.top) * canvas.height / r.height
    };
  };

  let drawing = false, last = null, startPt = null;

  canvas.addEventListener('pointerdown', e => {
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { }
    const p = toWork(e);
    if (tool === 'wand') { pushHistory(); magicWand(p.x | 0, p.y | 0); render(); return; }
    drawing = true; last = p; startPt = p;
    if (tool === 'erase' || tool === 'restore') { pushHistory(); paint(p, p); render(); }
    if (tool === 'lasso') { pushHistory(); lassoPts = [p]; }
    if (tool === 'crop') cropRect = { x: p.x, y: p.y, w: 0, h: 0 };
  });

  canvas.addEventListener('pointermove', e => {
    const p = toWork(e);
    hoverPt = p;
    if (!drawing) { if (tool === 'erase' || tool === 'restore') render(); return; }
    if (tool === 'erase' || tool === 'restore') { paint(last, p); last = p; render(); }
    else if (tool === 'lasso') { lassoPts.push(p); render(); }
    else if (tool === 'crop') {
      cropRect = {
        x: Math.min(startPt.x, p.x), y: Math.min(startPt.y, p.y),
        w: Math.abs(p.x - startPt.x), h: Math.abs(p.y - startPt.y)
      };
      render();
    }
  });

  canvas.addEventListener('pointerup', () => {
    if (drawing && tool === 'lasso' && lassoPts && lassoPts.length > 4) applyLasso();
    drawing = false; last = null;
  });
  canvas.addEventListener('pointerleave', () => { hoverPt = null; render(); });

  /* ---------- инструменты ---------- */
  function paint(from, to) {
    const ctx = work.getContext('2d');
    const r = brush / 2;
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(1, Math.ceil(dist / (r / 2)));
    for (let i = 0; i <= steps; i++) {
      const x = from.x + (to.x - from.x) * i / steps;
      const y = from.y + (to.y - from.y) * i / steps;
      ctx.save();
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7);
      if (tool === 'erase') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fill();
      } else {
        ctx.clip();
        ctx.drawImage(orig, 0, 0);
      }
      ctx.restore();
    }
  }

  // Заливка по клику: убираем связную область близкого цвета (аналог "Tap Background")
  function magicWand(sx, sy) {
    const ctx = work.getContext('2d', { willReadFrequently: true });
    const w = work.width, hgt = work.height;
    const img = ctx.getImageData(0, 0, w, hgt);
    const d = img.data;
    const idx = (sy * w + sx) * 4;
    if (d[idx + 3] === 0) return;
    const sr = d[idx], sg = d[idx + 1], sb = d[idx + 2];
    const thr = tolerance * 255 * 1.732;
    const seen = new Uint8Array(w * hgt);
    const stack = [sy * w + sx];
    seen[sy * w + sx] = 1;
    let count = 0;
    while (stack.length) {
      const p = stack.pop();
      const i4 = p * 4;
      const dr = d[i4] - sr, dg = d[i4 + 1] - sg, db = d[i4 + 2] - sb;
      if (Math.sqrt(dr * dr + dg * dg + db * db) > thr) continue;
      d[i4 + 3] = 0;
      count++;
      const x = p % w, y = (p / w) | 0;
      if (x > 0 && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
      if (x < w - 1 && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
      if (y > 0 && !seen[p - w]) { seen[p - w] = 1; stack.push(p - w); }
      if (y < hgt - 1 && !seen[p + w]) { seen[p + w] = 1; stack.push(p + w); }
    }
    ctx.putImageData(img, 0, 0);
    if (!count) toast('Здесь нечего удалять');
  }

  function applyCrop() {
    if (!cropRect || cropRect.w < 8 || cropRect.h < 8) { toast('Сначала выделите область'); return; }
    pushHistory();
    const out = document.createElement('canvas');
    out.width = Math.round(cropRect.w); out.height = Math.round(cropRect.h);
    out.getContext('2d').drawImage(work, Math.round(cropRect.x), Math.round(cropRect.y),
      out.width, out.height, 0, 0, out.width, out.height);
    work = out;
    cropRect = null;
    render();
  }

  function applyLasso() {
    const mask = document.createElement('canvas');
    mask.width = work.width; mask.height = work.height;
    const mc = mask.getContext('2d');
    mc.beginPath();
    mc.moveTo(lassoPts[0].x, lassoPts[0].y);
    lassoPts.forEach(p => mc.lineTo(p.x, p.y));
    mc.closePath();
    mc.fillStyle = '#fff'; mc.fill();
    const ctx = work.getContext('2d');
    ctx.save();
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(mask, 0, 0);
    ctx.restore();
    lassoPts = null;
    render();
  }

  async function runAI() {
    busy(true, mlModule ? 'Удаляю фон…' : 'Загружаю ИИ-модель (~40 МБ, только первый раз)…');
    try {
      if (!mlModule) mlModule = await import(/* @vite-ignore */ IMGLY_URL);
      const fn = mlModule.removeBackground || mlModule.default;
      const srcBlob = await canvasToBlob(work);
      const outBlob = await fn(srcBlob, {
        output: { format: 'image/png', quality: 0.9 },
        progress: (key, cur, total) => {
          if (key.startsWith('fetch')) busy(true, `Загружаю модель: ${Math.round(cur / total * 100)}%`);
          else busy(true, 'Удаляю фон…');
        }
      });
      const outImg = await imageFromBlob(outBlob);
      pushHistory();
      const ctx = work.getContext('2d');
      ctx.clearRect(0, 0, work.width, work.height);
      ctx.drawImage(outImg, 0, 0, work.width, work.height);
      render();
      toast('Фон удалён');
    } catch (err) {
      console.error(err);
      toast('ИИ недоступен — используйте «Палочку»', 3200);
    } finally {
      busy(false);
    }
  }

  function undo() {
    const prev = history.pop();
    if (!prev) return;
    work = prev;
    cropRect = null; lassoPts = null;
    render(); updateChrome();
  }

  function reset() {
    pushHistory();
    work = document.createElement('canvas');
    work.width = W; work.height = H;
    work.getContext('2d', { willReadFrequently: true }).drawImage(orig, 0, 0);
    cropRect = null; lassoPts = null;
    render();
  }

  async function finish() {
    doneBtn.disabled = true;
    const trimmed = trimTransparent(work);
    const blob = await canvasToBlob(trimmed);
    const r = resolveFn; resolveFn = null;
    modal.close();
    r(blob);
  }

  renderToolbar(); renderOpts(); render(); updateChrome();
  if (autoAI) setTimeout(runAI, 120);

  return new Promise(res => { resolveFn = res; });
}
