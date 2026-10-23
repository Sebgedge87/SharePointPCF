// The web-resource solution: node tests/webresource.js  (run `npm run build` first)
// tools/make-webresource-solution.py writes the layout `pac solution pack` writes; this checks its contents.
const path = require('path'), fs = require('fs'), { execFileSync } = require('child_process'), JSZip = require('jszip');
const root = path.resolve(__dirname, '..'), out = path.join(__dirname, 'out'); fs.mkdirSync(out, { recursive: true });
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const zp = path.join(out, 'wr.zip');
  execFileSync('python3', [path.join(root, 'tools/make-webresource-solution.py'), '--out', zp, '--prefix', 'contoso', '--publisher', 'Contoso', '--option-prefix', '12345']);
  const z = await JSZip.loadAsync(fs.readFileSync(zp)), names = Object.keys(z.files).sort();
  ok(JSON.stringify(names) === JSON.stringify(['WebResources/contoso_/dme/DataModelExplorer.html', '[Content_Types].xml', 'customizations.xml', 'solution.xml'].sort()), 'the zip holds the solution files and the page');
  const cust = await z.file('customizations.xml').async('string'), sol = await z.file('solution.xml').async('string');
  ok(/<Name>contoso_\/dme\/DataModelExplorer\.html<\/Name>[\s\S]*<WebResourceType>1<\/WebResourceType>[\s\S]*<FileName>\/WebResources\/contoso_\/dme\/DataModelExplorer\.html<\/FileName>/.test(cust), 'customizations.xml registers it as an HTML web resource');
  ok(/<UniqueName>Contoso<\/UniqueName>[\s\S]*<CustomizationPrefix>contoso<\/CustomizationPrefix>[\s\S]*<CustomizationOptionValuePrefix>12345<\/CustomizationOptionValuePrefix>/.test(sol) && /<Managed>0<\/Managed>/.test(sol), 'solution.xml has the publisher given and is unmanaged');
  ok(/<RootComponent type="61" schemaName="contoso_\/dme\/DataModelExplorer\.html" behavior="0" \/>/.test(sol), 'the web resource is the root component');
  const page = await z.file('WebResources/contoso_/dme/DataModelExplorer.html').async('nodebuffer');
  ok(page.equals(fs.readFileSync(path.join(root, 'dist/Data_Model_Explorer.html'))) && page.length < 5e6, `the page is unchanged and under 5 MB (${(page.length / 1e6).toFixed(1)} MB)`);
  const id1 = /<WebResourceId>\{([^}]+)\}/.exec(cust)[1];
  execFileSync('python3', [path.join(root, 'tools/make-webresource-solution.py'), '--out', zp, '--prefix', 'contoso', '--publisher', 'Contoso', '--option-prefix', '12345']);
  const id2 = /<WebResourceId>\{([^}]+)\}/.exec(await (await JSZip.loadAsync(fs.readFileSync(zp))).file('customizations.xml').async('string'))[1];
  ok(id1 === id2, 'the web resource id is the same on every build, so importing a new version updates it');
  let refused = false; try { execFileSync('python3', [path.join(root, 'tools/make-webresource-solution.py'), '--html', path.join(root, 'samples/Import_Test_Model.xlsx'), '--out', zp], { stdio: 'pipe' }); } catch (e) { refused = true; }
  ok(refused, 'it refuses anything but the normal page');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
