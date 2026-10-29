#!/usr/bin/env python3
"""Build the page two ways from src/index.template.html:

  dist/Data_Model_Explorer.html   one offline file with every library, the template and a starting workbook
                                  inlined (opened as a file, and built into the XrmToolBox tool)
  dist/web/                       the same page as separate files, for the Dataverse solution: DataModelExplorer.html
                                  (markup, styles and data), app.js (the code) and lib/ (SheetJS, ExcelJS, JSZip), so a
                                  new version only changes the files that changed and the libraries can be cached

  python3 build.py                          # starts with the slim template as the bundled workbook
  python3 build.py --workbook client.xlsx   # bundle a client workbook (do not commit it; no dist/web is written)
"""
import argparse, base64, hashlib, json, pathlib, shutil

root = pathlib.Path(__file__).parent
ap = argparse.ArgumentParser()
ap.add_argument('--workbook', default=str(root / 'assets/Data_Model_Template.xlsx'), help='workbook shown when the page first opens')
ap.add_argument('--out', default=None)
ap.add_argument('--readonly', action='store_true', help='a read-only copy: view, search, check and diagram only')
ap.add_argument('--web', default=None, help='folder for the separate-files build (default: dist/web; not written for --readonly or --workbook)')
a = ap.parse_args()
if a.out is None: a.out = str(root / ('dist/Data_Model_Explorer_ReadOnly.html' if a.readonly else 'dist/Data_Model_Explorer.html'))

nm = root / 'node_modules'
def lib(p):  # a library inlined in a <script>: protect any literal </script
    return (nm / p).read_text(encoding='utf-8').replace('</script', '<\\/script')
b64 = lambda p: base64.b64encode(pathlib.Path(p).read_bytes()).decode()
def js_str(s):  # a value placed inside a <script> as a JavaScript string literal
    return json.dumps(s).replace('</', '<\\/')

t = (root / 'src/index.template.html').read_text(encoding='utf-8')
wb = pathlib.Path(a.workbook)
assert '"__FILENAME__"' in t, 'template is missing the "__FILENAME__" placeholder'
LIBS = [('/*__XLSX_LIB__*/', 'xlsx/dist/xlsx.full.min.js'), ('/*__EXCELJS_LIB__*/', 'exceljs/dist/exceljs.min.js'), ('/*__JSZIP_LIB__*/', 'jszip/dist/jszip.min.js')]
version = json.loads((root / 'package.json').read_text())['version']
# one id for this build of the code and the libraries: the page and app.js each carry it, so a mix of versions is noticed
h = hashlib.sha256(version.encode() + t.encode())
for _, p in LIBS: h.update((nm / p).read_bytes())
build = version + '-' + h.hexdigest()[:10]
# data first, libraries last, so text inside a library can never be mistaken for a placeholder
t = (t.replace('"__MODE__"', '"readonly"' if a.readonly else '"edit"')
      .replace('"__VERSION__"', js_str(version))
      .replace('"__BUILD__"', js_str(build))
      .replace('"__FILENAME__"', js_str(wb.name))
      .replace('__TEMPLATE_B64__', b64(root / 'assets/Data_Model_Template.xlsx'))
      .replace('__B64__', b64(wb)))

def write(path, text):
    path = pathlib.Path(path); path.parent.mkdir(parents=True, exist_ok=True); path.write_text(text, encoding='utf-8'); return path

# separate files: the page keeps its markup, styles and data; the code and each library become a file of their own
default_wb = wb.resolve() == (root / 'assets/Data_Model_Template.xlsx').resolve()
if not a.readonly and default_wb:
    web = pathlib.Path(a.web or root / 'dist/web')
    if web.exists(): shutil.rmtree(web)
    w = t
    for ph, p in LIBS:
        name = pathlib.Path(p).name
        write(web / 'lib' / name, (nm / p).read_text(encoding='utf-8'))
        w = w.replace(f'<script>{ph}</script>', f'<script src="lib/{name}?v={build}"></script>')
    data_end = w.index('</script>', w.index('const DME_BUILD = ')) + len('</script>')
    s = w.index('<script>', data_end); e = w.rindex('</script>')
    write(web / 'app.js', w[s + len('<script>'):e].lstrip('\n'))
    w = w[:s] + f'<script src="app.js?v={build}"></script>' + w[e + len('</script>'):]
    assert '/*__' not in w and w.count('<script') == 5, 'the separate-files page should hold three library tags, the data and app.js'
    write(web / 'DataModelExplorer.html', w)
    print(f'{web}/  ' + ', '.join(f'{f.relative_to(web)} {f.stat().st_size/1e6:.2f} MB' for f in sorted(web.rglob('*')) if f.is_file()))

for ph, p in LIBS: t = t.replace(ph, lib(p))
out = write(a.out, t)
print(f'{out}  {len(t)/1e6:.2f} MB  (build {build})')
