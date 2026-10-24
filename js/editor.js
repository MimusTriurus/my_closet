// Редактор изображения вещи: ручные инструменты (волшебная палочка, ластик,
// восстановление, кисть, прямоугольный и свободный кроп) плюс ИИ-удаление фона.
// Все инструменты — по нажатию: приложение ничего не делает со снимком само.
// Снимок можно приблизить и отдалить — щипком, колесом или кнопками; приближение
// нужно ластику, которым убирают мелочь вроде вешалки или травинки под подолом,
// отдаление — лассо, которому нужен весь силуэт целиком.
import { fill, h, qs, openModal, toast, busy } from './ui.js';
import { rgbToHex } from './color.js';

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

const canvasToBlob = (c, type = 'image/png', q = 0.92) =>
  new Promise(res => c.toBlob(res, type, q));

/* ---------- в чём храним снимки ----------
 * Вырезанная вещь в PNG весит 400–900 КБ, та же в WebP — 40–130 КБ: в
 * семь-одиннадцать раз меньше при той же прозрачности. На гардеробе из
 * полутора сотен вещей это разница между 75 и 9 мегабайтами — и на
 * телефоне, и в резервной копии.
 *
 * Весь выигрыш — в сжатии с потерями: WebP без потерь даёт всего ~1,6 раза.
 * Качество 0.9 выбрано ради краёв выреза: там, где вокруг прозрачность,
 * кайма заметнее всего.
 *
 * Поддержку не угадываем по названию движка, а спрашиваем у него самого:
 * старый WebView молча вернёт PNG вместо WebP, и мы бы считали, что храним
 * одно, а хранили другое.
 */
const WEBP_Q = 0.9;
let webpProbe = null;
export const webpSupported = () => webpProbe || (webpProbe = new Promise(res => {
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  try { c.toBlob(b => res(!!b && b.type === 'image/webp'), 'image/webp', WEBP_Q); }
  catch (e) { res(false); }
}));

/**
 * Кодирует холст: WebP, где движок умеет, иначе прежнее.
 * `alpha` — нужна ли прозрачность: от неё зависит только запасной вариант
 * (PNG её хранит, JPEG нет).
 */
export async function encodeCanvas(c, { alpha = true, quality = WEBP_Q } = {}) {
  if (await webpSupported()) {
    const b = await canvasToBlob(c, 'image/webp', quality);
    if (b && b.type === 'image/webp') return b;
  }
  return canvasToBlob(c, alpha ? 'image/png' : 'image/jpeg', quality);
}

/**
 * Ужимает снимок перед сохранением: фото с телефона весит 4–6 МБ, а в карточке
 * и в образе разница не видна. Прозрачность сохраняем только у PNG.
 */
export async function downscaleBlob(blob, max = 1600) {
  const img = await imageFromBlob(blob);
  const w = img.naturalWidth, h = img.naturalHeight;
  const scale = Math.min(1, max / Math.max(w, h));
  if (scale === 1 && blob.size < 1_500_000) return blob;   // уже компактно
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  // прозрачность может быть у PNG и у WebP — её бережём, остальное в JPEG
  const alpha = blob.type === 'image/png' || blob.type === 'image/webp';
  return encodeCanvas(c, { alpha, quality: 0.88 });
}

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
 * Открывает редактор. Возвращает Promise<Blob|null> — снимок с прозрачным фоном.
 * @param {Blob|string} source исходное изображение
 */
export async function openImageEditor(source) {
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

  /* ---------- масштаб ----------
   * Мелкую деталь на вписанном в экран снимке не стереть: один «пиксель»
   * пальца — это несколько пикселей изображения, и промах неизбежен.
   * Уменьшением кисти это не лечится — кисть упирается в точность пальца,
   * а не в свой размер. Лечится увеличением.
   *
   * Увеличение **только видимое**: холст и все инструменты продолжают
   * работать в пикселях изображения. Ничего пересчитывать не пришлось —
   * toWork() считает по видимому прямоугольнику холста, а тот уже учитывает
   * любое преобразование.
   */
  // Нижняя граница ниже единицы: при единице снимок вписан в окно впритык,
  // и обводить лассо приходится по самому краю, куда палец уже не ставится.
  const ZOOM_MIN = 0.35, ZOOM_MAX = 8;
  let zoom = 1, panX = 0, panY = 0;
  const zoomLbl = h('b', {}, '100%');

  /** Не даём утащить снимок за край: вернуться к нему было бы нечем. */
  function clampPan() {
    const mx = Math.max(0, (canvas.offsetWidth * zoom - wrap.clientWidth) / 2);
    const my = Math.max(0, (canvas.offsetHeight * zoom - wrap.clientHeight) / 2);
    panX = Math.min(mx, Math.max(-mx, panX));
    panY = Math.min(my, Math.max(-my, panY));
  }

  function applyView() {
    clampPan();
    canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    zoomLbl.textContent = Math.round(zoom * 100) + '%';
    fitBtn.disabled = zoom === 1 && !panX && !panY;
  }

  /** Масштаб вокруг точки экрана: то, что под пальцем, под ним и остаётся. */
  function zoomAt(next, cx, cy) {
    next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
    const r = wrap.getBoundingClientRect();
    const vx = (cx - (r.left + r.width / 2) - panX) / zoom;
    const vy = (cy - (r.top + r.height / 2) - panY) / zoom;
    panX = cx - (r.left + r.width / 2) - next * vx;
    panY = cy - (r.top + r.height / 2) - next * vy;
    zoom = next;
    applyView();
  }

  const wrapCenter = () => {
    const r = wrap.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  };
  const stepZoom = k => zoomAt(zoom * k, ...wrapCenter());
  const resetView = () => { zoom = 1; panX = panY = 0; applyView(); };

  /* Отдельной строкой над снимком. Поверх снимка эти кнопки закрывали угол —
   * ровно тот, к которому при увеличении и подбираются.
   *
   * Рука стоит здесь же, а не среди инструментов: сдвигать нужно ровно
   * тогда, когда приблизили, — это одна работа, и делается она в одном
   * месте.
   */
  // «Вписать» возвращает снимок к исходному виду: масштаб 100%, без сдвига.
  // Пока возвращать нечего, кнопка погашена — иначе она выглядит сломанной:
  // нажимаешь, и ничего не происходит.
  const fitBtn = h('button', {
    class: 'zb wide', title: 'Вернуть масштаб 100% и показать снимок целиком',
    onclick: resetView
  }, 'Вписать');

  const panBtn = h('button', {
    class: 'zb hand', title: 'Сдвинуть снимок',
    onclick: () => {
      tool = tool === 'pan' ? 'wand' : 'pan';
      cropRect = null; picking = false;
      renderToolbar(); renderOpts(); render();
    }
  }, '✋ Сдвинуть');

  const zoomBar = h('div', { class: 'zoom-bar' },
    panBtn,
    h('span', { class: 'spacer' }),
    h('button', { class: 'zb', title: 'Отдалить', onclick: () => stepZoom(1 / 1.6) }, '−'),
    zoomLbl,
    h('button', { class: 'zb', title: 'Приблизить', onclick: () => stepZoom(1.6) }, '+'),
    fitBtn
  );

  const wrap = h('div', { id: 'ed-wrap' }, canvas);
  const opts = h('div', { class: 'tool-opts' });
  const toolbar = h('div', { class: 'tools' });
  const fixbar = h('div', { class: 'tools fixes' });

  let tool = 'wand';
  let tolerance = 0.18, brush = 34;
  let paintColor = '#c1785c', picking = false;

  /** Инструменты, которые красят мазком: у них общий размер кисти и кружок под пальцем. */
  const isBrush = () => tool === 'erase' || tool === 'restore' || tool === 'paint';

  /* «Сброса» здесь нет: выйти из редактора, не нажав «Готово», — и есть отказ
     от всех правок. Отдельная кнопка с тем же смыслом только сбивала бы с
     толку рядом с «Отменить», у которого смысл совсем другой. */
  const TOOLS = [
    { id: 'ai', ic: '✨', label: 'ИИ-фон', action: runAI },
    { id: 'wand', ic: '🪄', label: 'Палочка' },
    { id: 'erase', ic: '🧽', label: 'Ластик' },
    { id: 'paint', ic: '🖌', label: 'Кисть' },
    { id: 'crop', ic: '⬛', label: 'Кроп' },
    { id: 'lasso', ic: '✂️', label: 'Лассо' }
  ];

  /* Вторая строка — то, чем исправляют уже сделанное. Отдельно от
     инструментов, потому что отменяют часто и вслепую: кнопка должна быть
     крупной и всегда на одном месте, а не одной из восьми одинаковых.
     «Вернуть» рядом — работа у них соседняя, но разная: «Отменить» снимает
     целое действие, «Вернуть» возвращает исходник только там, где провели. */
  const FIXES = [
    { id: 'undo', ic: '⟲', label: 'Отменить', action: undo },
    { id: 'restore', ic: '↩️', label: 'Вернуть' }
  ];

  const toolBtn = t => h('button', {
    class: 'tool' + (tool === t.id ? ' active' : ''),
    onclick: () => {
      if (t.action) { t.action(); return; }
      tool = t.id; cropRect = null; picking = false;
      renderToolbar(); renderOpts(); render();
    }
  }, h('span', { class: 'ic' }, t.ic), h('span', {}, t.label));

  function renderToolbar() {
    panBtn.classList.toggle('on', tool === 'pan');
    fill(toolbar, ...TOOLS.map(toolBtn));
    fill(fixbar, ...FIXES.map(toolBtn));
    updateChrome();
  }

  const brushSlider = () => {
    const lbl = h('div', { class: 'muted small' }, `Кисть: ${brush} px`);
    return h('div', {}, lbl, h('input', {
      type: 'range', min: 2, max: 140, value: brush,
      oninput: e => { brush = +e.target.value; lbl.textContent = `Кисть: ${brush} px`; }
    }));
  };

  function renderOpts() {
    opts.replaceChildren();
    if (tool === 'wand') {
      const r = h('input', { type: 'range', min: 2, max: 60, value: Math.round(tolerance * 100), oninput: e => { tolerance = e.target.value / 100; lbl.textContent = `Чувствительность: ${e.target.value}%`; } });
      const lbl = h('div', { class: 'muted small' }, `Чувствительность: ${Math.round(tolerance * 100)}%`);
      opts.append(lbl, r, h('div', { class: 'muted small' }, 'Нажмите на фон — область удалится.'));
    } else if (tool === 'erase') {
      opts.append(brushSlider());
    } else if (tool === 'restore') {
      opts.append(
        h('div', { class: 'muted small' },
          'Проведите по стёртому — вернётся то, что было на исходном снимке.'),
        brushSlider());
    } else if (tool === 'paint') {
      opts.append(
        h('div', { class: 'row' },
          h('input', {
            type: 'color', class: 'paint-col', value: paintColor,
            oninput: e => { paintColor = e.target.value; render(); }
          }),
          h('button', {
            class: 'btn btn-sm' + (picking ? ' primary' : ''),
            onclick: () => { picking = !picking; renderOpts(); }
          }, '💧 Пипетка'),
          h('span', { class: 'muted small spacer' },
            picking ? 'Нажмите на нужный цвет на снимке' : '')),
        brushSlider());
    } else if (tool === 'pan') {
      opts.append(h('div', { class: 'muted small' },
        'Тяните снимок пальцем. Чтобы вернуться к правке, нажмите нужный инструмент или ещё раз «Сдвинуть».'));
    } else if (tool === 'crop') {
      opts.append(h('div', { class: 'row' },
        h('span', { class: 'muted small spacer' },
          cropRect ? 'Тяните за края или за середину' : 'Выделите прямоугольник'),
        h('button', { class: 'btn btn-sm primary', onclick: applyCrop }, 'Применить')));
    } else if (tool === 'lasso') {
      opts.append(h('div', { class: 'muted small' }, 'Обведите вещь пальцем — всё снаружи удалится.'));
    }
  }

  const doneBtn = h('button', { class: 'btn primary', onclick: finish }, 'Готово');
  let resolveFn;
  const modal = openModal({
    title: 'Обработка снимка',
    full: true,
    body: h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', margin: '-12px' } }, zoomBar, wrap, opts, toolbar, fixbar),
    foot: [h('button', { class: 'btn', onclick: () => { modal.close(); } }, 'Отмена'), doneBtn],
    onClose: () => resolveFn && resolveFn(null)
  });

  function updateChrome() {
    const btn = fixbar.firstChild;          // «Отменить» всегда первая
    if (btn) btn.disabled = history.length === 0;
  }

  /* ---------- отрисовка ---------- */
  let cropRect = null, lassoPts = null, hoverPt = null;
  let cropDrag = null, panDrag = null;

  /** Сколько пикселей снимка приходится на одну точку экрана. */
  const perScreen = () => {
    const r = canvas.getBoundingClientRect();
    return r.width ? canvas.width / r.width : 1;
  };
  function render() {
    canvas.width = work.width; canvas.height = work.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(work, 0, 0);
    const k = perScreen();
    if (cropRect) {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.beginPath();
      ctx.rect(0, 0, canvas.width, canvas.height);
      ctx.rect(cropRect.x, cropRect.y, cropRect.w, cropRect.h);
      ctx.fill('evenodd');
      ctx.strokeStyle = '#c1785c'; ctx.lineWidth = 3 * k;
      ctx.strokeRect(cropRect.x, cropRect.y, cropRect.w, cropRect.h);
      // Ручки по углам и серединам сторон: без них не видно, что рамку
      // можно поправить, а не только обвести заново.
      const s2 = 7 * k;
      ctx.fillStyle = '#fff'; ctx.lineWidth = 2 * k;
      for (const [hx, hy] of cropHandles(cropRect)) {
        ctx.beginPath();
        ctx.rect(hx - s2, hy - s2, s2 * 2, s2 * 2);
        ctx.fill(); ctx.stroke();
      }
      ctx.restore();
    }
    if (lassoPts && lassoPts.length > 1) {
      ctx.save();
      ctx.strokeStyle = '#c1785c'; ctx.lineWidth = 3 * k; ctx.setLineDash([8 * k, 6 * k]);
      ctx.beginPath();
      ctx.moveTo(lassoPts[0].x, lassoPts[0].y);
      lassoPts.forEach(p => ctx.lineTo(p.x, p.y));
      ctx.stroke();
      ctx.restore();
    }
    if (hoverPt && isBrush()) {
      ctx.save();
      ctx.strokeStyle = tool === 'erase' ? '#d94f45' : tool === 'paint' ? paintColor : '#4f8a5b';
      ctx.lineWidth = 2 * k;
      ctx.beginPath(); ctx.arc(hoverPt.x, hoverPt.y, brush / 2, 0, 7); ctx.stroke();
      ctx.restore();
    }
  }

  /* ---------- рамка кропа ----------
   * Выделить область с первого раза пальцем не получается: то лишнее влезло,
   * то нужный край отрезан. Поэтому готовую рамку можно двигать целиком и
   * тянуть за любую сторону или угол — пока не нажато «Применить», ничего
   * со снимком не происходит.
   */
  const cropHandles = r => [
    [r.x, r.y], [r.x + r.w / 2, r.y], [r.x + r.w, r.y],
    [r.x, r.y + r.h / 2], [r.x + r.w, r.y + r.h / 2],
    [r.x, r.y + r.h], [r.x + r.w / 2, r.y + r.h], [r.x + r.w, r.y + r.h]
  ];

  /** Сторона, угол или середина — либо null, и тогда рисуется новая рамка. */
  function cropHit(p) {
    if (!cropRect) return null;
    const t = 22 * perScreen();           // 22 точки экрана — палец попадает
    const { x, y, w, h } = cropRect;
    if (p.x < x - t || p.x > x + w + t || p.y < y - t || p.y > y + h + t) return null;
    const side =
      (Math.abs(p.y - y) <= t ? 'n' : Math.abs(p.y - (y + h)) <= t ? 's' : '') +
      (Math.abs(p.x - x) <= t ? 'w' : Math.abs(p.x - (x + w)) <= t ? 'e' : '');
    if (side) return { mode: side, rect0: { ...cropRect } };
    const inside = p.x > x && p.x < x + w && p.y > y && p.y < y + h;
    return inside ? { mode: 'move', rect0: { ...cropRect } } : null;
  }

  function dragCrop(d, p) {
    const r0 = d.rect0, dx = p.x - startPt.x, dy = p.y - startPt.y;
    if (d.mode === 'move') {
      // целиком за край не уводим: вернуть рамку оттуда было бы нечем
      cropRect = {
        w: r0.w, h: r0.h,
        x: Math.min(work.width - r0.w, Math.max(0, r0.x + dx)),
        y: Math.min(work.height - r0.h, Math.max(0, r0.y + dy))
      };
      return;
    }
    let { x, y, w, h } = r0;
    if (d.mode.includes('w')) { x = r0.x + dx; w = r0.w - dx; }
    if (d.mode.includes('e')) { w = r0.w + dx; }
    if (d.mode.includes('n')) { y = r0.y + dy; h = r0.h - dy; }
    if (d.mode.includes('s')) { h = r0.h + dy; }
    if (w < 0) { x += w; w = -w; }        // сторону протащили через противоположную
    if (h < 0) { y += h; h = -h; }
    cropRect = { x, y, w, h };
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

  // Пальцы на холсте. Один — инструмент, два — щипок: иначе рисование и
  // перемещение подрались бы за одно и то же движение.
  const pts = new Map();
  let pinch = null;

  /**
   * Второй палец отменяет уже начатый мазок. Без этого каждый щипок оставлял
   * бы точку в том месте, где человек просто коснулся экрана первым пальцем.
   */
  function cancelStroke() {
    if (!drawing) return;
    drawing = false; last = null;
    if (tool === 'pan') { panDrag = null; return; }
    if (tool === 'crop') {
      // правили готовую рамку — возвращаем её, рисовали новую — убираем
      if (cropDrag) { cropRect = cropDrag.rect0; cropDrag = null; }
      else cropRect = null;
      render(); return;
    }
    undo();   // ластик, кисть, восстановление и лассо записали шаг в историю
  }

  function startPinch() {
    const [a, b] = [...pts.values()];
    pinch = {
      dist: Math.hypot(b.x - a.x, b.y - a.y) || 1,
      mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2,
      zoom, panX, panY
    };
  }

  function movePinch() {
    const [a, b] = [...pts.values()];
    const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, pinch.zoom * dist / pinch.dist));
    const r = wrap.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    // точка снимка, что была под серединой между пальцами, остаётся под ней
    const vx = (pinch.mx - cx - pinch.panX) / pinch.zoom;
    const vy = (pinch.my - cy - pinch.panY) / pinch.zoom;
    panX = mx - cx - next * vx;
    panY = my - cy - next * vy;
    zoom = next;
    applyView();
  }

  canvas.addEventListener('pointerdown', e => {
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) { cancelStroke(); startPinch(); return; }
    if (pts.size > 2) return;

    try { canvas.setPointerCapture(e.pointerId); } catch (_) { }

    if (tool === 'pan') {
      drawing = true;
      panDrag = { x: e.clientX, y: e.clientY, panX, panY };
      return;
    }

    const p = toWork(e);
    if (picking) { pickColor(p); return; }
    if (tool === 'wand') { pushHistory(); magicWand(p.x | 0, p.y | 0); render(); return; }
    drawing = true; last = p; startPt = p;
    if (isBrush()) { pushHistory(); paint(p, p); render(); }
    if (tool === 'lasso') { pushHistory(); lassoPts = [p]; }
    if (tool === 'crop') {
      cropDrag = cropHit(p);
      if (!cropDrag) { cropRect = { x: p.x, y: p.y, w: 0, h: 0 }; renderOpts(); }
    }
  });

  canvas.addEventListener('pointermove', e => {
    if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch) { if (pts.size >= 2) movePinch(); return; }
    if (pts.size > 1) return;

    if (tool === 'pan') {
      if (!panDrag) return;
      panX = panDrag.panX + (e.clientX - panDrag.x);
      panY = panDrag.panY + (e.clientY - panDrag.y);
      applyView();
      return;
    }

    const p = toWork(e);
    hoverPt = p;
    if (!drawing) { if (isBrush()) render(); return; }
    if (isBrush()) { paint(last, p); last = p; render(); }
    else if (tool === 'lasso') { lassoPts.push(p); render(); }
    else if (tool === 'crop') {
      if (cropDrag) dragCrop(cropDrag, p);
      else cropRect = {
        x: Math.min(startPt.x, p.x), y: Math.min(startPt.y, p.y),
        w: Math.abs(p.x - startPt.x), h: Math.abs(p.y - startPt.y)
      };
      render();
    }
  });

  function endPointer(e) {
    pts.delete(e.pointerId);
    if (pinch) {
      // пока палец на экране один, щипок не возобновляем: оставшийся палец
      // не должен внезапно начать рисовать с середины жеста
      if (!pts.size) pinch = null;
      drawing = false; last = null;
      return;
    }
    if (drawing && tool === 'lasso' && lassoPts && lassoPts.length > 4) applyLasso();
    if (tool === 'crop' && !cropDrag && cropRect) renderOpts();   // подсказка сменилась
    drawing = false; last = null; cropDrag = null; panDrag = null;
  }

  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', () => { hoverPt = null; render(); });

  // мышью — колесом: на компьютере щипка нет
  wrap.addEventListener('wheel', e => {
    e.preventDefault();
    zoomAt(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY);
  }, { passive: false });

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
      } else if (tool === 'paint') {
        ctx.fillStyle = paintColor;
        ctx.fill();
      } else {
        ctx.clip();
        ctx.drawImage(orig, 0, 0);
      }
      ctx.restore();
    }
  }

  /**
   * Пипетка: цвет берём с рабочего снимка, а не с исходного, — красить
   * собираются поверх того, что видно сейчас.
   */
  function pickColor(p) {
    picking = false;
    const x = Math.max(0, Math.min(work.width - 1, p.x | 0));
    const y = Math.max(0, Math.min(work.height - 1, p.y | 0));
    const d = work.getContext('2d', { willReadFrequently: true }).getImageData(x, y, 1, 1).data;
    if (!d[3]) toast('Здесь прозрачно — цвета нет');
    else paintColor = rgbToHex(d[0], d[1], d[2]);
    renderOpts(); render();
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
    // рамку могли вытянуть за край снимка — берём только пересечение
    const x = Math.max(0, Math.round(cropRect.x));
    const y = Math.max(0, Math.round(cropRect.y));
    const w = Math.min(work.width, Math.round(cropRect.x + cropRect.w)) - x;
    const hh = Math.min(work.height, Math.round(cropRect.y + cropRect.h)) - y;
    if (w < 8 || hh < 8) { toast('Область почти вся за краем снимка'); return; }
    pushHistory();
    const out = document.createElement('canvas');
    out.width = w; out.height = hh;
    out.getContext('2d').drawImage(work, x, y, w, hh, 0, 0, w, hh);
    work = out;
    cropRect = null;
    render(); resetView(); renderOpts();
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

  async function finish() {
    doneBtn.disabled = true;
    const trimmed = trimTransparent(work);
    const blob = await encodeCanvas(trimmed);
    const r = resolveFn; resolveFn = null;
    modal.close();
    r(blob);
  }

  renderToolbar(); renderOpts(); render(); updateChrome(); applyView();

  return new Promise(res => { resolveFn = res; });
}
