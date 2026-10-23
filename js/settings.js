// Настройки: резервная копия — экспорт и импорт всего гардероба одним JSON.
// В приложении это Google Drive; в прототипе — обычный файл, логика та же.
import { fill, h, openModal, toast, busy, pluralWord, alertDialog, nItems, nOutfits } from './ui.js';
import { dbAll, dbPut, dbClear, STORES } from './db.js';
import { state, loadAll, emit, closetCount, countInSystem, archivedItems } from './state.js';

const BLOB_FIELDS = { items: ['img'], outfits: ['preview'] };

const blobToDataURL = b => new Promise(res => {
  const fr = new FileReader();
  fr.onload = () => res(fr.result);
  fr.readAsDataURL(b);
});
const dataURLToBlob = url => fetch(url).then(r => r.blob());

async function exportAll() {
  busy(true, 'Готовлю резервную копию…');
  const dump = { version: 1, createdAt: new Date().toISOString(), stores: {} };
  for (const s of STORES) {
    const rows = await dbAll(s);
    const fields = BLOB_FIELDS[s] || [];
    dump.stores[s] = await Promise.all(rows.map(async r => {
      const copy = { ...r };
      for (const f of fields) if (copy[f] instanceof Blob) copy[f] = await blobToDataURL(copy[f]);
      return copy;
    }));
  }
  const blob = new Blob([JSON.stringify(dump)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `yourcloset-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  busy(false);
  toast('Копия сохранена');
}

/** Формат копии. Файл новее этого числа мы читать не умеем — и не делаем вид. */
const DUMP_VERSION = 1;

/**
 * Разбор копии и разговор перед заменой.
 *
 * Восстановление — единственное необратимое действие в приложении: оно
 * стирает всё, что есть сейчас. Поэтому сначала читаем файл (ничего не
 * трогая), показываем, что в нём и что заменится, и предлагаем сохранить
 * текущее состояние — одной кнопкой, не отправляя человека в меню.
 */
async function askRestore(file) {
  let dump;
  try {
    dump = JSON.parse(await file.text());
    if (!dump.stores) throw new Error('bad format');
  } catch (e) {
    console.error(e);
    return toast('Не удалось прочитать файл', 3200);
  }
  if ((dump.version || 1) > DUMP_VERSION) {
    return alertDialog(
      'Эта копия сделана более новой версией приложения. Обновите приложение и попробуйте снова.',
      'Копия новее приложения');
  }

  const has = s => (dump.stores[s] || []).length;
  const made = dump.createdAt ? new Date(dump.createdAt).toLocaleDateString('ru-RU') : null;

  // На пустом приложении терять нечего — это и есть главный случай: новый
  // телефон, установка с нуля. Пугать заменой того, чего нет, и предлагать
  // сохранить пустоту было бы враньём
  const empty = !state.items.length && !state.outfits.length && !state.trips.length;

  const saveBtn = h('button', { class: 'btn block' }, '⬇️ Сначала сохранить текущую копию');
  const note = h('p', { class: 'muted small', style: { margin: '10px 0 0' } },
    'Сохранять не обязательно, но если копия окажется не той, вернуться будет не к чему.');

  const m = openModal({
    title: 'Восстановить из копии?',
    body: h('div', {},
      h('p', { style: { margin: '4px 0 10px' } },
        `В файле: ${nItems(has('items'))}, ${nOutfits(has('outfits'))}, `
        + `поездок ${has('trips')}${made ? `. Копия от ${made}` : ''}.`),
      // считаем все вещи, а не только гардероб: заменится и то, что лежит
      // на рабочих полках и в архиве, — сравнивать надо одно с одним
      empty ? h('p', { class: 'muted small', style: { margin: '0' } },
        'Сейчас в приложении пусто — заменять нечего.')
        : h('p', { class: 'warn-line', style: { margin: '0 0 2px' } },
          `Всё, что сейчас в приложении (${nItems(state.items.length)}, ${nOutfits(state.outfits.length)}), `
          + 'будет заменено. Отменить это нельзя.'),
      empty ? null : saveBtn,
      empty ? null : note
    ),
    foot: [
      h('button', { class: 'btn', onclick: () => m.close() }, 'Отмена'),
      h('button', {
        class: 'btn ' + (empty ? 'primary' : 'danger'),
        onclick: () => { m.close(); importAll(dump); }
      }, 'Восстановить')
    ]
  });

  saveBtn.onclick = async () => {
    saveBtn.disabled = true;
    await exportAll();
    saveBtn.textContent = '✓ Копия сохранена';
    note.textContent = 'Теперь можно восстанавливать: текущее состояние сохранено в файл.';
  };
}

async function importAll(dump) {
  busy(true, 'Восстанавливаю…');
  try {
    for (const s of STORES) {
      await dbClear(s);
      const fields = BLOB_FIELDS[s] || [];
      for (const row of dump.stores[s] || []) {
        const copy = { ...row };
        for (const f of fields) if (typeof copy[f] === 'string' && copy[f].startsWith('data:')) copy[f] = await dataURLToBlob(copy[f]);
        await dbPut(s, copy);
      }
    }
    await loadAll();
    emit();
    toast('Данные восстановлены');
  } catch (e) {
    console.error(e);
    toast('Не удалось восстановить копию', 3200);
  } finally { busy(false); }
}

export function openSettings() {
  const fileInput = h('input', {
    type: 'file', accept: 'application/json', style: { display: 'none' },
    onchange: e => { const f = e.target.files[0]; if (f) askRestore(f); e.target.value = ''; }
  });

  openModal({
    title: 'Настройки',
    body: h('div', {},
      // в гардероб не входят служебные категории: «Сортировка» ещё не разобрана,
      // а «На рассмотрении» — то, что пока не куплено
      h('div', { class: 'stat-row' },
        h('div', { class: 'stat' }, h('b', {}, closetCount()),
          h('span', {}, pluralWord(closetCount(), 'вещь', 'вещи', 'вещей'))),
        h('div', { class: 'stat' }, h('b', {}, state.outfits.length),
          h('span', {}, pluralWord(state.outfits.length, 'образ', 'образа', 'образов'))),
        h('div', { class: 'stat' }, h('b', {}, state.trips.length),
          h('span', {}, pluralWord(state.trips.length, 'поездка', 'поездки', 'поездок')))),
      h('p', { class: 'muted small center', style: { margin: '8px 0 0' } },
        `на рассмотрении ${countInSystem('review')} · не разобрано ${countInSystem('sorting')} · в архиве ${archivedItems().length}`),
      h('div', { class: 'section-title' }, 'Резервная копия'),
      h('div', { class: 'list' },
        h('button', { class: 'btn block', onclick: exportAll }, '⬇️ Сохранить копию в файл'),
        h('button', { class: 'btn block', onclick: () => fileInput.click() }, '⬆️ Восстановить из файла'),
        fileInput),
      h('p', { class: 'muted small', style: { marginTop: '16px' } },
        'Прототип хранит всё локально в браузере (IndexedDB). Очистка данных сайта удалит гардероб — делайте копию.')
    )
  });
}
