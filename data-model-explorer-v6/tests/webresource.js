// The web-resource solution: node tests/webresource.js  (run `npm run build` first)
// tools/make-webresource-solution.py writes the layout `pac solution pack` writes; this checks its contents.
const path = require('path'), fs = require('fs'), { execFileSync } = require('child_process'), JSZip = require('jszip');
const root = path.resolve(__dirname, '..'), out = path.join(__dirname, 'out'); fs.mkdirSync(out, { recursive: true });
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const zp = path.join(out, 'wr.zip');
  execFileSync('python3', [path.join(root, 'tools/make-webresource-solution.py'), '--out', zp, '--prefix', 'contoso', '--publisher', 'Contoso', '--option-prefix', '12345']);
  const z = await JSZip.loadAsync(fs.readFileSync(zp)), names = Object.keys(z.files).sort();
  const WR = ['DataModelExplorer.html', 'app.js', 'lib/exceljs.min.js', 'lib/jszip.min.js', 'lib/xlsx.full.min.js'];
  ok(JSON.stringify(names) === JSON.stringify([...WR.map(f => 'WebResources/contoso_/dme/' + f), '[Content_Types].xml', 'customizations.xml', 'solution.xml'].sort()), 'the zip holds the solution files, the page, app.js and the three libraries');
  const cust = await z.file('customizations.xml').async('string'), sol = await z.file('solution.xml').async('string');
  ok(/<Name>contoso_\/dme\/DataModelExplorer\.html<\/Name>[\s\S]*?<WebResourceType>1<\/WebResourceType>[\s\S]*?<FileName>\/WebResources\/contoso_\/dme\/DataModelExplorer\.html<\/FileName>/.test(cust), 'customizations.xml registers the page as an HTML web resource');
  ok(WR.slice(1).every(f => new RegExp('<Name>contoso_/dme/' + f.replace(/\./g, '\\.') + '</Name>[\\s\\S]*?<WebResourceType>3</WebResourceType>').test(cust)), 'and app.js and each library as script (JScript) web resources');
  ok(/<Default Extension="js"/.test(await z.file('[Content_Types].xml').async('string')), '[Content_Types].xml lists .js files');
  ok(/<UniqueName>Contoso<\/UniqueName>[\s\S]*<CustomizationPrefix>contoso<\/CustomizationPrefix>[\s\S]*<CustomizationOptionValuePrefix>12345<\/CustomizationOptionValuePrefix>/.test(sol) && /<Managed>0<\/Managed>/.test(sol), 'solution.xml has the publisher given and is unmanaged');
  ok(WR.every(f => sol.includes(`<RootComponent type="61" schemaName="contoso_/dme/${f}" behavior="0" />`)), 'each web resource is a root component');
  for (const f of WR) { const b = await z.file('WebResources/contoso_/dme/' + f).async('nodebuffer'); ok(b.equals(fs.readFileSync(path.join(root, 'dist/web', f))) && b.length < 5e6, `${f} is the built file, under 5 MB (${(b.length / 1e6).toFixed(2)} MB)`); }
  const id1 = /<WebResourceId>\{([^}]+)\}/.exec(cust)[1];
  execFileSync('python3', [path.join(root, 'tools/make-webresource-solution.py'), '--out', zp, '--prefix', 'contoso', '--publisher', 'Contoso', '--option-prefix', '12345']);
  const id2 = /<WebResourceId>\{([^}]+)\}/.exec(await (await JSZip.loadAsync(fs.readFileSync(zp))).file('customizations.xml').async('string'))[1];
  ok(id1 === id2, 'the web resource id is the same on every build, so importing a new version updates it');
  ok(id1 === (() => { const ns = Buffer.from('6ba7b8119dad11d180b400c04fd430c8', 'hex'); const h = require('crypto').createHash('sha1').update(Buffer.concat([ns, Buffer.from('dme-webresource:contoso_/dme/DataModelExplorer.html')])).digest(); h[6] = (h[6] & 0x0f) | 0x50; h[8] = (h[8] & 0x3f) | 0x80; const x = h.subarray(0, 16).toString('hex'); return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`; })(), 'the page keeps the id it had in 5.0, so importing over 5.0 updates it');
  execFileSync('python3', [path.join(root, 'tools/make-webresource-solution.py'), '--single', '--out', zp, '--prefix', 'contoso', '--publisher', 'Contoso', '--option-prefix', '12345']);
  const zs = await JSZip.loadAsync(fs.readFileSync(zp));
  ok(Object.keys(zs.files).filter(n => n.startsWith('WebResources/')).join() === 'WebResources/contoso_/dme/DataModelExplorer.html' && (await zs.file('WebResources/contoso_/dme/DataModelExplorer.html').async('nodebuffer')).equals(fs.readFileSync(path.join(root, 'dist/Data_Model_Explorer.html'))), '--single packages the one-file page as before');
  let refused = false; try { execFileSync('python3', [path.join(root, 'tools/make-webresource-solution.py'), '--single', '--html', path.join(root, 'samples/Import_Test_Model.xlsx'), '--out', zp], { stdio: 'pipe' }); } catch (e) { refused = true; }
  ok(refused, 'it refuses anything but the normal page');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
