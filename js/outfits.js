// Вкладка «Образы»: папки с категориями, редактор образа на Konva, рандомайзер.
import {
  fill, h, qs, urlFor, toast, openModal, confirmDialog, promptDialog, actionSheet, busy,
  plural, nItems, nOutfits, goTab
} from './ui.js';
import {
  state, saveOutfit, deleteOutfit, outfitById, itemById, visibleItems, emit,
  catById, subById, outfitCats, countInOutfitCat, SCOPE_OUTFIT, listItems,
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
      id: uid('of'), name: '', bg: 'none', layers: [], createdAt: Date.now(),
      // образ ложится в ту папку, из которой его начали собирать
      catId: onav.catId === OTHER ? null : onav.catId, subId: onav.subId === OTHER ? null : onav.subId
    };

  const host = h('div', { id: 'stage-host' });
  const toolbar = h('div', { class: 'tools' });
  /**
   * Подсказки живут в отдельном окне, а не на экране редактора: все сразу
   * они занимали треть высоты листа, а лист здесь — главное. Кнопка рядом
   * с палитрой: там есть место и её видно, не заслоняя работу.
   */
  const HINTS = [
    'Нажмите «Вещи», чтобы добавить вещь на лист',
    'Коснитесь вещи, чтобы переместить её на верхний слой',
    'Коснитесь верхней вещи и нажмите «На нижний слой», чтобы перенести верхнюю вещь на нижний слой',
    'Удерживайте вещь пальцем, чтобы сместить',
    'Удерживайте вещь за уголки и смещайте пальцы, чтобы менять размер и поворот',
    'Или возьмите вещь двумя пальцами: разводите — крупнее, сводите — мельче, поворачивайте — наклон',
    'Коснитесь вещи и нажмите «Убрать», чтобы убрать её с листа — в гардеробе вещь останется'
  ];
  const openHints = () => openModal({
    title: 'Подсказки',
    body: h('ul', { class: 'hint-list' }, HINTS.map(t => h('li', {}, t)))
  });

  // редактор отдаёт сохранённый образ наружу: календарю нужно положить
  // на день именно копию, которую пользователь только что собрал
  let settle;
  const done = new Promise(r => { settle = r; });

  const modal = openModal({
    title: !existing || isCopy ? 'Новый образ' : 'Редактировать образ',
    full: true,
    body: h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', margin: '-12px' } },
      host, toolbar),
    foot: [
      h('button', { class: 'btn', onclick: () => modal.close() }, 'Отмена'),
      h('button', { class: 'btn primary', onclick: save }, 'Сохранить')
    ],
    // один обработчик на оба дела. Их было два, и второй молча затирал
    // первый: редактор не отвечал тому, кто его открыл, и `await` на нём
    // ждал вечно — так зависал разбор дня в календаре
    onClose: () => { if (stage) stage.destroy(); settle(saved); }
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
    // сначала даём области растянуться, чтобы узнать, сколько места есть,
    // а потом ужимаем её по листу — иначе пустота оставалась бы между
    // листом и инструментами, то есть ровно там, где мешает
    host.style.flex = '1';
    host.style.height = '';
    const r = host.getBoundingClientRect();
    const s = Math.min((r.width - PAD * 2) / SW, (r.height - PAD * 2) / SH);
    stage.width(SW * s); stage.height(SH * s); stage.scale({ x: s, y: s });
    host.style.flex = 'none';
    host.style.height = SH * s + PAD * 2 + 'px';
    stage.batchDraw();
    return s;
  }
  let viewScale = fit();   // предварительный: окончательный — ниже, см. fit()
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

  /**
   * Подбор по цвету. Из всего, чем вещь описана, для образа важен только
   * цвет: производитель и материал сочетаемости не определяют.
   *
   * Лист не стирается и ничего не выбирается за человека — отобранное
   * уходит в обычный выбор вещей, где видно, что берёшь. Прежний случайный
   * подбор делал обратное: стирал собранное и ставил три случайные вещи.
   */
  async function addByColor() {
    // цвета, за которыми ничего не стоит, предлагать незачем: такой выбор
    // ведёт в пустую сетку
    const pool = visibleItems();
    const colors = listItems('colors')
      .map(c => ({ ...c, n: pool.filter(i => (i.colorIds || []).includes(c.id)).length }))
      .filter(c => c.n);
    if (!colors.length) {
      return toast('Цвета у вещей ещё не отмечены — их ставят в карточке вещи', 3600);
    }

    const picked = new Set();
    const count = () => pool.filter(i => (i.colorIds || []).some(id => picked.has(id))).length;
    const goBtn = h('button', { class: 'btn primary', disabled: true }, 'Выбрать вещи');
    const grid = h('div', { class: 'color-pick' });

    const render = () => {
      fill(grid, ...colors.map(c => h('button', {
        class: 'color-opt' + (picked.has(c.id) ? ' sel' : ''),
        onclick: () => { picked.has(c.id) ? picked.delete(c.id) : picked.add(c.id); render(); }
      },
        h('span', { class: 'dot', style: { background: c.hex } }),
        h('b', {}, c.name),
        h('span', { class: 'muted small' }, nItems(c.n))
      )));
      const n = count();
      goBtn.disabled = !n;
      goBtn.textContent = n ? `Выбрать вещи · ${n}` : 'Выбрать вещи';
    };
    render();

    const m = openModal({
      title: 'Подбор по цвету',
      body: [
        h('p', { class: 'hint-top' }, 'Отметьте цвета — покажем вещи, в которых они есть.'),
        grid
      ],
      foot: [h('button', { class: 'btn', onclick: () => m.close() }, 'Отмена'), goBtn]
    });

    goBtn.onclick = async () => {
      const list = pool.filter(i => (i.colorIds || []).some(id => picked.has(id)));
      m.close();
      const ids = await pickItems({ title: 'Вещи по цвету', pool: list });
      if (!ids || !ids.length) return;
      let i = 0;
      for (const id of ids) {
        const n = await addItemNode(id, {
          x: SW / 2 + (i % 2 ? 70 : -70), y: SH * (0.25 + 0.22 * Math.floor(i / 2))
        });
        i++;
        if (n) tr.nodes([n]);
      }
      layer.batchDraw();
    };
  }

  function selected() { return tr.nodes()[0] || null; }

  /* ---------- два пальца: размер и поворот ----------
   * На телефоне тянуть за уголок — приём с компьютера: он требует точного
   * попадания и делает одно действие за раз. Привычнее развести пальцы.
   * Konva сама такого не умеет, поэтому считаем по двум касаниям: во
   * сколько раз изменилось расстояние — во столько же масштаб, на сколько
   * повернулась линия между пальцами — на столько же вещь. Середина между
   * пальцами тащит вещь за собой, иначе она уезжает из-под рук.
   *
   * Уголки остаются: мышью иначе не повернуть, да и пальцем бывает нужна
   * точность.
   */
  let grab = null;
  const toStage = t => {
    const r = stage.container().getBoundingClientRect();
    return { x: (t.clientX - r.left) / viewScale, y: (t.clientY - r.top) / viewScale };
  };
  const gap = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  const tilt = (a, b) => Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;

  stage.on('touchmove', e => {
    const t = e.evt.touches;
    const node = selected();
    // палец убрали — жест кончился, даже если touchend до нас не дошёл:
    // иначе вещь осталась бы неперетаскиваемой до конца сеанса
    if (t.length !== 2 || !node) { endGrab(); return; }
    e.evt.preventDefault();

    const p1 = toStage(t[0]), p2 = toStage(t[1]);
    const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };

    if (!grab) {
      // перетаскивание выключаем: иначе вещь поедет ещё и за первым пальцем
      node.stopDrag();
      node.draggable(false);
      grab = {
        node,                                   // именно эту вещь потом и отпускаем:
        gap: gap(p1, p2) || 1, tilt: tilt(p1, p2), mid,   // выбор мог смениться
        scale: node.scaleX(), rotation: node.rotation(),
        pos: { x: node.x(), y: node.y() }
      };
      return;
    }

    const k = gap(p1, p2) / grab.gap;
    node.scaleX(grab.scale * k);
    node.scaleY(grab.scale * k);
    node.rotation(grab.rotation + (tilt(p1, p2) - grab.tilt));
    node.x(grab.pos.x + (mid.x - grab.mid.x));
    node.y(grab.pos.y + (mid.y - grab.mid.y));
    layer.batchDraw();
  });

  function endGrab() {
    if (!grab) return;
    grab.node.draggable(true);
    grab = null;
  }
  stage.on('touchend', endGrab);
  stage.on('touchcancel', endGrab);

  /**
   * Палитра фона открывается окном, а не разворачивается в строке под
   * листом: на телефоне лист и так упирается в высоту экрана, и постоянная
   * полоса со свотчами отнимала у него около сотни пикселей. Фон меняют
   * редко — ему хватает кнопки.
   */
  const openBg = () => {
    const m = openModal({
      title: 'Фон листа',
      body: h('div', { class: 'palette-grid' }, BGS.map(b =>
        h('button', {
          class: 'swatch' + (outfit.bg === b.id ? ' sel' : ''),
          style: { background: b.css, border: b.id === 'none' ? '1px dashed #bbb' : '' },
          title: b.name,
          onclick: () => { applyBg(b.id); m.close(); }
        })
      ))
    });
  };

  /**
   * «Убрать» срабатывает с одного нажатия, поэтому даём вернуть вещь —
   * запоминаем, как она лежала, и предлагаем это во всплывашке. Вопрос
   * перед каждым убиранием был бы хуже: убирают часто, а жалеют редко.
   */
  function removeSelected() {
    const n = selected();
    if (!n) return;
    const pose = {
      itemId: n.getAttr('itemId'), x: n.x(), y: n.y(),
      scaleX: n.scaleX(), scaleY: n.scaleY(), rotation: n.rotation(),
      z: n.zIndex()
    };
    n.destroy();
    tr.nodes([]);
    layer.batchDraw();
    toast('Вещь убрана с листа', 5000, {
      label: 'Вернуть',
      onclick: async () => {
        const back = await addItemNode(pose.itemId, pose);
        if (!back) return;
        tr.nodes([back]);
        tr.moveToTop();
        // слой возвращаем последним: иначе вещь всплывает наверх и образ
        // собирается не так, как был. Выше вещей только рамка выделения,
        // поэтому верхний допустимый номер — на два меньше числа слоёв
        back.zIndex(Math.min(pose.z, layer.getChildren().length - 2));
        layer.batchDraw();
      }
    });
  }

  const TOOLS = [
    { ic: '➕', label: 'Вещи', fn: addItems },
    { ic: '🎨', label: 'Фон', fn: openBg },
    { ic: '🌈', label: 'По цвету', fn: addByColor },
    // одна кнопка вместо двух стрелок: наверх поднимает касание, а вниз
    // пальцем не покажешь — для этого и кнопка
    {
      ic: '⤓', label: 'На нижний слой', fn: () => {
        const n = selected();
        if (!n) return toast('Сначала выберите вещь');
        n.zIndex(1);          // 1, а не 0: под нулём лежит фон листа
        tr.moveToTop();
        layer.batchDraw();
      }
    },
    { ic: '🗑', label: 'Убрать', fn: removeSelected },
    { ic: '❔', label: 'Подсказки', fn: openHints }
  ];
  fill(toolbar, ...TOOLS.map(t =>
    h('button', { class: 'tool', onclick: t.fn }, h('span', { class: 'ic' }, t.ic), h('span', {}, t.label))));

  // пересчитываем, когда строка инструментов уже на месте: первый расчёт
  // шёл по пустой строке и ошибался на её высоту
  viewScale = fit();

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
// имя своё, не общее с гардеробом: в однофайловой сборке все модули
// живут в одной области видимости, и одинаковые имена сталкиваются
const onav = { all: false, catId: null, subId: null, outfitId: null };

export const goOutfitsRoot = () => { onav.all = false; onav.catId = null; onav.subId = null; onav.outfitId = null; emit(); };
const openOutfitCat = id => { onav.catId = id; onav.subId = null; emit(); };
const catOf = id => outfitCats().find(c => c.id === id) || null;

/** Образы раздела. Ссылка на удалённую подкатегорию считается отсутствующей. */
function inOutfitFolder(catId, subId) {
  const want = catId === OTHER ? null : catId;
  const subs = new Set((catOf(want)?.subs || []).map(s => s.id));
  const subOf = o => (subs.has(o.subId) ? o.subId : null);
  return state.outfits
    .filter(o => (o.catId || null) === want
      && (subId == null || (subId === OTHER ? !subOf(o) : subOf(o) === subId)))
    .sort((a, b) => b.createdAt - a.createdAt);
}
const latestOutfit = (catId, subId) => inOutfitFolder(catId, subId)[0] || null;

export function outfitsNav() {
  if (onav.outfitId) {
    const o = outfitById(onav.outfitId);
    if (o) return { title: o.name || 'Образ', back: closeOutfitCard };
  }
  if (onav.all) return { title: 'Все образы', back: goOutfitsRoot };
  // «Другое» — не настоящая категория, своего заголовка у неё иначе не будет
  if (onav.catId === OTHER) return { title: 'Другое', back: goOutfitsRoot };
  const cat = catOf(onav.catId);
  if (!cat) return null;
  // настройка подкатегорий — кнопкой под списком, как и у категорий
  if (!onav.subId) return { title: cat.name, back: goOutfitsRoot };
  const name = onav.subId === OTHER ? 'Другое' : cat.subs.find(s => s.id === onav.subId)?.name;
  return { title: name || cat.name, back: () => { onav.subId = null; emit(); } };
}

/* ---------- карточка образа ---------- */
const closeOutfitCard = () => { onav.outfitId = null; emit(); };

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
    gone.length ? h('p', { class: 'warn-line soft' }, goneText(gone)) : null,

    // Действия стоят выше списка вещей: за ними приходят, а список —
    // справка. На телефоне до кнопок иначе нужно было прокручивать экран
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
    ),

    h('div', { class: 'section-title' }, 'Вещи в образе'),
    items.length ? h('div', { class: 'grid' }, items.map(it => h('div', {
      class: 'tile' + (it.archived ? ' gone' : ''), style: { background: bgCss(it.bg) },
      // карточка вещи живёт в «Гардеробе» — туда и уходим, иначе нажатие
      // просто закрывало образ и выглядело как ничего не произошло
      onclick: () => { goTab('closet'); openItemCard(it, true); }
    }, h('img', { src: urlFor(it.img) }))))
      : h('p', { class: 'muted small' }, 'Вещей из гардероба в образе не осталось.'),

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
  onav.outfitId = null;
  return openOutfitEditor(copy, true);
}

async function removeOutfit(o) {
  const days = state.calendar.filter(d => (d.outfitIds || []).includes(o.id)).length;
  const text = days
    ? `Образ использован в ${plural(days, 'дне', 'днях', 'днях')} календаря. Удалить вместе с записями?`
    : 'Удалить образ?';
  if (!await confirmDialog(text)) return;
  closeOutfitCard();
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
    onclick: () => { onav.outfitId = o.id; emit(); }
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
  const loose = inOutfitFolder(OTHER, null).length;

  fill(root,
    h('div', { class: 'list' },
      navRow({
        thumbNode: collageThumb(state.outfits, o => o.preview), title: 'Все образы',
        note: nOutfits(state.outfits.length),
        onclick: () => { onav.all = true; emit(); }
      }),
      ...cats.map(c => navRow({
        thumbNode: previewOf(latestOutfit(c.id, null)), title: c.name,
        note: nOutfits(countInOutfitCat(c.id))
          + (c.subs.length ? ' · ' + plural(c.subs.length, 'подкатегория', 'подкатегории', 'подкатегорий') : ''),
        onclick: () => openOutfitCat(c.id)
      })),
      loose ? navRow({
        thumbNode: previewOf(latestOutfit(OTHER, null)), title: 'Другое', muted: true,
        note: nOutfits(loose) + ' без категории',
        onclick: () => openOutfitCat(OTHER)
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

// см. closet.js: кнопка стоит там же, где «Категории образов» уровнем выше,
// и нужна на обоих экранах категории — со списком подкатегорий и с сеткой
const outfitSubMgrBtn = cat => h('button', {
  class: 'btn block ghost', style: { marginTop: '14px' },
  onclick: () => openSubManager(outfitSpace, cat, emit)
}, '⚙️ Управление подкатегориями');

function renderOutfitCat(root, cat) {
  const loose = inOutfitFolder(cat.id, OTHER).length;
  fill(root,
    h('div', { class: 'list' },
      ...cat.subs.map(s => navRow({
        thumbNode: previewOf(latestOutfit(cat.id, s.id)), title: s.name,
        note: nOutfits(inOutfitFolder(cat.id, s.id).length),
        onclick: () => { onav.subId = s.id; emit(); }
      })),
      loose ? navRow({
        thumbNode: previewOf(latestOutfit(cat.id, OTHER)), title: 'Другое', muted: true,
        note: nOutfits(loose) + ' без подкатегории',
        onclick: () => { onav.subId = OTHER; emit(); }
      }) : null
    ),
    outfitSubMgrBtn(cat),
    h('button', { class: 'fab', onclick: () => openOutfitEditor(null), title: 'Собрать образ' }, '+')
  );
  root.style.paddingBottom = '74px';
}

export function renderOutfits(root) {
  if (onav.outfitId) {
    const o = outfitById(onav.outfitId);
    if (o) return renderOutfitCard(root, o);
    onav.outfitId = null;
  }
  if (onav.all) return outfitGrid(root, state.outfits, 'Образов пока нет. Нажмите «+» внизу справа.');

  if (onav.catId === OTHER) {
    const loose = inOutfitFolder(OTHER, null);
    if (!loose.length) { onav.catId = null; return renderOutfitRoot(root); }
    return outfitGrid(root, loose, 'Здесь пусто.');
  }
  const cat = catOf(onav.catId);
  if (!cat) { onav.catId = null; onav.subId = null; return renderOutfitRoot(root); }

  if (!onav.subId) {
    if (cat.subs.length) return renderOutfitCat(root, cat);
    outfitGrid(root, inOutfitFolder(cat.id), `В категории «${cat.name}» пока пусто.`);
    root.append(outfitSubMgrBtn(cat));
    root.style.paddingBottom = '74px';
    return;
  }
  const list = inOutfitFolder(cat.id, onav.subId);
  if (onav.subId === OTHER && !list.length) { onav.subId = null; return renderOutfitCat(root, cat); }
  outfitGrid(root, list, 'Здесь пусто.');
}
