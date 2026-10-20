#!/usr/bin/env python3
"""Build dist/Data_Model_Explorer.html: one offline file with every library, the logo, the
template and a starting workbook inlined.

  python3 build.py                          # starts with the slim template as the bundled workbook
  python3 build.py --workbook client.xlsx   # bundle a client workbook (do not commit it)
"""
import argparse, base64, json, pathlib

root = pathlib.Path(__file__).parent
ap = argparse.ArgumentParser()
ap.add_argument('--workbook', default=str(root / 'assets/Data_Model_Template.xlsx'), help='workbook shown when the page first opens')
ap.add_argument('--out', default=str(root / 'dist/Data_Model_Explorer.html'))
a = ap.parse_args()

nm = root / 'node_modules'
def lib(p):  # a library inlined in a <script>: protect any literal </script
    return (nm / p).read_text(encoding='utf-8').replace('</script', '<\\/script')
b64 = lambda p: base64.b64encode(pathlib.Path(p).read_bytes()).decode()
def js_str(s):  # a value placed inside a <script> as a JavaScript string literal
    return json.dumps(s).replace('</', '<\\/')

t = (root / 'src/index.template.html').read_text(encoding='utf-8')
wb = pathlib.Path(a.workbook)
assert '"__FILENAME__"' in t, 'template is missing the "__FILENAME__" placeholder'
# data first, libraries last, so text inside a library can never be mistaken for a placeholder
t = (t.replace('"__FILENAME__"', js_str(wb.name))
      .replace('__TEMPLATE_B64__', b64(root / 'assets/Data_Model_Template.xlsx'))
      .replace('__LOGO__', b64(root / 'assets/logo.png'))
      .replace('__B64__', b64(wb)))
t = (t.replace('/*__EXCELJS_LIB__*/', lib('exceljs/dist/exceljs.min.js'))
      .replace('/*__XLSX_LIB__*/', lib('xlsx/dist/xlsx.full.min.js'))
      .replace('/*__JSZIP_LIB__*/', lib('jszip/dist/jszip.min.js'))
      .replace('/*__MERMAID_LIB__*/', lib('mermaid/dist/mermaid.min.js')))
out = pathlib.Path(a.out); out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(t, encoding='utf-8')
print(f'{out}  {len(t)/1e6:.2f} MB')
