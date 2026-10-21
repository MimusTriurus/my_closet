// Работа с цветом: извлечение оттенков с фотографии и сравнение в OKLab.
// Названий цветов здесь нет — их даёт пользователь в своей палитре.

export const hexToRgb = hex => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
export const rgbToHex = (r, g, b) =>
  '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

// sRGB -> OKLab (перцептивно равномерное пространство; сравнивать цвета в RGB нельзя)
export function oklab(r, g, b) {
  const f = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const R = f(r), G = f(g), B = f(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
  ];
}

// Расстояние между цветами (0 — идентичны, ~0.35+ — совсем разные)
export function colorDist(hexA, hexB) {
  const a = oklab(...hexToRgb(hexA)), b = oklab(...hexToRgb(hexB));
  // светлота весит меньше — иначе тёмно-синий и чёрный «не похожи», хотя визуально близки
  const dl = (a[0] - b[0]) * 0.8, da = a[1] - b[1], db = a[2] - b[2];
  return Math.sqrt(dl * dl + da * da + db * db);
}

/**
 * Достаёт доминирующие цвета из изображения (прозрачные пиксели игнорируются).
 * Уменьшаем до 64x64 — быстро и достаточно точно.
 */
export function extractPalette(source, k = 5) {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, S, S);
  const d = ctx.getImageData(0, 0, S, S).data;

  // грубая квантизация в кубы 32x32x32, затем слияние близких по OKLab
  const buckets = new Map();
  let total = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 140) continue;                       // фон вырезан — пропускаем
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const key = (r >> 5) * 64 + (g >> 5) * 8 + (b >> 5);
    let acc = buckets.get(key);
    if (!acc) buckets.set(key, acc = [0, 0, 0, 0]);
    acc[0] += r; acc[1] += g; acc[2] += b; acc[3]++;
    total++;
  }
  if (!total) return [];

  let list = [...buckets.values()]
    .map(a => ({ hex: rgbToHex(a[0] / a[3], a[1] / a[3], a[2] / a[3]), n: a[3] }))
    .sort((x, y) => y.n - x.n);

  const merged = [];
  for (const cand of list) {
    const near = merged.find(m => colorDist(m.hex, cand.hex) < 0.075);
    if (near) near.n += cand.n; else merged.push({ ...cand });
    if (merged.length >= k * 3) break;
  }
  return merged.slice(0, k).map(m => ({ hex: m.hex, ratio: +(m.n / total).toFixed(3) }));
}
