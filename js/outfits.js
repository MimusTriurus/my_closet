// Вкладка «Образы»: коллекции (Style Book), редактор образа на Konva, рандомайзер.
import { fill, h, qs, urlFor, toast, openModal, confirmDialog, promptDialog, actionSheet, busy } from './ui.js';
import { state, saveOutfit, deleteOutfit, saveCollection, deleteCollection, itemById, emit } from './state.js';
import { uid } from './db.js';
import { BGS, bgById, bgCss } from './bgs.js';
import { imageFromBlob } from './editor.js';
import { pickItems } from './picker.js';

const SW = 640, SH = 860;           // логический размер холста образа
export const outfitFilter = { collectionId: null };

const dataURLtoBlob = url => fetch(url).then(r => r.blob());

/* ---------- редактор образа ---------- */
export async function openOutfitEditor(existing) {
  const outfit = existing
    ? JSON.parse(JSON.stringify({ ...existing, preview: null }))
    : { id: uid('of'), name: '', collectionId: outfitFilter.collectionId, bg: 'cream', layers: [], createdAt: Date.now() };

  const host = h('div', { id: 'stage-host' });
  const toolbar = h('div', { class: 'tools' });
  const opts = h('div', { class: 'tool-opts' });

  const modal = openModal({
    title: existing ? 'Редактировать образ' : 'Новый образ',
    full: true,
    body: h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', margin: '-12px' } }, host, opts, toolbar),
    foot: [
      h('button', { class: 'btn', onclick: () => modal.close() }, 'Отмена'),
      h('button', { class: 'btn primary', onclick: save }, 'Сохранить')
    ],
    onClose: () => stage && stage.destroy()
  });

  await new Promise(r => setTimeout(r, 30));   // ждём вёрстку, чтобы знать размеры host

  const stage = new Konva.Stage({ container: host, width: SW, height: SH });
  const layer = new Konva.Layer();
  stage.add(layer);

  const bgRect = new Konva.Rect({ x: 0, y: 0, width: SW, height: SH, listening: false });
  layer.add(bgRect);
  applyBg(outfit.bg);

  const tr = new Konva.Transformer({
    rotateEnabled: true, keepRatio: true, borderStroke: '#c1785c', anchorStroke: '#c1785c',
    anchorSize: 14, enabledAnchors: ['top-left', 'top-right', 'bottom-left', 'bottom-right']
  });
  layer.add(tr);

  function fit() {
    const r = host.getBoundingClientRect();
    const s = Math.min(r.width / SW, r.height / SH) * 0.96;
    stage.width(SW * s); stage.height(SH * s); stage.scale({ x: s, y: s });
    stage.batchDraw();
    return s;
  }
  let viewScale = fit();
  const onResize = () => { viewScale = fit(); };
  window.addEventListener('resize', onResize);

  function applyBg(id) {
    outfit.bg = id;
    const b = bgById(id);
    if (b.colors.length > 1) {
      bgRect.fillPriority('linear-gradient');
      bgRect.fillLinearGradientStartPoint({ x: 0, y: 0 });
      bgRect.fillLinearGradientEndPoint({ x: SW, y: SH });
      bgRect.fillLinearGradientColorStops([0, b.colors[0], 1, b.colors[1]]);
    } else {
      bgRect.fillPriority('color');
      bgRect.fill(b.colors[0]);
    }
    layer.batchDraw();
  }

  stage.on('pointerdown', e => {
    if (e.target === stage || e.target === bgRect) tr.nodes([]);
    else if (e.target.getClassName() === 'Image') tr.nodes([e.target]);
    layer.batchDraw();
  });

  async function addItemNode(itemId, pose) {
    const it = itemById(itemId);
    if (!it) return null;
    const img = await imageFromBlob(it.img);
    const natural = Math.max(img.naturalWidth, img.naturalHeight);
    const target = SH * 0.34;
    const base = target / natural;
    const node = new Konva.Image({
      image: img, draggable: true,
      offsetX: img.naturalWidth / 2, offsetY: img.naturalHeight / 2,
      x: pose?.x ?? SW / 2, y: pose?.y ?? SH / 2,
      scaleX: pose?.scaleX ?? base, scaleY: pose?.scaleY ?? base,
      rotation: pose?.rotation ?? 0,
      shadowColor: 'rgba(0,0,0,.25)', shadowBlur: 18, shadowOffsetY: 6, shadowOpacity: .5
    });
    node.setAttr('itemId', itemId);
    layer.add(node);
    tr.moveToTop();
    layer.batchDraw();
    return node;
  }

  // восстановление сохранённого образа
  for (const l of outfit.layers) await addItemNode(l.itemId, l);

  async function addItems() {
    const ids = await pickItems({ title: 'Добавить в образ' });
    if (!ids || !ids.length) return;
    let i = 0;
    for (const id of ids) {
      const n = await addItemNode(id, { x: SW / 2 + (i % 2 ? 70 : -70), y: SH * (0.25 + 0.22 * Math.floor(i / 2)) });
      i++;
      if (n) tr.nodes([n]);
    }
    layer.batchDraw();
  }

  async function randomize() {
    const byCat = new Map();
    for (const it of state.items) {
      if (!it.catId) continue;
      if (!byCat.has(it.catId)) byCat.set(it.catId, []);
      byCat.get(it.catId).push(it);
    }
    if (!byCat.size) return toast('Сначала добавьте вещи');
    layer.find('Image').forEach(n => n.destroy());
    tr.nodes([]);
    const cats = [...byCat.keys()].sort(() => Math.random() - .5).slice(0, 3);
    let i = 0;
    for (const c of cats) {
      const pool = byCat.get(c);
      const it = pool[Math.floor(Math.random() * pool.length)];
      await addItemNode(it.id, { y: SH * (0.22 + 0.27 * i), x: SW / 2 });
      i++;
    }
    layer.batchDraw();
    toast('Случайный образ');
  }

  function selected() { return tr.nodes()[0] || null; }

  const TOOLS = [
    { ic: '➕', label: 'Вещи', fn: addItems },
    { ic: '🎨', label: 'Фон', fn: () => showBgPicker() },
    { ic: '🎲', label: 'Случайно', fn: randomize },
    { ic: '⬆️', label: 'Выше', fn: () => { selected()?.moveUp(); tr.moveToTop(); layer.batchDraw(); } },
    { ic: '⬇️', label: 'Ниже', fn: () => { const n = selected(); if (n) { n.moveDown(); if (n.zIndex() < 1) n.zIndex(1); } layer.batchDraw(); } },
    { ic: '🗑', label: 'Убрать', fn: () => { const n = selected(); if (n) { n.destroy(); tr.nodes([]); layer.batchDraw(); } } }
  ];
  fill(toolbar, ...TOOLS.map(t =>
    h('button', { class: 'tool', onclick: t.fn }, h('span', { class: 'ic' }, t.ic), h('span', {}, t.label))));

  function showBgPicker() {
    fill(opts, h('div', { class: 'palette-row' }, BGS.map(b =>
      h('button', {
        class: 'swatch' + (outfit.bg === b.id ? ' sel' : ''),
        style: { background: b.css },
        onclick: e => { applyBg(b.id); [...e.currentTarget.parentNode.children].forEach(x => x.classList.remove('sel')); e.currentTarget.classList.add('sel'); }
      })
    )));
  }
  fill(opts, h('div', { class: 'muted small' }, 'Тапните вещь, чтобы двигать, вращать и менять размер.'));

  async function save() {
    const nodes = layer.find('Image');
    if (!nodes.length) return toast('Добавьте хотя бы одну вещь');
    outfit.layers = nodes.map(n => ({
      itemId: n.getAttr('itemId'), x: n.x(), y: n.y(),
      scaleX: n.scaleX(), scaleY: n.scaleY(), rotation: n.rotation()
    }));
    tr.nodes([]); layer.batchDraw();
    busy(true, 'Сохраняю образ…');
    const url = stage.toDataURL({ pixelRatio: 1 / viewScale });
    outfit.preview = await dataURLtoBlob(url);
    if (!outfit.name) {
      outfit.name = await promptDialog('Название образа', '', 'Например, «Офис, вторник»') || 'Образ';
    }
    await saveOutfit(outfit);
    busy(false);
    window.removeEventListener('resize', onResize);
    modal.close();
    toast('Образ сохранён');
  }
}

/* ---------- карточка образа ---------- */
function openOutfitCard(o) {
  const modal = openModal({
    title: o.name || 'Образ',
    body: h('div', {},
      h('div', { class: 'tile', style: { aspectRatio: '3/4', background: bgCss(o.bg) } }, h('img', { src: urlFor(o.preview) })),
      h('div', { class: 'section-title' }, 'Вещи в образе'),
      h('div', { class: 'grid' }, o.layers.map(l => {
        const it = itemById(l.itemId);
        return it ? h('div', { class: 'tile', style: { background: bgCss(it.bg) } }, h('img', { src: urlFor(it.img) })) : null;
      }))
    ),
    foot: [
      h('button', {
        class: 'btn', onclick: async () => {
          const cid = await pickCollection();
          if (cid !== undefined) { o.collectionId = cid; await saveOutfit(o); toast('Перемещено'); modal.close(); }
        }
      }, '📚 В коллекцию'),
      h('button', { class: 'btn', onclick: () => { modal.close(); openOutfitEditor(o); } }, '✎ Изменить'),
      h('button', {
        class: 'btn danger', onclick: async () => {
          if (await confirmDialog('Удалить образ?')) { await deleteOutfit(o.id); modal.close(); }
        }
      }, '🗑')
    ]
  });
}

function pickCollection() {
  return new Promise(res => {
    let done = false;
    const modal = openModal({
      title: 'Коллекция',
      body: h('div', { class: 'list' },
        h('button', { class: 'btn block', onclick: () => { done = true; modal.close(); res(null); } }, 'Без коллекции'),
        ...state.collections.map(c => h('button', {
          class: 'btn block', onclick: () => { done = true; modal.close(); res(c.id); }
        }, c.name)),
        h('button', {
          class: 'btn block primary', onclick: async () => {
            const n = await promptDialog('Новая коллекция');
            if (!n) return;
            const c = await saveCollection({ id: uid('col'), name: n, createdAt: Date.now() });
            done = true; modal.close(); res(c.id);
          }
        }, '+ Новая коллекция')),
      onClose: () => { if (!done) res(undefined); }
    });
  });
}

/* ---------- рендер вкладки ---------- */
export function renderOutfits(root) {
  const chips = h('div', { class: 'chips' },
    h('button', {
      class: 'chip' + (!outfitFilter.collectionId ? ' active' : ''),
      onclick: () => { outfitFilter.collectionId = null; emit(); }
    }, 'Все', h('span', { class: 'cnt' }, state.outfits.length)),
    ...state.collections.map(c => h('button', {
      class: 'chip' + (outfitFilter.collectionId === c.id ? ' active' : ''),
      onclick: () => { outfitFilter.collectionId = c.id; emit(); },
      oncontextmenu: async e => {
        e.preventDefault();
        if (await confirmDialog(`Удалить коллекцию «${c.name}»?`)) { await deleteCollection(c.id); }
      }
    }, `📚 ${c.name}`, h('span', { class: 'cnt' }, state.outfits.filter(o => o.collectionId === c.id).length))),
    h('button', {
      class: 'chip', onclick: async () => {
        const n = await promptDialog('Новая коллекция');
        if (n) await saveCollection({ id: uid('col'), name: n, createdAt: Date.now() });
      }
    }, '+')
  );

  const list = state.outfits.filter(o => !outfitFilter.collectionId || o.collectionId === outfitFilter.collectionId);

  const grid = list.length ? h('div', { class: 'grid g2' },
    list.map(o => h('div', {
      class: 'tile', style: { background: bgCss(o.bg) }, onclick: () => openOutfitCard(o)
    }, h('img', { src: urlFor(o.preview) }), h('span', { class: 'lbl' }, o.name || 'Образ')))
  ) : h('div', { class: 'empty' },
    h('div', { class: 'big' }, '👗'),
    h('p', {}, 'Образов пока нет'),
    h('button', { class: 'btn primary', onclick: () => openOutfitEditor(null) }, 'Собрать образ'));

  fill(root, chips, grid,
    h('button', { class: 'fab', onclick: () => openOutfitEditor(null) }, '+'));
}
