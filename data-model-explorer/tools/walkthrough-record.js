// Records a captioned walkthrough of the Data Model Explorer on the import-test workbook.
// node walkthrough.js <page.html> <workbook.xlsx> <workbook v2.xlsx> <outdir>
const B = process.env.NODE_MODULES; const fs = require('fs'), path = require('path');
const { chromium } = require(B + '/playwright');
const [page_, wbk, wbk2, out] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
const W = 1440, H = 860;

// caption bar, title cards, a visible cursor and click ripples, added to the page for the recording only
const OVERLAY = `(() => {
  const add = () => {
    if (document.getElementById('wt-cur')) return;
    const st = document.createElement('style');
    st.textContent = \`#wt-cur{position:fixed;left:0;top:0;width:22px;height:22px;z-index:2147483647;pointer-events:none;transform:translate(-3px,-2px);transition:transform .05s}
      #wt-cur svg{filter:drop-shadow(0 1px 2px rgba(0,0,0,.45))}
      .wt-rip{position:fixed;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;border:3px solid #D92D20;z-index:2147483646;pointer-events:none;animation:wtr .6s ease-out forwards}
      @keyframes wtr{from{transform:scale(.6);opacity:1}to{transform:scale(3.2);opacity:0}}
      #wt-cap{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);max-width:1100px;z-index:2147483645;pointer-events:none;background:rgba(6,26,70,.92);color:#fff;
        font:500 21px/1.35 'Segoe UI',Arial,sans-serif;padding:14px 24px 15px;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.35);opacity:0;transition:opacity .35s}
      #wt-cap b{color:#F7A8CF;font-weight:700;margin-right:10px;letter-spacing:.3px}
      #wt-cap small{display:block;font-size:16px;color:#C9DCEA;margin-top:4px;font-weight:400}
      #wt-card{position:fixed;inset:0;z-index:2147483644;background:#0A4873;color:#fff;display:flex;flex-direction:column;justify-content:center;padding:0 140px;opacity:0;transition:opacity .5s;pointer-events:none;font-family:'Segoe UI',Arial,sans-serif}
      #wt-card h1{font-size:64px;margin:0 0 18px;font-weight:700}#wt-card p{font-size:28px;margin:0;color:#C9DCEA;max-width:1000px;line-height:1.4}
      #wt-card .bar{width:18px;position:absolute;left:0;top:0;bottom:0;background:#BB1C73}
      .wt-hl{outline:4px solid #D92D20!important;outline-offset:3px!important;border-radius:8px}\`;
    document.head.appendChild(st);
    const c = document.createElement('div'); c.id = 'wt-cur';
    c.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M2 1l16 9-7 2-3 7z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.body.appendChild(c);
    const cap = document.createElement('div'); cap.id = 'wt-cap'; document.body.appendChild(cap);
    const card = document.createElement('div'); card.id = 'wt-card'; card.innerHTML = '<div class="bar"></div><h1></h1><p></p>'; document.body.appendChild(card);
    document.addEventListener('mousemove', e => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
    document.addEventListener('mousedown', e => { const r = document.createElement('div'); r.className = 'wt-rip'; r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px'; document.body.appendChild(r); setTimeout(() => r.remove(), 700); }, true);
    window.__cap = (step, text, sub) => { cap.innerHTML = (step ? '<b>' + step + '</b>' : '') + text + (sub ? '<small>' + sub + '</small>' : ''); cap.style.opacity = text ? 1 : 0; };
    window.__card = (h, p) => { card.querySelector('h1').textContent = h || ''; card.querySelector('p').textContent = p || ''; card.style.opacity = h ? 1 : 0; };
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add();
})();`;

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await b.newContext({ viewport: { width: W, height: H }, acceptDownloads: true });
  await ctx.addInitScript(OVERLAY);
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  // frames from Chrome's screencast (sharper than the built-in recorder); each kept with its time
  const cdp = await ctx.newCDPSession(p); const frames = [], marks = []; let fn = 0;
  cdp.on('Page.screencastFrame', async f => { const name = 'f' + String(++fn).padStart(5, '0') + '.jpg'; fs.writeFileSync(path.join(out, 'frames', name), Buffer.from(f.data, 'base64')); frames.push({ f: name, t: f.metadata.timestamp }); cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {}); });
  fs.rmSync(path.join(out, 'frames'), { recursive: true, force: true }); fs.mkdirSync(path.join(out, 'frames'));
  const mark = step => marks.push({ t: Date.now() / 1000, step });
  const wait = ms => p.waitForTimeout(ms);
  let cx = W / 2, cy = H / 2;
  const cap = (step, text, sub) => { mark(step ? +String(step).match(/\d+/)[0] : 0); return wait(10); };
  const card = (h, t) => p.evaluate(([a, c]) => window.__card(a, c), [h, t]);
  const box = async sel => { const l = typeof sel === 'string' ? p.locator(sel).first() : sel; await l.scrollIntoViewIfNeeded().catch(() => {}); return l.boundingBox(); };
  const moveTo = async (sel, dx = 0.5, dy = 0.5) => { const bb = await box(sel); const x = bb.x + bb.width * dx, y = bb.y + bb.height * dy; await p.mouse.move(x, y, { steps: 28 }); cx = x; cy = y; await wait(250); return bb; };
  const click = async (sel, pause = 900) => { await moveTo(sel); await p.mouse.down(); await p.mouse.up(); await wait(pause); };
  const point = async (sel, ms = 1400) => { await moveTo(sel); const l = typeof sel === 'string' ? p.locator(sel).first() : sel; await l.evaluate(e => e.classList.add('wt-hl')); await wait(ms); await l.evaluate(e => e.classList.remove('wt-hl')); };
  const type = async (sel, text) => { await click(sel, 200); await p.keyboard.press('Control+A'); await p.keyboard.type(text, { delay: 70 }); await wait(500); };
  const S = n => `Step ${n} of 9`;

  await p.goto('file://' + page_); await wait(1200);
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: W, maxHeight: H, everyNthFrame: 1 }); mark(0);
  await p.mouse.move(cx, cy);
  await card('Data Model Explorer', 'A walkthrough: from the data-model workbook to a Dataverse solution, in one offline page.'); await wait(4200);
  await card(''); await wait(700);

  // 1 open
  await cap(S(1), 'Open your data-model workbook', 'One HTML file in Chrome or Edge. Nothing to install, and nothing is uploaded.'); await wait(1800);
  await point('#btnOpen', 1500);
  await p.setInputFiles('#file', wbk); await wait(1800); await p.keyboard.press('Escape'); await wait(1500);

  // 2 overview
  await cap(S(2), 'The Overview sizes the model and shows what needs attention', 'Counts, documentation completeness, areas, checks, and shortcuts to build or compare.'); await wait(1600);
  await point('#main [data-ov] >> nth=0', 1300);
  await point('button:has-text("Open all checks")', 1300);
  await point('button:has-text("Build solution")', 1500);

  // 3 checks
  await cap(S(3), 'Checks find problems before Dataverse does', 'Missing primary names, broken lookups, invalid relationship types… updated as you edit.'); await wait(1000);
  await click('#nav .navitem[data-view="__issues"]', 1500);
  await point('[data-isev="error"]', 1000); await point('[data-act="iss-csv"]', 1100);

  // 4 erd
  await cap(S(4), 'The ERD draws itself from the lookups', 'Pick tables or areas; export to draw.io, SVG, PNG or Mermaid.'); await wait(800);
  await click('#nav .navitem[data-view="__erd"]', 900);
  await click('[data-eq="all"]', 3200);
  await point('button:has-text("draw.io")', 1400);

  // 5 table page
  await cap(S(5), 'Every table is a page you can search and edit', 'Primary key and primary name are tagged; double-click any cell to edit it.'); await wait(800);
  if (!await p.locator('#nav .navitem:has-text("Test Task")').count()) await click('#nav [data-grp="Import test"]', 500);
  await click('#nav .navitem:has-text("Test Task")', 1400);
  await point('.vhead .chips', 1400);
  const desc = p.locator('#gridwrap tbody tr:has(td[data-col="Logical Name"] .mono:text-is("formus_priority")) td[data-col="Description"]');
  await moveTo(desc); await desc.dblclick(); await wait(500); await p.keyboard.press('Control+A'); await p.keyboard.type('1 = highest, 5 = lowest', { delay: 65 }); await p.keyboard.press('Enter'); await wait(1300);

  // 6 add a field
  await cap(S(6), 'Add fields, lookups and N:N relationships', 'Names are suggested with your prefix; the relationship type is filled in for you.'); await wait(800);
  await click('[data-act="addrow"]', 900);
  await type('.solbox [data-k="Display Name"]', 'Reviewer');
  await type('.solbox [data-k="Attribute Type"]', 'Lookup');
  await p.locator('.solbox [data-k="Attribute Type"]').blur(); await wait(500);
  await type('.solbox [data-k="target"]', 'contact'); await wait(600);
  await click('.solbox [data-add="go"]', 1600);
  await click('#detail [data-dclose]', 600).catch(() => {});

  // 7 changes
  await cap(S(7), 'Every change is listed, and can be reverted', 'Edits are kept in your browser and carry over when a newer version of the workbook arrives.'); await wait(800);
  await click('#btnChanges', 2600);
  await click('[data-cclose]', 500);

  // 8 save
  await cap(S(8), 'Write your edits back into the workbook', 'Only the cells you changed are rewritten, and the file is checked before anything is saved.'); await wait(800);
  await click('#btnExport', 900);
  await point('.menu [data-x="xlsx-orig"]', 900);
  await click('.menu [data-x="xlsx-orig"]', 1000);
  await moveTo('.namebox input'); await wait(1200);
  const dl1 = p.waitForEvent('download'); await click('.namebox [data-n="1"]', 1200); await dl1;

  // 9 build
  await cap(S(9), 'Build the Dataverse solution', 'Set your publisher, check what will be built, and generate one zip with the solution and import.ps1.'); await wait(800);
  await click('#btnExport', 700); await click('.menu [data-x="solution"]', 900);
  await type('.solbox [data-k="solName"]', 'FORMUS_ImportTest');
  await type('.solbox [data-k="solDisplay"]', 'FORMUS import test');
  await point('.solbox [data-k="pubName"]', 1200);
  await type('.solbox [data-k="optPrefix"]', '75047'); await wait(500);
  await point('#solsum', 2200);
  const dl2 = p.waitForEvent('download'); await click('.solbox [data-sol="go"]', 1500); await dl2; await wait(800);
  await cap('', '');
  await card('Then import it', 'Unzip the download and run  .\\import.ps1 -EnvironmentUrl https://yourorg.crm11.dynamics.com  against a development environment. The full user guide is in the repo under data-model-explorer/docs.'); await wait(6000);

  mark(10); await wait(200);
  await cdp.send('Page.stopScreencast'); await wait(300);
  fs.writeFileSync(path.join(out, 'timeline.json'), JSON.stringify({ end: Date.now() / 1000, frames, marks }));
  console.log('frames', frames.length);
  await ctx.close();
  console.log('done', errs.length ? 'errors: ' + errs.join(' | ') : 'no page errors');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
