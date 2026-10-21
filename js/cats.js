// Категории и подкатегории — общий механизм на три пространства: гардероб,
// архив вещей и образы. У каждого свой список, свои счётчики и свои
// миниатюры, поэтому пространство описывается объектом и передаётся сюда.
import { fill, h, openModal, confirmDialog, promptDialog, actionSheet, alertDialog, plural } from './ui.js';
import { saveCat, deleteCat, catsIn, countIn, moveCat, nextCatOrder } from './state.js';
import { uid } from './db.js';

const nSubs = n => plural(n, 'подкатегория', 'подкатегории', 'подкатегорий');

/**
 * Список категорий пространства: переименовать, удалить, добавить.
 * Подкатегорий здесь нет намеренно — они настраиваются изнутри своей
 * категории, иначе завести подкатегорию можно было бы двумя путями.
 */
export function openCategoryManager(space) {
  const body = h('div', { class: 'list' });
  openModal({ title: space.title, body, full: true });

  function render() {
    const list = space.cats();
    fill(body,
      ...list.map((c, i) => h('div', { class: 'lrow' },
        // та же миниатюра, что и в списке разделов: фотография, а не пиктограмма
        space.thumb(c),
        h('div', { class: 't' },
          h('b', {}, c.name),
          h('span', {}, `${space.n(countIn(c))} · ${nSubs(c.subs.length)}`)),
        // порядок меняется стрелками: на телефоне перетаскивание ненадёжно,
        // а список категорий короткий
        h('div', { class: 'ord' },
          h('button', {
            class: 'btn btn-sm', disabled: i === 0,
            onclick: async () => { if (await moveCat(list, c.id, -1)) render(); }
          }, '↑'),
          h('button', {
            class: 'btn btn-sm', disabled: i === list.length - 1,
            onclick: async () => { if (await moveCat(list, c.id, 1)) render(); }
          }, '↓')),
        h('button', {
          class: 'btn btn-sm', onclick: async () => {
            const act = await actionSheet(c.name, [
              { id: 'ren', icon: '✎', label: 'Переименовать' },
              { id: 'del', icon: '🗑', label: 'Удалить категорию', danger: true }
            ]);
            if (act === 'ren') {
              const n = await promptDialog('Переименовать', c.name);
              if (n) { c.name = n; await saveCat(c); render(); }
            } else if (act === 'del') {
              // непустую категорию не удаляем: иначе её содержимое разом
              // осталось бы без места. Сначала перенос
              const n = countIn(c);
              if (n) {
                await alertDialog(`В категории «${c.name}» ${space.n(n)}. ${space.moveHint}`,
                  'Категория не пуста');
              } else if (await confirmDialog(`Удалить «${c.name}»?`)) {
                await deleteCat(c.id); render();
              }
            }
          }
        }, '⋯')
      )),
      h('button', {
        class: 'btn block primary', style: { marginTop: '12px' }, onclick: async () => {
          const n = await promptDialog('Новая категория');
          if (!n) return;
          await saveCat({
            id: uid('c'), name: n, order: nextCatOrder(space.cats()),
            custom: true, scope: space.scope, subs: []
          });
          render();
        }
      }, '+ Добавить категорию')
    );
  }
  render();
}

/** Подкатегории одной категории. Открывается кнопкой в её заголовке. */
export function openSubManager(space, cat, onDone) {
  const body = h('div', { class: 'list' });
  openModal({ title: cat.name, body, onClose: onDone });

  function render() {
    fill(body,
      ...cat.subs.map(s => h('div', { class: 'lrow' },
        h('div', { class: 't' },
          h('b', {}, s.name),
          h('span', {}, space.n(space.countSub(cat, s.id)))),
        h('button', {
          class: 'btn btn-sm', onclick: async () => {
            const n = await promptDialog('Переименовать', s.name);
            if (n) { s.name = n; await saveCat(cat); render(); }
          }
        }, '✎'),
        h('button', {
          class: 'btn btn-sm danger', onclick: async () => {
            // содержимое остаётся в категории: его подхватит «Другое»
            cat.subs = cat.subs.filter(x => x.id !== s.id);
            await space.detachSub(s.id);
            await saveCat(cat); render();
          }
        }, '🗑')
      )),
      cat.subs.length ? null : h('p', { class: 'muted small' }, 'Пока пусто'),
      h('button', {
        class: 'btn block primary', style: { marginTop: '12px' }, onclick: async () => {
          const n = await promptDialog('Новая подкатегория');
          if (!n) return;
          cat.subs.push({ id: uid('s'), name: n });
          await saveCat(cat);
          render();
        }
      }, '+ Добавить подкатегорию')
    );
  }
  render();
}

/** Пространство по его scope — чтобы не передавать список руками. */
export const catsOf = scope => catsIn(scope);
