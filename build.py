"""Сборка однофайловой веб-версии (dist/yourcloset.html) для публикации артефактом.

Модули склеиваются в один <script type="module">: import/export вырезаются,
CSS инлайнится, Konva берётся с jsdelivr. ИИ-удаление фона в веб-демо отключается —
модель тянет свои wasm/onnx через fetch, который CSP артефактов блокирует.
"""
import base64
import io
import os
import re

ROOT = os.path.dirname(os.path.abspath(__file__))

# порядок важен: модули с top-level кодом должны идти после своих зависимостей
ORDER = [
    'db.js', 'ui.js', 'color.js', 'bgs.js', 'state.js', 'editor.js', 'capture.js',
    'picker.js', 'closet.js', 'outfits.js', 'calendar.js', 'packing.js',
    'settings.js', 'app.js',
]

IMPORT_RE = re.compile(r"^\s*import\s+[^;]*?from\s+'[^']+';\s*$")
EXPORT_RE = re.compile(r"^(\s*)export\s+(const|let|var|function|async function|class)\b")


def read(path):
    return io.open(os.path.join(ROOT, path), encoding='utf-8').read()


def strip_module_syntax(src):
    out = []
    for line in src.split('\n'):
        if IMPORT_RE.match(line):
            continue
        out.append(EXPORT_RE.sub(r'\1\2', line))
    return '\n'.join(out)


def patch_for_web(name, src):
    if name == 'editor.js':
        # ИИ-модель недоступна: её wasm/onnx грузятся через fetch, а он заблокирован CSP
        src = src.replace(
            "  async function runAI() {\n",
            "  async function runAI() {\n"
            "    toast('ИИ-вырезание недоступно в веб-демо — уберите фон «Палочкой»', 3800);\n"
            "    return;\n"
        )
    if name == 'capture.js':
        src = src.replace(
            "  toast(location.protocol === 'file:'\n"
            "    ? 'Камера работает только по http(s) — запустите локальный сервер'\n"
            "    : 'Нет доступа к камере', 3400);",
            "  toast('Камера недоступна в веб-демо — добавьте фото из галереи', 3600);")
    if name == 'settings.js':
        # в артефакте <a download> не работает — файл отдаём через capability downloads
        src = src.replace(
            """  const blob = new Blob([JSON.stringify(dump)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `yourcloset-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  busy(false);
  toast('Копия сохранена');""",
            """  const filename = `yourcloset-backup-${new Date().toISOString().slice(0, 10)}.json`;
  busy(false);
  const downloads = typeof window.claude?.use === 'function' ? await window.claude.use('downloads') : null;
  if (!downloads) { toast('Сохранение файла недоступно в этом просмотре', 3200); return; }
  try {
    await downloads.save({ filename, data: JSON.stringify(dump) });
    toast('Копия сохранена');
  } catch (e) {
    if (e && e.code !== 'declined') toast('Не удалось сохранить копию', 3200);
  }""")
        src = src.replace(
            "'Прототип хранит всё локально в браузере (IndexedDB). Очистка данных сайта удалит гардероб — делайте копию.'",
            "'Веб-демо: ИИ-вырезание фона и камера недоступны, остальное работает целиком. "
            "Данные лежат только в вашем браузере (IndexedDB) — для переноса делайте копию.'")
    return src


def build():
    bundle = []
    for name in ORDER:
        src = patch_for_web(name, read(os.path.join('js', name)))
        bundle.append(f'/* ===== {name} ===== */\n' + strip_module_syntax(src).strip())
    js = '\n\n'.join(bundle)

    # шрифты и Konva встраиваем в файл: артефакт не может подтянуть их с диска,
    # а внешние адреса нам не нужны ни здесь, ни в будущей мобильной сборке
    fonts_css = read(os.path.join('fonts', 'fonts.css'))
    for name in os.listdir(os.path.join(ROOT, 'fonts')):
        if not name.endswith('.woff2'):
            continue
        blob = io.open(os.path.join(ROOT, 'fonts', name), 'rb').read()
        uri = 'data:font/woff2;base64,' + base64.b64encode(blob).decode('ascii')
        fonts_css = fonts_css.replace(f"'{name}'", f"'{uri}'")

    konva = read(os.path.join('vendor', 'konva.min.js'))
    css = read(os.path.join('css', 'style.css'))
    body = read('index.html')
    # берём только разметку между <body> и <script>
    body = body.split('<body>', 1)[1].split('<script type="module"', 1)[0]
    body = body.replace('</body>', '').replace('</html>', '').strip()

    html = f"""<title>YourCloset</title>
<style>
:root {{ color-scheme: light; }}
{fonts_css}
{css}
</style>

{body}

<script>
{konva}
</script>
<script type="module">
{js}
</script>
"""
    os.makedirs(os.path.join(ROOT, 'dist'), exist_ok=True)
    out = os.path.join(ROOT, 'dist', 'yourcloset.html')
    io.open(out, 'w', encoding='utf-8').write(html)
    print(f'{out}  {len(html) / 1024:.0f} KB')


if __name__ == '__main__':
    build()
