// Источники изображений: галерея, камера, а также «пипетка» цвета с камеры.
import { h, qs, openModal, toast } from './ui.js';
import { rgbToHex } from './color.js';
import { encodeCanvas } from './editor.js';

export function pickImageFile() {
  return new Promise(res => {
    const input = qs('#file-input');
    const onChange = () => {
      input.removeEventListener('change', onChange);
      const f = input.files && input.files[0];
      input.value = '';
      res(f || null);
    };
    input.addEventListener('change', onChange);
    input.click();
  });
}

/** Выбор нескольких файлов за раз. Больше max за один заход не берём —
 *  это защита от случайного «выделить всю галерею». */
export function pickImageFiles(max = 10) {
  return new Promise(res => {
    const input = qs('#file-input-multi');
    const onChange = () => {
      input.removeEventListener('change', onChange);
      const files = [...(input.files || [])];
      input.value = '';
      if (files.length > max) {
        toast(`За раз можно добавить не больше ${max} — выбрано ${files.length}`, 3800);
        res(null);
        return;
      }
      res(files);
    };
    input.addEventListener('change', onChange);
    input.click();
  });
}

async function startStream(video) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false
  });
  video.srcObject = stream;
  await video.play();
  return stream;
}

function cameraUnavailable(err) {
  console.warn(err);
  toast(location.protocol === 'file:'
    ? 'Камера работает только по http(s) — запустите локальный сервер'
    : 'Нет доступа к камере', 3400);
}

/** Снимок вещи камерой. Возвращает Blob|null. */
export function captureFromCamera() {
  return new Promise(async res => {
    const video = h('video', { id: 'cam', playsinline: true, muted: true });
    let stream = null, done = false;
    const modal = openModal({
      title: 'Снять вещь',
      body: h('div', {}, video, h('p', { class: 'muted small center' }, 'Положите вещь на однотонный фон — фон потом уберём.')),
      foot: [
        h('button', { class: 'btn', onclick: () => modal.close() }, 'Отмена'),
        h('button', {
          class: 'btn primary', onclick: async () => {
            const c = document.createElement('canvas');
            c.width = video.videoWidth; c.height = video.videoHeight;
            c.getContext('2d').drawImage(video, 0, 0);
            // фотография в PNG весила в разы больше нужного: прозрачности
            // в кадре с камеры нет, хранить его без потерь незачем
            const b = await encodeCanvas(c, { alpha: false });
            done = true; stop(); modal.close(); res(b);
          }
        }, '📸 Снять')
      ],
      onClose: () => { stop(); if (!done) res(null); }
    });
    function stop() { stream?.getTracks().forEach(t => t.stop()); }
    try { stream = await startStream(video); }
    catch (e) { cameraUnavailable(e); modal.close(); }
  });
}

/** Пипетка: наводим камеру, тапаем по кадру — получаем hex. */
export function scanColorFromCamera() {
  return new Promise(async res => {
    const video = h('video', { id: 'cam', playsinline: true, muted: true });
    const sw = h('div', { class: 'swatch', style: { width: '54px', height: '54px', background: '#ffffff' } });
    const label = h('b', {}, '—');
    let picked = null, stream = null, done = false;

    video.addEventListener('click', e => {
      const r = video.getBoundingClientRect();
      const c = document.createElement('canvas');
      c.width = video.videoWidth; c.height = video.videoHeight;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(video, 0, 0);
      const x = Math.round((e.clientX - r.left) * c.width / r.width);
      const y = Math.round((e.clientY - r.top) * c.height / r.height);
      // усредняем 9x9 — так цвет стабильнее
      const d = ctx.getImageData(Math.max(0, x - 4), Math.max(0, y - 4), 9, 9).data;
      let R = 0, G = 0, B = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) { R += d[i]; G += d[i + 1]; B += d[i + 2]; n++; }
      picked = rgbToHex(R / n, G / n, B / n);
      sw.style.background = picked;
      label.textContent = picked.toUpperCase();
    });

    const modal = openModal({
      title: 'Сканировать цвет',
      body: h('div', {}, video,
        h('p', { class: 'muted small center' }, 'Тапните по кадру, чтобы взять цвет'),
        h('div', { class: 'row', style: { justifyContent: 'center', gap: '12px' } }, sw, label)),
      foot: [
        h('button', { class: 'btn', onclick: () => modal.close() }, 'Отмена'),
        h('button', { class: 'btn primary', onclick: () => { if (!picked) return toast('Сначала тапните по кадру'); done = true; stop(); modal.close(); res(picked); } }, 'Искать')
      ],
      onClose: () => { stop(); if (!done) res(null); }
    });
    function stop() { stream?.getTracks().forEach(t => t.stop()); }
    try { stream = await startStream(video); }
    catch (e) { cameraUnavailable(e); modal.close(); }
  });
}
