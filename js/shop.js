// Вкладка «Каталог»: демо-витрина онлайн-одежды (моковые данные, товары рисуются SVG).
// В реальном приложении здесь был бы запрос к API магазина.
import { fill, h, urlFor, openModal, toast, busy } from './ui.js';
import { state, saveItem, catById, emit } from './state.js';
import { uid } from './db.js';
import { BASE_COLORS, colorName, extractPalette, colorDist } from './color.js';
import { imageFromBlob } from './editor.js';

const SHAPES = {
  tshirt: { name: 'Футболка', cat: 'Верх', d: 'M60 30 L85 20 Q100 36 115 20 L140 30 L170 60 L150 82 L140 70 L140 180 L60 180 L60 70 L50 82 L30 60 Z' },
  sweater: { name: 'Свитер', cat: 'Верх', d: 'M60 30 L85 20 Q100 36 115 20 L140 30 L174 72 L152 142 L138 132 L140 182 L60 182 L62 132 L48 142 L26 72 Z' },
  shirt: { name: 'Рубашка', cat: 'Верх', d: 'M62 28 L88 18 L100 38 L112 18 L138 28 L170 62 L150 84 L140 72 L140 180 L60 180 L60 72 L50 84 L30 62 Z' },
  pants: { name: 'Брюки', cat: 'Низ', d: 'M65 22 H135 L143 186 H107 L100 106 L93 186 H57 Z' },
  skirt: { name: 'Юбка', cat: 'Низ', d: 'M64 38 H136 L162 176 Q100 168 38 176 Z', lines: ['M64 52 H136'] },
  dress: { name: 'Платье', cat: 'Платья', d: 'M70 26 L86 18 Q100 34 114 18 L130 26 L120 62 L148 182 H52 L80 62 Z' },
  jacket: {
    name: 'Куртка', cat: 'Верхняя одежда',
    d: 'M60 28 L88 18 L100 42 L112 18 L140 28 L170 64 L150 86 L140 74 V182 H60 V74 L50 86 L30 64 Z',
    lines: ['M88 18 L100 42 L112 18', 'M100 42 V182']
  },
  sneaker: { name: 'Кроссовки', cat: 'Обувь', d: 'M36 132 H92 L118 150 L162 160 Q174 163 174 174 H36 Z' },
  bag: {
    name: 'Сумка', cat: 'Аксессуары', d: 'M56 76 H144 L152 172 Q153 178 147 178 H53 Q47 178 48 172 Z',
    lines: ['M78 76 V62 a22 22 0 0 1 44 0 V76']
  }
};

const PALETTE = ['#28406e', '#d94f45', '#efe3cf', '#2f6d5a', '#4a4a4a', '#c1785c',
  '#d98fb0', '#ffffff', '#e9c94b', '#7b5ea7', '#8b5e3c', '#4b8fc4'];

const BRANDS = ['Aria', 'Norra', 'Lume', 'Sabo', 'Kova', 'Mirt'];

function makeCatalog() {
  const keys = Object.keys(SHAPES);
  const out = [];
  let n = 0;
  for (const k of keys) {
    for (let i = 0; i < 3; i++) {
      const color = PALETTE[(n * 5 + i * 3) % PALETTE.length];
      out.push({
        id: `${k}-${i}`,
        shape: k,
        color,
        name: `${SHAPES[k].name} ${colorName(color).toLowerCase()}`,
        cat: SHAPES[k].cat,
        brand: BRANDS[(n + i) % BRANDS.length],
        price: 1490 + ((n * 37 + i * 11) % 60) * 50
      });
      n++;
    }
  }
  return out;
}
export const CATALOG = makeCatalog();

function svgFor(p, size = 200) {
  const dark = p.color === '#ffffff' || p.color === '#efe3cf' ? '#00000022' : '#00000033';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="${size}" height="${size}">
    <path d="${SHAPES[p.shape].d}" fill="${p.color}" stroke="${dark}" stroke-width="3" stroke-linejoin="round"/>
    ${(SHAPES[p.shape].lines || []).map(d => `<path d="${d}" fill="none" stroke="${dark}" stroke-width="3" stroke-linecap="round"/>`).join('')}
  </svg>`;
}

async function svgToBlob(p) {
  const svg = svgFor(p, 600);
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  const img = await imageFromBlob(url);
  const c = document.createElement('canvas');
  c.width = 600; c.height = 600;
  c.getContext('2d').drawImage(img, 0, 0, 600, 600);
  return new Promise(res => c.toBlob(res, 'image/png'));
}

export async function addToCloset(p, silent = false) {
  busy(true, 'Добавляю в гардероб…');
  const blob = await svgToBlob(p);
  const cat = state.cats.find(c => c.name === p.cat) || state.cats[0];
  const sub = cat?.subs.find(s => s.name.toLowerCase().startsWith(SHAPES[p.shape].name.slice(0, 4).toLowerCase()));
  let colors = [];
  try { colors = extractPalette(await imageFromBlob(blob), 4); } catch (e) { }
  await saveItem({
    id: uid('it'), name: `${p.name} · ${p.brand}`, catId: cat?.id || null, subId: sub?.id || null,
    img: blob, colors, bg: 'none', fav: false, source: 'shop', createdAt: Date.now()
  });
  busy(false);
  if (!silent) toast('Добавлено в гардероб');
}

const filter = { cat: null, color: null };

function openProduct(p) {
  const modal = openModal({
    title: p.name,
    body: h('div', {},
      h('div', { class: 'tile', style: { aspectRatio: '1', background: '#f7f3ef' }, html: svgFor(p, 260) }),
      h('div', { class: 'lrow', style: { marginTop: '12px' } },
        h('div', { class: 't' }, h('b', {}, p.brand), h('span', {}, `${p.cat} · ${colorName(p.color)}`)),
        h('b', {}, `${p.price} ₽`))
    ),
    foot: [
      h('button', { class: 'btn primary', onclick: async () => { modal.close(); await addToCloset(p); } }, '＋ В гардероб'),
      h('button', {
        class: 'btn', onclick: async () => {
          modal.close(); await addToCloset(p);
          const { openOutfitEditor } = await import('./outfits.js');
          openOutfitEditor(null);
        }
      }, '👗 Примерить')
    ]
  });
}

export function renderShop(root) {
  const cats = [...new Set(CATALOG.map(p => p.cat))];
  const list = CATALOG.filter(p =>
    (!filter.cat || p.cat === filter.cat) &&
    (!filter.color || colorDist(p.color, filter.color) < 0.13));

  fill(root, 
    h('p', { class: 'muted small' }, 'Демо-витрина: товары можно примерить и добавить в свой гардероб.'),
    h('div', { class: 'chips' },
      h('button', { class: 'chip' + (!filter.cat ? ' active' : ''), onclick: () => { filter.cat = null; emit(); } }, 'Все'),
      ...cats.map(c => h('button', {
        class: 'chip' + (filter.cat === c ? ' active' : ''), onclick: () => { filter.cat = c; emit(); }
      }, c))),
    h('div', { class: 'palette-row' },
      BASE_COLORS.map(c => h('button', {
        class: 'swatch' + (filter.color === c.hex ? ' sel' : ''), style: { background: c.hex }, title: c.name,
        onclick: () => { filter.color = filter.color === c.hex ? null : c.hex; emit(); }
      }))),
    h('div', { class: 'row', style: { margin: '6px 2px' } },
      h('span', { class: 'small muted spacer' }, `${list.length} товаров`)),
    list.length ? h('div', { class: 'grid g2' }, list.map(p => h('div', {
      class: 'tile', style: { background: '#f7f3ef' }, onclick: () => openProduct(p)
    },
      h('div', { style: { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }, html: svgFor(p, 150) }),
      h('span', { class: 'lbl' }, `${p.brand} · ${p.price} ₽`)
    ))) : h('div', { class: 'empty' }, 'Ничего не найдено')
  );
}
