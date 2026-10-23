// Вкладка «Образы»: папки с категориями, редактор образа на Konva, рандомайзер.
import {
  fill, h, qs, urlFor, toast, openModal, confirmDialog, promptDialog, actionSheet, busy,
  plural, nItems, nOutfits
} from './ui.js';
import {
  state, saveOutfit, deleteOutfit, outfitById, itemById, visibleItems, emit,
  catById, subById, outfitCats, countInOutfitCat, SCOPE_OUTFIT,
  outfitItems, archivedInOutfit
} from './state.js';
import { uid } from './db.js';
import { BGS, bgById, bgCss } from './bgs.js';
import { imageFromBlob } from './editor.js';
import { pickItems } from './picker.js';
import { openCategoryManager, openSubManager } from './cats.js';
import { OTHER, navRow, collageThumb, itemLabel, openItemCard } from './closet.js';

const SW = 640, SH = 860;           // логический размер холста образа

const dataURLtoBlob = url => fetch(url).then(r => r.blob());

/* ---------- редактор образа ---------- */
export async function openOutfitEditor(existing, isCopy = false) {
  const outfit = existing
    ? JSON.parse(JSON.stringify({ ...existing, preview: null }))
    : {
      id: uid('of'), name: '', bg: 'cream', layers: [], createdAt: Date.now(),
      // образ ложится в ту папку, из которой его начали собирать
      catId: nav.catId === OTHER ? null : nav.catId, subId: nav.subId === OTHER ? null : nav.subId
    };

  const host = h('div', { id: 'stage-host' });
  const toolbar = h('div', { class: 'tools' });
  const opts = h('div', { class: 'tool-opts' });

  // редактор отдаёт сохранённый образ наружу: календарю нужно положить
  // на день именно копию, которую пользователь только что собрал
  let settle;
  const done = new Promise(r => { settle = r; });

  const modal = openModal({
    title: !existing || isCopy ? 'Новый образ' : 'Редактировать образ',
    full: true,
    body: h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', margin: '-12px' } }, host, opts, toolbar),
    onClose: () => settle(saved),
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

  /**
   * Лист вписывается в свободную область и прижат к её верху: пустое место
   * внизу пригодится под инструменты, а сверху оно только отодвигало бы
   * работу от глаз. PAD — поле вокруг листа, одинаковое сверху и с боков.
   */
  const PAD = 10;
  function fit() {
    const r = host.getBoundingClientRect();
    const s = Math.min((r.width - PAD * 2) / SW, (r.height - PAD * 2) / SH);
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

  /**
   * Касание вещи поднимает её наверх — как со свитером поверх футболки:
   * что тронул последним, то и сверху. Стрелки «выше/ниже» этого не давали:
   * порядок приходилось набирать по шагу, да ещё и несимметрично — рамка
   * выделения живёт в том же списке слоёв и сбивала счёт.
   *
   * Цена: подвинув вещь, лежащую сзади, её поднимешь, даже если не хотел.
   * Исправляется касанием соседней вещи и совпадает с тем, как одеваются.
   */
  stage.on('pointerdown', e => {
    if (e.target === stage || e.target === bgRect) tr.nodes([]);
    else if (e.target.getClassName() === 'Image') {
      tr.nodes([e.target]);
      e.target.moveToTop();
      tr.moveToTop();
    }
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
    // пока за кнопкой случайный подбор, и он стирает лист. Молча этого
    // делать нельзя: собранное руками дороже случайного
    if (layer.find('Image').length &&
      !await confirmDialog('Собрать случайный образ? Всё, что на листе, будет убрано.', 'Собрать')) return;
    const byCat = new Map();
    for (const it of visibleItems()) {
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
    // название на вырост: кнопка должна собирать вещи по фильтру (например,
    // все синие и красные — проверить сочетаемость). Пока за ним случайный
    // подбор, поэтому он и спрашивает, прежде чем стереть собранное
    { ic: '🎯', label: 'По фильтру', fn: randomize },
    // одна кнопка вместо двух стрелок: наверх поднимает касание, а вниз
    // пальцем не покажешь — для этого и кнопка
    {
      ic: '⤓', label: 'Под низ', fn: () => {
        const n = selected();
        if (!n) return toast('Сначала выберите вещь');
        n.zIndex(1);          // 1, а не 0: под нулём лежит фон листа
        tr.moveToTop();
        layer.batchDraw();
      }
    },
    { ic: '🗑', label: 'Убрать', fn: () => { const n = selected(); if (n) { n.destroy(); tr.nodes([]); layer.batchDraw(); } } }
  ];
  fill(toolbar, ...TOOLS.map(t =>
    h('button', { class: 'tool', onclick: t.fn }, h('span', { class: 'ic' }, t.ic), h('span', {}, t.label))));

  // Палитра стоит на месте всегда. Раньше её показывала кнопка «Фон», но
  // показанная однажды, она оставалась насовсем и вытесняла подсказку —
  // кнопка после этого выглядела ничего не делающей. Места хватает обеим
  fill(opts,
    h('div', { class: 'row', style: { gap: '8px', marginBottom: '2px' } },
      h('span', { class: 'section-title spacer', style: { margin: '0' } }, 'Фон листа'),
      h('span', { class: 'muted small' }, 'касание поднимает вещь наверх')),
    h('div', { class: 'palette-row' }, BGS.map(b =>
      h('button', {
        class: 'swatch' + (outfit.bg === b.id ? ' sel' : ''),
        style: { background: b.css },
        onclick: e => {
          applyBg(b.id);
          [...e.currentTarget.parentNode.children].forEach(x => x.classList.remove('sel'));
          e.currentTarget.classList.add('sel');
        }
      })
    )));

  let saved = null;

  async function save() {
    const nodes = layer.find('Image');
    if (!nodes.length) return toast('Добавьте хотя бы одну вещь');
    outfit.layers = nodes.map(n => ({
      itemId: n.getAttr('itemId'), x: n.x(), y: n.y(),
      scaleX: n.scaleX(), scaleY: n.scaleY(), rotation: n.rotation()
    }));
    tr.nodes([]); layer.batchDraw();

    // Названия здесь не спрашиваем. Оно необязательно и правится в карточке,
    // а запрос показывался из-под «занято»: окно было видно, но недоступно —
    // приложение выглядело зависшим.
    busy(true, 'Сохраняю образ…');
    try {
      const url = stage.toDataURL({ pixelRatio: 1 / viewScale });
      outfit.preview = await dataURLtoBlob(url);
      await saveOutfit(outfit);
      saved = outfit;
    } catch (e) {
      console.error(e);
      toast('Не удалось сохранить образ');
      return;
    } finally {
      busy(false);          // что бы ни случилось, экран не остаётся занятым
    }
    window.removeEventListener('resize', onResize);
    modal.close();
    toast('Образ сохранён');
  }

  return done;
}

/* ---------- пространство категорий образов ---------- */
/**
 * Третье пространство категорий — своё, отдельное и от гардеробных,
 * и от архивных. Механизм общий, отличаются только списки и счётчики.
 */
const outfitSpace = {
  scope: SCOPE_OUTFIT,
  title: 'Категории образов',
  cats: () => outfitCats(),
  n: nOutfits,
  thumb: c => previewOf(latestOutfit(c.id, null)),
  countSub: (cat, subId) => state.outfits.filter(o => o.subId === subId).length,
  detachSub: async subId => {
    for (const o of state.outfits.filter(x => x.subId === subId)) {
      o.subId = null;
      await saveOutfit(o);
    }
  },
  moveHint: 'Перенесите их в другую категорию — после этого её можно будет удалить.'
};

/* ---------- навигация по папкам ---------- */
/**
 * Устроено как «Гардероб»: список категорий → подкатегории → образы.
 * «Другое» появляется само, когда в категории есть образы без подкатегории.
 */
export const nav = { all: false, catId: null, subId: null, outfitId: null };

const goRoot = () => { nav.all = false; nav.catId = null; nav.subId = null; nav.outfitId = null; emit(); };
const openCat = id => { nav.catId = id; nav.subId = null; emit(); };
const catOf = id => outfitCats().find(c => c.id === id) || null;

/** Образы раздела. Ссылка на удалённую подкатегорию считается отсутствующей. */
function outfitsIn(catId, subId) {
  const want = catId === OTHER ? null : catId;
  const subs = new Set((catOf(want)?.subs || []).map(s => s.id));
  const subOf = o => (subs.has(o.subId) ? o.subId : null);
  return state.outfits
    .filter(o => (o.catId || null) === want
      && (subId == null || (subId === OTHER ? !subOf(o) : subOf(o) === subId)))
    .sort((a, b) => b.createdAt - a.createdAt);
}
const latestOutfit = (catId, subId) => outfitsIn(catId, subId)[0] || null;

export function outfitsNav() {
  if (nav.outfitId) {
    const o = outfitById(nav.outfitId);
    if (o) return { title: o.name || 'Образ', back: closeCard };
  }
  if (nav.all) return { title: 'Все образы', back: goRoot };
  // «Другое» — не настоящая категория, своего заголовка у неё иначе не будет
  if (nav.catId === OTHER) return { title: 'Другое', back: goRoot };
  const cat = catOf(nav.catId);
  if (!cat) return null;
  if (!nav.subId) {
    return {
      title: cat.name, back: goRoot,
      action: { icon: '📂', title: 'Подкатегории', onclick: () => openSubManager(outfitSpace, cat, emit) }
    };
  }
  const name = nav.subId === OTHER ? 'Другое' : cat.subs.find(s => s.id === nav.subId)?.name;
  return { title: name || cat.name, back: () => { nav.subId = null; emit(); } };
}

/* ---------- карточка образа ---------- */
const closeCard = () => { nav.outfitId = null; emit(); };

/**
 * Называем архивные вещи по производителю — но только те, у кого он есть.
 * Иначе в строку попадала бы гардеробная категория вроде «Сортировка»,
 * и выходило бы «в архиве: Сортировка».
 */
function goneText(gone) {
  const named = gone.filter(i => i.brandId).map(itemLabel);
  return `${nItems(gone.length)} из этого образа в архиве`
    + (named.length === gone.length ? `: ${named.join(', ')}` : '');
}

const previewOf = o => o
  ? h('img', { class: 'thumb', src: urlFor(o.preview), style: { background: bgCss(o.bg) } })
  : h('div', { class: 'thumb ph' });

function renderOutfitCard(root, o) {
  const items = outfitItems(o);
  const gone = archivedInOutfit(o);
  const cat = catById(o.catId);
  const place = [cat?.name, subById(o.catId, o.subId)?.name].filter(Boolean).join(' › ') || 'Без категории';

  fill(root,
    h('div', { class: 'card-photo tall', style: { background: bgCss(o.bg) } },
      h('img', { src: urlFor(o.preview), alt: o.name || 'Образ' })),

    // название образа больше негде поменять: редактор спрашивает его только
    // один раз, при первом сохранении
    h('div', { class: 'lrow' },
      h('div', { class: 't' },
        h('b', { class: o.name ? '' : 'muted' }, o.name || 'без названия'),
        h('span', {}, place)),
      h('button', {
        class: 'btn btn-sm', title: 'Название', onclick: async () => {
          const n = await promptDialog('Название образа', o.name || '', 'Название', true);
          if (n === null) return;
          o.name = n;
          await saveOutfit(o);
        }
      }, '✎')),

    // вещь, ушедшая в архив, образ не портит — но знать об этом нужно до того,
    // как образ попадёт в календарь и добавит ей носку, которой не было
    gone.length ? h('p', { class: 'warn-line' }, goneText(gone)) : null,

    h('div', { class: 'section-title' }, 'Вещи в образе'),
    items.length ? h('div', { class: 'grid' }, items.map(it => h('div', {
      class: 'tile' + (it.archived ? ' gone' : ''), style: { background: bgCss(it.bg) },
      onclick: () => { closeCard(); openItemCard(it); }
    }, h('img', { src: urlFor(it.img) }))))
      : h('p', { class: 'muted small' }, 'Вещей из гардероба в образе не осталось.'),

    h('div', { class: 'card-actions' },
      h('button', {
        class: 'btn', onclick: async () => {
          const dest = await pickOutfitPlace();
          if (!dest) return;
          o.catId = dest.catId; o.subId = dest.subId;
          await saveOutfit(o);
          toast('Перемещено');
        }
      }, '📂 В категорию'),
      h('button', { class: 'btn', onclick: () => copyOutfit(o) }, '⧉ Копия'),
      h('button', { class: 'btn', onclick: () => openOutfitEditor(o) }, '✎ Изменить'),
      h('button', { class: 'btn danger', onclick: () => removeOutfit(o) }, '🗑')
    )
  );
  root.style.paddingBottom = '';
}

/* ---------- копия и удаление ---------- */
/**
 * Копия — не удобство, а необходимость: вариант с другой обувью это
 * отдельный образ, и собирать его с нуля никто не станет. Копия сразу
 * открывается в редакторе и сама не сохраняется.
 */
export function copyOutfit(o, drop = []) {
  const copy = {
    ...JSON.parse(JSON.stringify({ ...o, preview: null })),
    id: uid('of'),
    name: o.name ? o.name + ' — копия' : '',
    createdAt: Date.now()
  };
  if (drop.length) copy.layers = copy.layers.filter(l => !drop.includes(l.itemId));
  nav.outfitId = null;
  return openOutfitEditor(copy, true);
}

async function removeOutfit(o) {
  const days = state.calendar.filter(d => (d.outfitIds || []).includes(o.id)).length;
  const text = days
    ? `Образ использован в ${plural(days, 'дне', 'днях', 'днях')} календаря. Удалить вместе с записями?`
    : 'Удалить образ?';
  if (!await confirmDialog(text)) return;
  closeCard();
  await deleteOutfit(o.id);
  toast(days ? 'Образ и записи удалены' : 'Образ удалён');
}

/** Куда положить образ: категория и подкатегория, обе необязательны. */
function pickOutfitPlace() {
  return new Promise(res => {
    let done = false;
    const body = h('div', { class: 'list' });
    const modal = openModal({ title: 'Куда положить', body, onClose: () => { if (!done) res(null); } });
    const finish = v => { done = true; res(v); modal.close(); };

    function render(cat) {
      if (!cat) {
        return fill(body,
          ...outfitCats().map(c => h('div', {
            class: 'lrow nav', onclick: () => c.subs.length ? render(c) : finish({ catId: c.id, subId: null })
          }, h('div', { class: 't' }, h('b', {}, c.name)), h('span', { class: 'chev' }, '›'))),
          h('div', {
            class: 'lrow nav soft', onclick: () => finish({ catId: null, subId: null })
          }, h('div', { class: 't' }, h('b', {}, 'Без категории'))),
          outfitCats().length ? null : h('p', { class: 'muted small' }, 'Категорий ещё нет.')
        );
      }
      fill(body,
        h('div', {
          class: 'lrow nav', onclick: () => finish({ catId: cat.id, subId: null })
        }, h('div', { class: 't' }, h('b', {}, cat.name), h('span', {}, 'без подкатегории'))),
        ...cat.subs.map(s => h('div', {
          class: 'lrow nav', onclick: () => finish({ catId: cat.id, subId: s.id })
        }, h('div', { class: 't' }, h('b', {}, s.name))))
      );
    }
    render(null);
  });
}

/**
 * Образ с архивной вещью на сегодня или вперёд — почти наверняка ошибка:
 * надеть проданное нельзя, а счётчик носок у архивной вещи вырастет на
 * носку, которой не было. На прошедший день не спрашиваем: тогда вещь ещё
 * была, и это самый частый законный случай.
 */
export function askArchivedInDay(o, gone) {
  return new Promise(res => {
    let answered = false;
    const modal = openModal({
      title: 'В образе вещь из архива',
      body: h('div', {},
        h('p', { style: { margin: '2px 0 10px' } },
          `В образе «${o.name || 'Образ'}» ${goneText(gone).replace('из этого образа ', '')}.`),
        h('p', { class: 'muted small', style: { margin: '0 0 4px' } },
          'Если вы надели другую вещь вместо неё, соберите копию образа — иначе '
          + 'носка достанется той, что лежит в архиве.')),
      foot: [
        h('button', {
          class: 'btn primary', onclick: () => { answered = true; res('copy'); modal.close(); }
        }, '⧉ Собрать копию'),
        h('button', {
          class: 'btn quiet', onclick: () => { answered = true; res('keep'); modal.close(); }
        }, 'Всё равно добавить')
      ],
      onClose: () => { if (!answered) res(null); }
    });
  });
}

/* ---------- рендер вкладки ---------- */
const outfitTile = o => {
  const gone = archivedInOutfit(o).length;
  return h('div', {
    class: 'tile' + (gone ? ' has-gone' : ''), style: { background: bgCss(o.bg) },
    onclick: () => { nav.outfitId = o.id; emit(); }
  },
    h('img', { src: urlFor(o.preview) }),
    gone ? h('span', { class: 'gone-mark', title: 'В образе есть вещь из архива' }, '◷') : null,
    h('span', { class: 'lbl' }, o.name || 'Образ')
  );
};

function outfitGrid(root, list, emptyText) {
  fill(root,
    h('div', { class: 'row', style: { margin: '2px 0 8px' } },
      h('span', { class: 'small muted spacer' }, nOutfits(list.length))),
    list.length ? h('div', { class: 'grid g2' }, list.map(outfitTile)) : h('div', { class: 'empty' },
      h('div', { class: 'big' }, '👗'),
      h('p', {}, emptyText)),
    h('button', { class: 'fab', onclick: () => openOutfitEditor(null), title: 'Собрать образ' }, '+')
  );
  root.style.paddingBottom = '';
}

function renderOutfitRoot(root) {
  const cats = outfitCats().sort((a, b) => a.order - b.order);
  const loose = outfitsIn(OTHER, null).length;

  fill(root,
    h('div', { class: 'list' },
      navRow({
        thumbNode: collageThumb(state.outfits, o => o.preview), title: 'Все образы',
        note: nOutfits(state.outfits.length),
        onclick: () => { nav.all = true; emit(); }
      }),
      ...cats.map(c => navRow({
        thumbNode: previewOf(latestOutfit(c.id, null)), title: c.name,
        note: nOutfits(countInOutfitCat(c.id))
          + (c.subs.length ? ' · ' + plural(c.subs.length, 'подкатегория', 'подкатегории', 'подкатегорий') : ''),
        onclick: () => openCat(c.id)
      })),
      loose ? navRow({
        thumbNode: previewOf(latestOutfit(OTHER, null)), title: 'Другое', muted: true,
        note: nOutfits(loose) + ' без категории',
        onclick: () => openCat(OTHER)
      }) : null
    ),
    h('button', {
      class: 'btn block ghost', style: { marginTop: '14px' },
      onclick: () => openCategoryManager(outfitSpace)
    }, '⚙️ Категории образов'),
    h('button', { class: 'fab', onclick: () => openOutfitEditor(null), title: 'Собрать образ' }, '+')
  );
  root.style.paddingBottom = '';
}

function renderCat(root, cat) {
  const loose = outfitsIn(cat.id, OTHER).length;
  fill(root,
    h('div', { class: 'list' },
      ...cat.subs.map(s => navRow({
        thumbNode: previewOf(latestOutfit(cat.id, s.id)), title: s.name,
        note: nOutfits(outfitsIn(cat.id, s.id).length),
        onclick: () => { nav.subId = s.id; emit(); }
      })),
      loose ? navRow({
        thumbNode: previewOf(latestOutfit(cat.id, OTHER)), title: 'Другое', muted: true,
        note: nOutfits(loose) + ' без подкатегории',
        onclick: () => { nav.subId = OTHER; emit(); }
      }) : null
    ),
    h('button', { class: 'fab', onclick: () => openOutfitEditor(null), title: 'Собрать образ' }, '+')
  );
  root.style.paddingBottom = '';
}

export function renderOutfits(root) {
  if (nav.outfitId) {
    const o = outfitById(nav.outfitId);
    if (o) return renderOutfitCard(root, o);
    nav.outfitId = null;
  }
  if (nav.all) return outfitGrid(root, state.outfits, 'Образов пока нет. Нажмите «+» внизу справа.');

  if (nav.catId === OTHER) {
    const loose = outfitsIn(OTHER, null);
    if (!loose.length) { nav.catId = null; return renderOutfitRoot(root); }
    return outfitGrid(root, loose, 'Здесь пусто.');
  }
  const cat = catOf(nav.catId);
  if (!cat) { nav.catId = null; nav.subId = null; return renderOutfitRoot(root); }

  if (!nav.subId) {
    return cat.subs.length
      ? renderCat(root, cat)
      : outfitGrid(root, outfitsIn(cat.id), `В категории «${cat.name}» пока пусто.`);
  }
  const list = outfitsIn(cat.id, nav.subId);
  if (nav.subId === OTHER && !list.length) { nav.subId = null; return renderCat(root, cat); }
  outfitGrid(root, list, 'Здесь пусто.');
}
