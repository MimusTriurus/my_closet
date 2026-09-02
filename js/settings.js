// Настройки: резервная копия (экспорт/импорт JSON), демо-данные, сброс.
// В приложении это Google Drive; в прототипе — обычный файл, логика та же.
import { fill, h, openModal, toast, busy, confirmDialog } from './ui.js';
import { dbAll, dbPut, dbClear, STORES } from './db.js';
import { state, loadAll, emit } from './state.js';
import { CATALOG, addToCloset } from './shop.js';

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

async function importAll(file) {
  busy(true, 'Восстанавливаю…');
  try {
    const dump = JSON.parse(await file.text());
    if (!dump.stores) throw new Error('bad format');
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
    toast('Не удалось прочитать файл');
  } finally { busy(false); }
}

async function seedDemo() {
  busy(true, 'Наполняю демо-гардероб…');
  const sample = CATALOG.filter((_, i) => i % 2 === 0);
  for (const p of sample) await addToCloset(p, true);
  busy(false);
  emit();
  toast(`Добавлено ${sample.length} вещей`);
}

async function wipe() {
  if (!await confirmDialog('Удалить все вещи, образы и планы? Действие необратимо.', 'Стереть')) return;
  busy(true, 'Очищаю…');
  for (const s of STORES) await dbClear(s);
  await loadAll();
  emit();
  busy(false);
  toast('Данные удалены');
}

export function openSettings() {
  const fileInput = h('input', {
    type: 'file', accept: 'application/json', style: { display: 'none' },
    onchange: e => { const f = e.target.files[0]; if (f) importAll(f); e.target.value = ''; }
  });

  openModal({
    title: 'Настройки',
    body: h('div', {},
      h('div', { class: 'stat-row' },
        h('div', { class: 'stat' }, h('b', {}, state.items.length), h('span', {}, 'вещей')),
        h('div', { class: 'stat' }, h('b', {}, state.outfits.length), h('span', {}, 'образов')),
        h('div', { class: 'stat' }, h('b', {}, state.trips.length), h('span', {}, 'поездок'))),
      h('div', { class: 'section-title' }, 'Резервная копия'),
      h('div', { class: 'list' },
        h('button', { class: 'btn block', onclick: exportAll }, '⬇️ Сохранить копию в файл'),
        h('button', { class: 'btn block', onclick: () => fileInput.click() }, '⬆️ Восстановить из файла'),
        fileInput),
      h('div', { class: 'section-title' }, 'Прочее'),
      h('div', { class: 'list' },
        h('button', { class: 'btn block', onclick: seedDemo }, '✨ Наполнить демо-вещами'),
        h('button', { class: 'btn block danger', onclick: wipe }, '🗑 Стереть все данные')),
      h('p', { class: 'muted small', style: { marginTop: '16px' } },
        'Прототип хранит всё локально в браузере (IndexedDB). Очистка данных сайта удалит гардероб — делайте копию.')
    )
  });
}
