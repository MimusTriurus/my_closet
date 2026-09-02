// Фоны для карточек вещей и для холста образов.
export const BGS = [
  { id: 'none', name: 'Нет', css: '#ffffff', colors: ['#ffffff'] },
  { id: 'cream', name: 'Крем', css: '#f7f1e8', colors: ['#f7f1e8'] },
  { id: 'sand', name: 'Песок', css: '#ecdfcd', colors: ['#ecdfcd'] },
  { id: 'clay', name: 'Глина', css: '#e3cbbd', colors: ['#e3cbbd'] },
  { id: 'sage', name: 'Шалфей', css: '#d7e0d2', colors: ['#d7e0d2'] },
  { id: 'sky', name: 'Небо', css: '#d6e4ef', colors: ['#d6e4ef'] },
  { id: 'lilac', name: 'Лиловый', css: '#e2dcec', colors: ['#e2dcec'] },
  { id: 'rose', name: 'Роза', css: '#f1dbdd', colors: ['#f1dbdd'] },
  { id: 'graphite', name: 'Графит', css: '#3b3733', colors: ['#3b3733'] },
  { id: 'g-warm', name: 'Закат', css: 'linear-gradient(160deg,#f6d9c4,#e8b39a)', colors: ['#f6d9c4', '#e8b39a'] },
  { id: 'g-cool', name: 'Утро', css: 'linear-gradient(160deg,#e3ecf5,#c6d5e6)', colors: ['#e3ecf5', '#c6d5e6'] },
  { id: 'g-night', name: 'Ночь', css: 'linear-gradient(160deg,#4a4560,#2a2738)', colors: ['#4a4560', '#2a2738'] }
];

export const bgById = id => BGS.find(b => b.id === id) || BGS[0];
export const bgCss = id => bgById(id).css;
