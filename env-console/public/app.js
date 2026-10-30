// Env Console dashboard. Talks only to its own server; all text is set with textContent.

const KNOWN_COLORS = { DEV: "#127A5C", TEST: "#2F5BD3", UAT: "#9A5800", PREPROD: "#7B3FB0", PROD: "#B42318" };
const PALETTE = ["#127A5C", "#2F5BD3", "#9A5800", "#7B3FB0", "#B42318", "#0F6A8A", "#5B6370"];
const KIND_LABEL = { flow: "Cloud flows", rule: "Business rules", plugin: "Plugin steps" };
const SVG = "http://www.w3.org/2000/svg";

// ------------------------------------------------------------------ theme

function storeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function storeSet(k, v) { try { localStorage.setItem(k, v); } catch { /* private window */ } }
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
function applyTheme() {
  const choice = storeGet("pcxTheme") || "system";
  const dark = choice === "dark" || (choice === "system" && darkQuery.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.querySelectorAll("[data-theme-choice]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.themeChoice === choice ? "true" : "false"));
}
document.querySelectorAll("[data-theme-choice]").forEach((b) => b.addEventListener("click", () => { storeSet("pcxTheme", b.dataset.themeChoice); applyTheme(); }));
darkQuery.addEventListener("change", applyTheme);
applyTheme();

// ------------------------------------------------------------------ key + api

(function takeKey() {
  const m = location.hash.match(/key=([A-Za-z0-9_-]+)/);
  if (m) {
    try { sessionStorage.setItem("pcxKey", m[1]); } catch { window.__pcxKey = m[1]; }
    history.replaceState(null, "", location.pathname + "#/overview");
  }
})();
function key() { try { return sessionStorage.getItem("pcxKey") || window.__pcxKey || ""; } catch { return window.__pcxKey || ""; } }

class NeedsLogin extends Error {}

async function api(path, body) {
  const init = { headers: { "x-pcx-request": "1" } };
  if (key()) init.headers["x-pcx-key"] = key();
  if (body !== undefined) {
    init.method = "POST";
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.login) {
    location.href = `${data.login}?returnTo=${encodeURIComponent("/" + location.hash)}`;
    throw new NeedsLogin("Signing in…");
  }
  if (res.status === 401) throw new NeedsLogin(data.error || "Not signed in");
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ------------------------------------------------------------------ dom helpers

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  setAttrs(el, attrs);
  for (const kid of kids.flat(3)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
function s(tag, attrs, ...kids) {
  const el = document.createElementNS(SVG, tag);
  setAttrs(el, attrs);
  kids.flat(3).forEach((k) => k && el.append(k instanceof Node ? k : document.createTextNode(String(k))));
  return el;
}
function setAttrs(el, attrs) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.setAttribute("class", v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "style") el.style.cssText = v; // CSSOM, allowed by the page's CSP
    else el.setAttribute(k, v === true ? "" : String(v));
  }
}

let config = null;
function envColor(name) {
  if (KNOWN_COLORS[name.toUpperCase()]) return KNOWN_COLORS[name.toUpperCase()];
  const i = config ? config.environments.findIndex((e) => e.name === name) : 0;
  return PALETTE[Math.max(0, i) % PALETTE.length];
}
const chip = (name) => h("span", { class: "chip", style: `background:${envColor(name)}` }, name);
const envOf = (name) => config.environments.find((e) => e.name === name);
const main = () => document.getElementById("main");
const mount = (...nodes) => main().replaceChildren(...nodes.flat().filter(Boolean));
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString() : "");
const fmtNum = (n) => (n ?? 0).toLocaleString();
const firstLine = (t, n = 140) => (t || "").split("\n")[0].slice(0, n);

function header(eyebrow, title, sub, ...actions) {
  return h("header", { class: "head" },
    h("div", {}, eyebrow ? h("div", { class: "eyebrow" }, eyebrow) : null, h("h1", {}, title), sub ? h("p", { class: "sub" }, sub) : null),
    actions.length ? h("div", { class: "row" }, ...actions) : null);
}
const notice = (kind, ...text) => h("div", { class: `notice ${kind}`, role: kind === "bad" ? "alert" : "status" }, ...text);
const loading = (what) => h("div", { class: "muted" }, `Loading ${what}…`);

function envPicker(current, onPick, opts = {}) {
  return h("div", { class: "row envpick", role: "group", "aria-label": opts.label || "Environment" },
    config.environments.map((e) => {
      const on = e.name === current;
      return h("button", { type: "button", "aria-pressed": on ? "true" : "false", style: on ? `background:${envColor(e.name)};border-color:${envColor(e.name)};color:#FFFFFF` : "", onclick: () => onPick(e.name) }, e.name);
    }));
}
function seg(options, current, onPick, label, role = "group") {
  return h("div", { class: "seg", role, "aria-label": label },
    options.map(([v, text]) => h("button", { type: "button", [role === "tablist" ? "aria-selected" : "aria-pressed"]: v === current ? "true" : "false", role: role === "tablist" ? "tab" : null, onclick: () => onPick(v) }, text)));
}
function checkbox(labelText, checked, onChange) {
  const box = h("input", { type: "checkbox" });
  box.checked = !!checked;
  box.addEventListener("change", () => onChange(box.checked));
  return h("label", { class: "check" }, box, labelText);
}
function reasonInput(state, envName) {
  const input = h("input", { type: "text", placeholder: "e.g. SAP outage, ticket INC-123", value: state.reason || "", "aria-label": `Reason for changes in ${envName}` });
  input.addEventListener("input", () => { state.reason = input.value; });
  return input;
}
function needsReason(envName, state) {
  const env = envOf(envName);
  if (env && env.managed && (state.reason || "").trim().length < 3) {
    state.notice = { kind: "warn", text: `${envName} is managed: enter a reason before changing anything.` };
    return true;
  }
  return false;
}
function switchButton(on, label, onClick) {
  return h("button", { type: "button", class: "switch", role: "switch", "aria-checked": on ? "true" : "false", "aria-label": label, onclick: onClick }, h("span", { class: "track" }, h("span", { class: "knob" })));
}
const tip = () => document.getElementById("tip");
function showTip(ev, title, rows) {
  const t = tip();
  t.replaceChildren(h("b", {}, title), ...rows.map(([k, v]) => h("div", { class: "r" }, h("span", {}, k), h("strong", {}, v))));
  t.hidden = false;
  const x = Math.min(ev.clientX + 14, window.innerWidth - t.offsetWidth - 8);
  t.style.left = `${x}px`;
  t.style.top = `${Math.max(8, ev.clientY - t.offsetHeight - 12)}px`;
}
const hideTip = () => { tip().hidden = true; };

// ------------------------------------------------------------------ screens shared state

const shared = { env: null };
function pickEnv(params) {
  const want = params.get("env");
  if (want && envOf(want)) shared.env = want;
  if (!shared.env || !envOf(shared.env)) shared.env = config.environments[0].name;
  return shared.env;
}

function needKeyScreen() {
  mount(header(null, "Env Console"), notice("warn", "Open the dashboard with the link printed by ", h("code", {}, "pcx serve"), ". It carries the key this page needs."));
}
function noEnvScreen() {
  mount(header(null, "Environments"), h("div", { class: "card stack" },
    h("h2", {}, "No environments yet"),
    h("p", { class: "muted" }, "Add them from a terminal, then reload this page:"),
    h("p", {}, h("code", {}, "pcx env add DEV https://<org>-dev.crm.dynamics.com --unmanaged")),
    h("p", {}, h("code", {}, "pcx env add PROD https://<org>.crm.dynamics.com"))));
}

// ------------------------------------------------------------------ overview

async function overview() {
  const cards = new Map();
  const grid = h("section", { class: "grid", "aria-label": "Environments" });
  for (const e of config.environments) {
    const card = h("article", { class: "card stack" },
      h("div", { class: "row between" }, chip(e.name), h("span", { class: e.managed ? "pill" : "pill ok" }, e.managed ? "Managed" : "Unmanaged")),
      h("div", { class: "mono muted" }, e.url), h("div", { class: "muted small" }, "Checking…"));
    cards.set(e.name, card);
    grid.append(card);
  }
  const via = config.mode === "hosted" ? `signed in as ${config.user}` : `signed in through ${config.provider === "azps" ? "PowerShell" : "Azure CLI"}`;
  mount(header("Overview", "Environments", `${config.environments.length} environments · ${via}`, h("button", { class: "btn", type: "button", onclick: () => overview() }, "Refresh")), grid);
  let anyLogin = false;
  await Promise.all(config.environments.map(async (e) => {
    const card = cards.get(e.name);
    let st;
    try { st = await api(`/api/status?env=${encodeURIComponent(e.name)}`); } catch (err) { st = { connected: false, error: err.message }; }
    if (st.needsLogin) anyLogin = true;
    if (st.connected && st.user && config.mode !== "hosted") document.getElementById("who").textContent = `Signed in as ${st.user}`;
    const q = `?env=${encodeURIComponent(e.name)}`;
    const body = st.connected
      ? [h("div", { class: "row small" }, h("span", { class: "dot ok" }), h("strong", {}, "Connected"), h("span", { class: "muted" }, st.version ? `v${st.version}` : "")),
         h("dl", { class: "stats" },
           h("div", {}, h("dt", {}, "Solutions"), h("dd", {}, st.solutions ?? "—")),
           h("div", {}, h("dt", {}, "Flows on"), h("dd", {}, st.flowsTotal !== undefined ? `${st.flowsOn} / ${st.flowsTotal}` : "—")),
           h("div", {}, h("dt", {}, "Plugin steps on"), h("dd", {}, st.pluginStepsTotal !== undefined ? `${st.pluginStepsOn} / ${st.pluginStepsTotal}` : "—"))),
         st.error ? h("div", { class: "small muted" }, st.error) : null,
         h("div", { class: "row small" }, h("a", { href: `#/components${q}` }, "Flows & plugins"), h("a", { href: `#/runs${q}` }, "Run history"), h("a", { href: `#/audit${q}` }, "Audit"))]
      : [h("div", { class: "row small" }, h("span", { class: "dot bad" }), h("strong", {}, st.needsLogin ? "Sign-in needed" : "Not reachable")), h("div", { class: "small muted" }, st.error || "")];
    card.replaceChildren(card.children[0], card.children[1], ...body.filter(Boolean));
  }));
  if (anyLogin && config.mode !== "hosted") main().insertBefore(notice("warn", "Some environments need you to sign in. In a terminal run ", h("code", {}, "pcx auth login"), ", then press Refresh."), grid);
}

// ------------------------------------------------------------------ solutions

const solState = { q: "", pubs: new Set(), ms: false, diff: false, data: null };
async function loadSolutions(force) {
  if (!solState.data || force) solState.data = await api("/api/solutions");
  return solState.data;
}
async function solutions() {
  mount(header("Solutions", "Installed solutions"), loading("solutions from every environment"));
  try { await loadSolutions(true); } catch (err) { return mount(header("Solutions", "Installed solutions"), notice("bad", err.message)); }
  renderSolutions();
}
function renderSolutions() {
  const d = solState.data;
  const ref = d.environments[d.environments.length - 1];
  const pubKey = (p) => p.uniqueName || p.friendlyName;
  const q = solState.q.trim().toLowerCase();
  const rows = d.rows.filter((r) => {
    const picked = solState.pubs.size > 0 && solState.pubs.has(pubKey(r.publisher));
    if (solState.pubs.size > 0 && !picked) return false;
    if (r.isMicrosoft && !solState.ms && !picked) return false;
    if (q && !`${r.friendlyName} ${r.uniqueName}`.toLowerCase().includes(q)) return false;
    if (solState.diff && !r.differs) return false;
    return true;
  });
  const hiddenMs = solState.ms ? 0 : d.rows.filter((r) => r.isMicrosoft && !solState.pubs.has(pubKey(r.publisher))).length;
  const search = h("input", { type: "search", placeholder: "Search name or unique name", value: solState.q, "aria-label": "Search solutions" });
  search.addEventListener("input", () => { solState.q = search.value; const pos = search.selectionStart; renderSolutions(); const el = main().querySelector("input[type=search]"); el.focus(); el.setSelectionRange(pos, pos); });
  const pubs = d.publishers.filter((p) => solState.ms || !p.isMicrosoft || solState.pubs.has(pubKey(p.publisher)));
  mount(
    header("Solutions", "Installed solutions", `Every solution in every environment, with its version. Highlighted versions differ from ${ref}.`, h("button", { class: "btn", type: "button", onclick: () => solutions() }, "Refresh")),
    Object.entries(d.errors || {}).map(([env, msg]) => notice("bad", `${env}: ${msg}`)),
    h("section", { class: "card stack", "aria-label": "Filters" },
      h("div", { class: "row" }, h("label", { class: "search" }, search),
        checkbox("Show Microsoft solutions", solState.ms, (v) => { solState.ms = v; renderSolutions(); }),
        checkbox("Only version differences", solState.diff, (v) => { solState.diff = v; renderSolutions(); })),
      h("div", { class: "row", role: "group", "aria-label": "Publisher" },
        h("span", { class: "small", style: "font-weight:600" }, "Publisher"),
        pubs.map((p) => {
          const k = pubKey(p.publisher);
          return h("button", { type: "button", class: "pub", "aria-pressed": solState.pubs.has(k) ? "true" : "false", onclick: () => { solState.pubs.has(k) ? solState.pubs.delete(k) : solState.pubs.add(k); renderSolutions(); } },
            p.publisher.friendlyName || k, h("span", { class: "mono" }, p.publisher.prefix), h("span", { class: "n" }, p.count));
        }),
        solState.pubs.size ? h("button", { type: "button", class: "btn link", onclick: () => { solState.pubs.clear(); renderSolutions(); } }, "Clear") : null)),
    h("section", { class: "card flush", "aria-label": "Solutions" },
      h("h2", { style: "padding:16px 20px 8px" }, `${rows.length} solutions `, hiddenMs ? h("span", { class: "muted", style: "font-weight:400" }, `· ${hiddenMs} Microsoft solutions hidden`) : null),
      rows.length === 0 ? h("div", { class: "empty" }, "No solutions match these filters.") :
      h("div", { class: "scroll" }, h("table", {},
        h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Solution"), h("th", { scope: "col" }, "Publisher"), d.environments.map((n) => h("th", { scope: "col", style: `color:${envColor(n)};font-weight:600` }, n)), h("th", { scope: "col" }, h("span", { class: "sr" }, "Actions")))),
        h("tbody", {}, rows.map((r) => h("tr", {},
          h("th", { scope: "row" }, h("div", { style: "font-weight:600" }, r.friendlyName), h("div", { class: "mono muted" }, r.uniqueName)),
          h("td", {}, h("div", {}, r.publisher.friendlyName), h("div", { class: "mono muted" }, r.publisher.prefix)),
          d.environments.map((n) => {
            const v = r.versions[n];
            if (v === undefined) return h("td", { class: "muted" }, "?");
            if (v === null) return h("td", { class: "muted" }, "—");
            const refV = r.versions[ref];
            return h("td", { style: "white-space:nowrap" }, h("span", { class: refV && refV.version === v.version ? "ver" : "ver diff" }, v.version), h("span", { class: v.isManaged ? "tag" : "tag u" }, v.isManaged ? "M" : "U"));
          }),
          h("td", {}, h("a", { href: `#/compare?solution=${encodeURIComponent(r.uniqueName)}` }, "Compare"))))))),
      h("p", { class: "small muted", style: "margin:0;padding:12px 20px 16px" }, "M = managed, U = unmanaged, — = not installed, ? = environment could not be read."))
  );
}

// ------------------------------------------------------------------ solution compare

const STATUS = {
  layer: ["Unmanaged change", "warn"], different: ["Different", "info"], onlyA: ["Only in A", "bad"], onlyB: ["Only in B", "bad"], present: ["In both", ""], same: ["Same", "ok"]
};
const cmpState = { solution: "", a: null, b: null, filter: "changes", result: null, busy: false, error: null, sel: null, diff: null, ms: false };
async function compare(params) {
  if (params.get("solution")) cmpState.solution = params.get("solution");
  const names = config.environments.map((e) => e.name);
  if (!cmpState.a || !envOf(cmpState.a)) cmpState.a = names[Math.max(0, names.length - 2)];
  if (!cmpState.b || !envOf(cmpState.b)) cmpState.b = names[names.length - 1];
  renderCompare();
  if (!solState.data) { try { await loadSolutions(); } catch (err) { cmpState.error = err.message; } renderCompare(); }
  if (cmpState.solution && params.get("solution")) runCompare();
}
async function runCompare() {
  if (!cmpState.solution) return;
  cmpState.busy = true; cmpState.error = null; cmpState.result = null; cmpState.sel = null; cmpState.diff = null;
  renderCompare();
  try {
    cmpState.result = await api(`/api/compare?solution=${encodeURIComponent(cmpState.solution)}&a=${encodeURIComponent(cmpState.a)}&b=${encodeURIComponent(cmpState.b)}`);
  } catch (err) { cmpState.error = err.message; }
  cmpState.busy = false;
  renderCompare();
}
async function showDiff(row) {
  cmpState.sel = row; cmpState.diff = { loading: true };
  renderCompare();
  try { cmpState.diff = await api(`/api/compare/diff?a=${encodeURIComponent(cmpState.a)}&b=${encodeURIComponent(cmpState.b)}&type=${row.type}&id=${row.objectId}`); }
  catch (err) { cmpState.diff = { error: err.message }; }
  renderCompare();
  document.getElementById("diff-panel")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
function renderCompare() {
  const solRows = solState.data ? solState.data.rows.filter((r) => cmpState.ms || !r.isMicrosoft) : [];
  const select = h("select", { class: "input", "aria-label": "Solution", style: "min-width:260px" },
    h("option", { value: "" }, solState.data ? "Choose a solution…" : "Loading solutions…"),
    solRows.map((r) => h("option", { value: r.uniqueName, selected: r.uniqueName === cmpState.solution }, `${r.friendlyName} (${r.uniqueName})`)));
  select.addEventListener("change", () => { cmpState.solution = select.value; cmpState.result = null; renderCompare(); });
  const r = cmpState.result;
  const A = cmpState.a, B = cmpState.b;
  const label = (st) => (st === "onlyA" ? `Only in ${A}` : st === "onlyB" ? `Only in ${B}` : STATUS[st][0]);
  const filters = [["changes", "Differences"], ["layer", "Unmanaged changes"], ["onlyA", `Only in ${A}`], ["onlyB", `Only in ${B}`], ["same", "Same"], ["all", "All"]];
  const rows = r ? r.rows.filter((x) => cmpState.filter === "all" || (cmpState.filter === "changes" ? ["layer", "different", "onlyA", "onlyB"].includes(x.status) : x.status === cmpState.filter)) : [];
  mount(
    header("Solutions", "Solution compare", "Compares every component of a solution between two environments: what is missing, what differs, and what was changed directly in a managed environment."),
    h("section", { class: "card stack", "aria-label": "What to compare" },
      h("div", { class: "row", style: "align-items:flex-end;gap:16px" },
        h("label", { class: "field" }, h("span", {}, "Solution"), select),
        h("div", { class: "field" }, h("span", {}, "From"), envPicker(A, (n) => { cmpState.a = n; cmpState.result = null; renderCompare(); }, { label: "From environment" })),
        h("div", { class: "field" }, h("span", {}, "To"), envPicker(B, (n) => { cmpState.b = n; cmpState.result = null; renderCompare(); }, { label: "To environment" })),
        h("button", { type: "button", class: "btn primary", disabled: !cmpState.solution || cmpState.busy || A === B, onclick: runCompare }, cmpState.busy ? "Comparing…" : "Compare")),
      checkbox("Include Microsoft solutions in the list", cmpState.ms, (v) => { cmpState.ms = v; renderCompare(); }),
      A === B ? h("div", { class: "small muted" }, "Pick two different environments.") : null),
    cmpState.error ? notice("bad", cmpState.error) : null,
    cmpState.busy ? loading("components from both environments (this can take a minute for large solutions)") : null,
    r ? [
      h("div", { class: "row small muted" }, chip(A), ` ${r.a.installed ? r.a.version : "not installed"}`, h("span", { "aria-hidden": "true" }, "→"), chip(B), ` ${r.b.installed ? r.b.version : "not installed"}`),
      h("section", { class: "tiles", "aria-label": "Summary" },
        [["different", "Different"], ["layer", "Unmanaged changes"], ["onlyA", `Only in ${A}`], ["onlyB", `Only in ${B}`], ["same", "Same"], ["present", "In both, not compared"]].map(([k, t]) =>
          h("div", { class: "tile" }, h("div", { class: "k" }, t), h("div", { class: "v" }, fmtNum(r.counts[k]))))),
      r.contentLimited ? notice("info", "This solution is large: only the first 400 components were compared line by line. The rest show as \"In both\".") : null,
      seg(filters, cmpState.filter, (v) => { cmpState.filter = v; renderCompare(); }, "Show"),
      h("div", { class: "cols" },
        h("section", { class: "card flush", style: "flex:3 1 560px", "aria-label": "Components" },
          rows.length === 0 ? h("div", { class: "empty" }, cmpState.filter === "changes" ? "No differences. The two environments match for this solution." : "Nothing in this view.") :
          h("div", { class: "scroll" }, h("table", {},
            h("thead", {}, h("tr", {}, ["Status", "Type", "Name", "Table", ""].map((t) => h("th", { scope: "col" }, t)))),
            h("tbody", {}, rows.map((x) => h("tr", { class: cmpState.sel && cmpState.sel.objectId === x.objectId && cmpState.sel.type === x.type ? "sel" : "" },
              h("td", {}, h("span", { class: `pill ${STATUS[x.status][1]}` }, label(x.status))),
              h("td", { class: "muted" }, x.typeName),
              h("th", { scope: "row" }, x.name),
              h("td", { class: "muted" }, x.parent || ""),
              h("td", { style: "text-align:right" }, x.diffable && x.inA && x.inB ? h("button", { type: "button", class: "btn sm", onclick: () => showDiff(x) }, "View diff") : null))))))),
        cmpState.sel ? h("section", { id: "diff-panel", class: "card stack", style: "flex:2 1 420px", "aria-label": "Difference" },
          h("div", {}, h("div", { class: "small muted" }, cmpState.sel.typeName + (cmpState.sel.parent ? ` · ${cmpState.sel.parent}` : "")), h("h2", {}, cmpState.sel.name)),
          h("div", { class: "row small" }, chip(A), h("span", { "aria-hidden": "true" }, "→"), chip(B), h("span", { class: "muted" }, "red lines are only in " + A + ", green only in " + B)),
          (cmpState.sel.layerA || cmpState.sel.layerB) ? notice("warn", `Someone changed this directly in ${cmpState.sel.layerA ? A : B}, which is managed. That unmanaged change hides the next import: remove it in the maker portal, or move the change back to DEV.`) : null,
          cmpState.diff?.loading ? loading("both definitions") :
          cmpState.diff?.error ? notice("bad", cmpState.diff.error) :
          cmpState.diff?.tooLarge ? notice("info", "These definitions are too large to show line by line, but they are different.") :
          cmpState.diff && !cmpState.diff.changed ? notice("ok", "The definitions are identical.") :
          cmpState.diff ? h("div", { class: "code" }, cmpState.diff.lines.map((l) => h("div", { class: l.t === "ctx" ? "" : l.t }, (l.t === "add" ? "+ " : l.t === "del" ? "- " : l.t === "skip" ? "" : "  ") + l.text))) : null)
        : null)
    ] : null
  );
}

// ------------------------------------------------------------------ flows, rules, plugins

const compState = { kind: "flow", sel: new Set(), reason: "", data: null, notice: null, all: false, q: "" };
async function components(params) {
  pickEnv(params);
  if (params.get("kind") && KIND_LABEL[params.get("kind")]) compState.kind = params.get("kind");
  if (params.get("q") !== null) compState.q = params.get("q") || "";
  compState.sel.clear();
  compState.data = null;
  renderComponents();
  try { compState.data = await api(`/api/components?env=${encodeURIComponent(shared.env)}&kind=${compState.kind}${compState.all ? "&all=1" : ""}`); }
  catch (err) { compState.data = { error: err.message, items: [] }; }
  renderComponents();
}
async function setState(ids, on) {
  if (needsReason(shared.env, compState)) { renderComponents(); return; }
  try {
    const { results } = await api("/api/components/state", { env: shared.env, kind: compState.kind, ids, on, reason: compState.reason });
    const failed = results.filter((r) => !r.ok);
    compState.notice = failed.length
      ? { kind: "bad", text: `${results.length - failed.length} changed, ${failed.length} failed: ${failed.map((f) => `${f.name} (${f.error})`).join("; ")}` }
      : { kind: "ok", text: `${results.length} ${results.length === 1 ? "item" : "items"} turned ${on ? "on" : "off"} in ${shared.env}${envOf(shared.env).managed ? " · reason logged" : ""}.` };
  } catch (err) { compState.notice = { kind: "bad", text: err.message }; }
  await components(new URLSearchParams());
}
function renderComponents() {
  const env = envOf(shared.env);
  const d = compState.data;
  const q = compState.q.trim().toLowerCase();
  const items = d ? d.items.filter((i) => !q || `${i.name} ${i.target} ${i.solution || ""}`.toLowerCase().includes(q)) : [];
  const search = h("input", { type: "search", placeholder: "Search name, table or solution", value: compState.q, "aria-label": "Search" });
  search.addEventListener("input", () => { compState.q = search.value; const pos = search.selectionStart; renderComponents(); const el = main().querySelector("input[type=search]"); el.focus(); el.setSelectionRange(pos, pos); });
  const allBox = h("input", { type: "checkbox", "aria-label": "Select all shown" });
  allBox.checked = items.length > 0 && items.every((i) => compState.sel.has(i.id));
  allBox.addEventListener("change", () => { allBox.checked ? items.forEach((i) => compState.sel.add(i.id)) : compState.sel.clear(); renderComponents(); });
  const reason = reasonInput(compState, env.name);
  const onCount = items.filter((i) => i.on).length;
  const bulk = compState.sel.size
    ? h("section", { class: "bulk", "aria-label": "Change selected" },
        h("strong", {}, `${compState.sel.size} selected`),
        env.managed ? h("label", {}, `Reason (required in ${env.name})`, reason) : null,
        h("div", { class: "row", style: "margin-left:auto" },
          h("button", { type: "button", class: "btn good", onclick: () => setState([...compState.sel], true) }, "Turn on"),
          h("button", { type: "button", class: "btn ghost", onclick: () => setState([...compState.sel], false) }, "Turn off"),
          h("button", { type: "button", class: "btn ghost", style: "border:0", onclick: () => { compState.sel.clear(); renderComponents(); } }, "Clear")))
    : env.managed ? h("label", { class: "card row small", style: "padding:10px 16px" }, h("strong", {}, `Reason for changes in ${env.name}`), h("span", { style: "flex:1;display:flex" }, Object.assign(reason, { className: "input", style: "flex:1" }))) : null;
  mount(
    header("Automation", "Flows, business rules & plugins", "Turn items on or off one at a time, or tick several and change them together.", envPicker(env.name, (n) => { shared.env = n; compState.notice = null; components(new URLSearchParams()); })),
    h("div", { class: "row between" },
      seg(Object.entries(KIND_LABEL), compState.kind, (k) => { compState.kind = k; compState.notice = null; components(new URLSearchParams()); }, "Type", "tablist"),
      h("div", { class: "row" }, h("label", { class: "search" }, search),
        checkbox("Show Microsoft and system items", compState.all, (v) => { compState.all = v; components(new URLSearchParams()); }))),
    compState.notice ? notice(compState.notice.kind, compState.notice.text) : null,
    bulk,
    h("section", { class: "card flush", "aria-label": KIND_LABEL[compState.kind] },
      !d ? h("div", { class: "empty" }, "Loading…") :
      d.error ? h("div", { style: "padding:16px" }, notice("bad", d.error)) :
      items.length === 0 ? h("div", { class: "empty" }, `No ${KIND_LABEL[compState.kind].toLowerCase()} ${q ? "match your search" : `in ${env.name}`}${compState.all ? "" : " (custom only)"}.`) :
      [h("div", { class: "row between small muted", style: "padding:12px 20px" }, h("span", {}, `${items.length} shown · ${onCount} on · ${items.length - onCount} off`), h("span", {}, compState.all ? "Including Microsoft and system items" : "Custom items only")),
       h("div", { class: "scroll" }, h("table", {},
        h("thead", {}, h("tr", {}, h("th", { scope: "col", style: "width:44px" }, allBox), h("th", { scope: "col" }, "Name"), h("th", { scope: "col" }, compState.kind === "plugin" ? "Table · message · stage" : "Table"), h("th", { scope: "col" }, "Solution"), h("th", { scope: "col" }, "Modified"), h("th", { scope: "col", style: "text-align:right" }, "State"))),
        h("tbody", {}, items.map((i) => {
          const box = h("input", { type: "checkbox", "aria-label": `Select ${i.name}` });
          box.checked = compState.sel.has(i.id);
          box.addEventListener("change", () => { box.checked ? compState.sel.add(i.id) : compState.sel.delete(i.id); renderComponents(); });
          return h("tr", { class: compState.sel.has(i.id) ? "sel" : "" },
            h("td", {}, box),
            h("th", { scope: "row" }, i.name, i.custom ? null : h("span", { class: "pill", style: "margin-left:8px" }, "Microsoft / system")),
            h("td", { class: "muted" }, i.target),
            h("td", { class: "muted small" }, i.solution || ""),
            h("td", { class: "muted small", style: "white-space:nowrap" }, fmtDate(i.modifiedOn)),
            h("td", { style: "text-align:right;white-space:nowrap" },
              h("span", { class: "small", style: `font-weight:600;margin-right:6px;color:${i.on ? "var(--ok)" : "var(--muted)"}` }, i.on ? "On" : "Off"),
              switchButton(i.on, `${i.on ? "Turn off" : "Turn on"} ${i.name}`, () => setState([i.id], !i.on))));
        }))))]),
    h("p", { class: "small muted", style: "margin:0" }, "Every change is logged on the Activity page. Managed environments need a reason for each change.")
  );
}

// ------------------------------------------------------------------ run history

const runState = { since: "7d", data: null, error: null, tab: "flows", failedOnly: true, open: null, reason: "", notice: null };
async function runs(params) {
  pickEnv(params);
  runState.data = null; runState.error = null; runState.open = null;
  renderRuns();
  try { runState.data = await api(`/api/runs?env=${encodeURIComponent(shared.env)}&since=${runState.since}`); }
  catch (err) { runState.error = err.message; }
  renderRuns();
}
async function setTrace(setting) {
  if (needsReason(shared.env, runState)) { renderRuns(); return; }
  try {
    await api("/api/runs/trace", { env: shared.env, setting, reason: runState.reason });
    runState.notice = { kind: "ok", text: `Plugin trace log in ${shared.env} set to "${setting}".` };
  } catch (err) { runState.notice = { kind: "bad", text: err.message }; }
  await runs(new URLSearchParams());
}

/** Stacked daily bars: succeeded below, failed on top, 2px gap, rounded top. */
function dailyChart(points, series, label, W = 760) {
  const H = 220, L = 40, R = 8, T = 10, B = 26;
  const totals = points.map((p) => series.reduce((a, s) => a + (p[s.key] || 0), 0));
  const max = Math.max(1, ...totals);
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const y = (v) => T + (H - T - B) * (1 - v / top);
  const bw = (W - L - R) / points.length;
  const barW = Math.max(3, Math.min(28, bw * 0.6));
  const svg = s("svg", { class: "chart", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": label });
  const grid = s("g", { class: "grid" });
  for (let v = 0; v <= top; v += step) {
    grid.append(s("line", { x1: L, x2: W - R, y1: y(v), y2: y(v) }), s("text", { x: L - 6, y: y(v) + 4, "text-anchor": "end" }, fmtNum(v)));
  }
  svg.append(grid);
  const every = Math.ceil(points.length / 10);
  points.forEach((p, i) => {
    const cx = L + bw * i + bw / 2;
    const col = s("g", { class: "col" });
    let base = 0;
    series.forEach((ser, si) => {
      const v = p[ser.key] || 0;
      if (!v) return;
      const y0 = y(base) - (base > 0 ? 2 : 0);
      const y1 = y(base + v);
      const isTop = series.slice(si + 1).every((s2) => !(p[s2.key] || 0));
      col.append(s("path", { class: `mark ${ser.cls}`, d: barPath(cx - barW / 2, y1, barW, Math.max(1, y0 - y1), isTop ? Math.min(4, barW / 2) : 0) }));
      base += v;
    });
    const hit = s("rect", { class: "hit", x: L + bw * i, y: T, width: bw, height: H - T - B });
    const day = new Date(p.day + "T00:00:00Z").toLocaleDateString(undefined, { day: "numeric", month: "short" });
    hit.addEventListener("mousemove", (ev) => showTip(ev, day, series.map((ser) => [ser.label, fmtNum(p[ser.key] || 0)])));
    hit.addEventListener("mouseleave", hideTip);
    col.append(hit);
    svg.append(col);
    if (i % every === 0) svg.append(s("text", { x: cx, y: H - 8, "text-anchor": "middle" }, day));
  });
  return svg;
}
function barPath(x, y, w, h, r) {
  if (r <= 0) return `M${x},${y}h${w}v${h}h${-w}Z`;
  r = Math.min(r, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}
function niceStep(max) {
  const raw = max / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  const n = raw / p;
  return Math.max(1, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p);
}
function legend(items) {
  return h("div", { class: "legend" }, items.map((i) => h("span", {}, h("i", { style: `background:var(${i.color})` }), i.label)));
}

function renderRuns() {
  const env = envOf(shared.env);
  const d = runState.data;
  const head = header("Monitoring", "Run history", "Cloud flow runs and plugin errors, with the error behind every failure.",
    envPicker(env.name, (n) => { shared.env = n; runState.notice = null; runs(new URLSearchParams()); }),
    seg([["24h", "24 hours"], ["7d", "7 days"], ["30d", "30 days"]], runState.since, (v) => { runState.since = v; runs(new URLSearchParams()); }, "Time range"));
  if (runState.error) return mount(head, notice("bad", runState.error));
  if (!d) return mount(head, loading(`runs from ${env.name}`));
  const t = d.totals;
  const rate = t.flowRuns ? Math.round((t.flowFailed / t.flowRuns) * 1000) / 10 : 0;
  const trace = d.plugins.setting;
  const flowSeries = [{ key: "flowSucceeded", label: "Succeeded", cls: "ok", color: "--chart-ok" }, { key: "flowFailed", label: "Failed", cls: "bad", color: "--chart-bad" }];
  const pluginSeries = trace === "all"
    ? [{ key: "pluginSucceeded", label: "Succeeded", cls: "ok", color: "--chart-ok" }, { key: "pluginFailed", label: "Failed", cls: "bad", color: "--chart-bad" }]
    : [{ key: "pluginFailed", label: "Errors", cls: "bad", color: "--chart-bad" }];
  const maxFail = Math.max(1, ...d.top.map((g) => g.failures));
  const flowRows = d.flows.runs.filter((r) => !runState.failedOnly || r.status === "failed");
  const logRows = d.plugins.logs.filter((l) => !runState.failedOnly || l.failed);
  const reason = reasonInput(runState, env.name);
  reason.className = "input";
  mount(
    head,
    runState.notice ? notice(runState.notice.kind, runState.notice.text) : null,
    h("section", { class: "tiles", "aria-label": "Totals" },
      h("div", { class: "tile" }, h("div", { class: "k" }, "Flow runs"), h("div", { class: "v" }, fmtNum(t.flowRuns)), h("div", { class: "d" }, d.flows.available ? `last ${runState.since}` : "run history not available")),
      h("div", { class: "tile" }, h("div", { class: "k" }, "Failed flow runs"), h("div", { class: "v", style: t.flowFailed ? "color:var(--bad)" : "" }, fmtNum(t.flowFailed)), h("div", { class: "d" }, `${rate}% of runs`)),
      h("div", { class: "tile" }, h("div", { class: "k" }, "Plugin errors"), h("div", { class: "v", style: t.pluginFailed ? "color:var(--bad)" : "" }, fmtNum(t.pluginFailed)), h("div", { class: "d" }, `trace log: ${trace || "unknown"}`)),
      h("div", { class: "tile" }, h("div", { class: "k" }, "Components failing"), h("div", { class: "v" }, fmtNum(d.top.length)), h("div", { class: "d" }, "flows and plugins"))),
    trace === "off" || trace === undefined
      ? notice("warn", `Plugin tracing is ${trace || "unknown"} in ${env.name}, so plugin errors are not recorded. Turn it on below.`)
      : null,
    !d.flows.available ? notice("info", d.flows.error || "Flow run history is not stored in Dataverse for this environment.") : null,
    h("div", { class: "cols" },
      h("section", { class: "card stack", style: "flex:3 1 520px", "aria-label": "Flow runs per day" },
        h("div", { class: "row between" }, h("h2", {}, "Flow runs per day"), legend(flowSeries)),
        dailyChart(d.daily, flowSeries, `Flow runs per day in ${env.name}: succeeded and failed`)),
      h("section", { class: "card stack", style: "flex:2 1 360px", "aria-label": "Plugin activity per day" },
        h("div", { class: "row between" }, h("h2", {}, trace === "all" ? "Plugin executions per day" : "Plugin errors per day"), pluginSeries.length > 1 ? legend(pluginSeries) : null),
        dailyChart(d.daily, pluginSeries, `Plugin ${trace === "all" ? "executions" : "errors"} per day in ${env.name}`, 480))),
    h("div", { class: "cols" },
      h("section", { class: "card", style: "flex:3 1 520px", "aria-label": "Most failures" },
        h("h2", {}, "Most failures"),
        d.top.length === 0 ? h("p", { class: "muted" }, "Nothing failed in this period.") :
        h("ul", { class: "list" }, d.top.slice(0, 10).map((g) => h("li", { style: "display:grid;grid-template-columns:minmax(0,1fr) 140px 64px auto;gap:12px;align-items:center;padding:10px 0" },
          h("div", { style: "min-width:0" }, h("div", { style: "font-weight:600" }, g.name), h("div", { class: "small muted", style: "overflow:hidden;text-overflow:ellipsis;white-space:nowrap" }, `${g.kind === "flow" ? "Cloud flow" : "Plugin"} · ${firstLine(g.lastError, 120)}`)),
          h("span", { class: "bar-track", "aria-hidden": "true" }, h("span", { class: "bar-fill", style: `width:${Math.round((g.failures / maxFail) * 100)}%` })),
          h("span", { class: "small", style: "text-align:right" }, h("strong", { style: "color:var(--bad)" }, g.failures), ` / ${g.total}`),
          h("a", { class: "btn sm", href: `#/components?env=${encodeURIComponent(env.name)}&kind=${g.kind === "flow" ? "flow" : "plugin"}&q=${encodeURIComponent(g.kind === "flow" ? g.name : g.name.split(".").pop())}` }, "Turn off…"))))),
      h("section", { class: "card stack", style: "flex:2 1 360px", "aria-label": "Plugin trace log" },
        h("h2", {}, "Plugin trace log"),
        h("p", { class: "small muted", style: "margin:0" }, "\"Exceptions\" records only failures (recommended). \"All\" records every execution, which adds load; use it briefly."),
        seg([["off", "Off"], ["exceptions", "Exceptions"], ["all", "All"]], trace, (v) => { if (v !== trace) setTrace(v); }, "Trace setting"),
        env.managed ? h("label", { class: "field" }, h("span", {}, `Reason (required in ${env.name})`), reason) : null)),
    h("section", { class: "card flush", "aria-label": "Runs" },
      h("div", { class: "row between", style: "padding:12px 20px" },
        seg([["flows", `Flow runs (${flowRows.length})`], ["plugins", `Plugin log (${logRows.length})`]], runState.tab, (v) => { runState.tab = v; runState.open = null; renderRuns(); }, "Run list", "tablist"),
        checkbox("Failures only", runState.failedOnly, (v) => { runState.failedOnly = v; renderRuns(); })),
      runState.tab === "flows" ? runTable(flowRows) : pluginTable(logRows))
  );
}
function statusPill(status) {
  const map = { succeeded: ["Succeeded", "ok"], failed: ["Failed", "bad"], cancelled: ["Cancelled", ""], running: ["Running", "info"], other: ["Other", ""] };
  const [t, c] = map[status] || [status, ""];
  return h("span", { class: `pill ${c}` }, t);
}
function runTable(rows) {
  if (!rows.length) return h("div", { class: "empty" }, runState.failedOnly ? "No failed flow runs in this period." : "No flow runs in this period.");
  return h("div", { class: "scroll" }, h("table", {},
    h("thead", {}, h("tr", {}, ["Status", "Flow", "Started", "Duration", "Error", ""].map((t) => h("th", { scope: "col" }, t)))),
    h("tbody", {}, rows.slice(0, 300).flatMap((r) => {
      const open = runState.open === r.id;
      const main = h("tr", { class: open ? "sel" : "" },
        h("td", {}, statusPill(r.status)),
        h("th", { scope: "row" }, r.flowName),
        h("td", { class: "small", style: "white-space:nowrap" }, fmtDate(r.start)),
        h("td", { class: "mono" }, r.durationMs !== undefined ? `${(r.durationMs / 1000).toFixed(1)}s` : ""),
        h("td", { class: "small", style: "color:var(--bad-text);max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" }, r.errorCode || firstLine(r.errorMessage)),
        h("td", { style: "text-align:right" }, (r.errorMessage || r.link) ? h("button", { type: "button", class: "btn sm", "aria-expanded": open ? "true" : "false", onclick: () => { runState.open = open ? null : r.id; renderRuns(); } }, open ? "Hide" : "Details") : null));
      if (!open) return [main];
      return [main, h("tr", {}, h("td", { colspan: 6 }, h("div", { class: "stack" },
        r.errorMessage ? h("div", { class: "code wrap" }, h("div", {}, r.errorMessage)) : null,
        h("div", { class: "row small muted" }, r.trigger ? `Trigger: ${r.trigger}` : null, r.link ? h("a", { href: r.link, target: "_blank", rel: "noopener noreferrer" }, "Open this run in Power Automate") : null))))];
    }))));
}
function pluginTable(rows) {
  if (!rows.length) return h("div", { class: "empty" }, runState.failedOnly ? "No plugin errors recorded in this period." : "Nothing in the plugin trace log for this period.");
  return h("div", { class: "scroll" }, h("table", {},
    h("thead", {}, h("tr", {}, ["Status", "Plugin", "Message", "When", "Duration", ""].map((t) => h("th", { scope: "col" }, t)))),
    h("tbody", {}, rows.slice(0, 300).flatMap((l) => {
      const open = runState.open === l.id;
      const main = h("tr", { class: open ? "sel" : "" },
        h("td", {}, statusPill(l.failed ? "failed" : "succeeded")),
        h("th", { scope: "row" }, l.typeName, h("div", { class: "small muted", style: "color:var(--bad-text)" }, l.failed ? firstLine(l.exception, 120) : "")),
        h("td", { class: "small" }, `${l.table || "any"} · ${l.message} · ${l.mode}`),
        h("td", { class: "small", style: "white-space:nowrap" }, fmtDate(l.at)),
        h("td", { class: "mono" }, l.durationMs !== undefined ? `${l.durationMs} ms` : ""),
        h("td", { style: "text-align:right" }, h("button", { type: "button", class: "btn sm", "aria-expanded": open ? "true" : "false", onclick: () => { runState.open = open ? null : l.id; renderRuns(); } }, open ? "Hide" : "Details")));
      if (!open) return [main];
      return [main, h("tr", {}, h("td", { colspan: 6 }, h("div", { class: "stack" },
        l.exception ? [h("h3", {}, "Exception"), h("div", { class: "code wrap" }, l.exception.split("\n").map((x) => h("div", {}, x)))] : null,
        l.trace ? [h("h3", {}, "Trace"), h("div", { class: "code wrap" }, l.trace.split("\n").map((x) => h("div", {}, x)))] : null,
        h("div", { class: "small muted" }, `Depth ${l.depth ?? "?"} · correlation ${l.correlationId || "?"}`))))];
    }))));
}

// ------------------------------------------------------------------ audit

const audState = { system: null, tables: null, table: null, columns: null, column: null, log: null, since: "7d", q: "", only: "all", selT: new Set(), selC: new Set(), reason: "", notice: null, error: null };
async function audit(params) {
  const before = shared.env;
  pickEnv(params);
  if (before !== shared.env || !audState.tables) Object.assign(audState, { system: null, tables: null, table: null, columns: null, column: null, log: null, error: null });
  renderAudit();
  try {
    const [sys, tables] = await Promise.all([api(`/api/audit/system?env=${encodeURIComponent(shared.env)}`), api(`/api/audit/tables?env=${encodeURIComponent(shared.env)}`)]);
    audState.system = sys; audState.tables = tables.tables;
  } catch (err) { audState.error = err.message; }
  renderAudit();
  if (audState.table) loadAuditTable(audState.table);
}
async function loadAuditTable(t) {
  audState.table = t; audState.column = null; audState.columns = null; audState.log = null; audState.selC.clear();
  renderAudit();
  const e = encodeURIComponent(shared.env);
  const [cols, log] = await Promise.allSettled([api(`/api/audit/columns?env=${e}&table=${t}`), api(`/api/audit/log?env=${e}&table=${t}&since=${audState.since}`)]);
  audState.columns = cols.status === "fulfilled" ? cols.value.columns : [];
  audState.log = log.status === "fulfilled" ? log.value.entries : { error: log.reason.message };
  renderAudit();
}
async function loadAuditLog() {
  audState.log = null; renderAudit();
  const col = audState.column ? `&column=${audState.column}` : "";
  try { audState.log = (await api(`/api/audit/log?env=${encodeURIComponent(shared.env)}&table=${audState.table}${col}&since=${audState.since}`)).entries; }
  catch (err) { audState.log = { error: err.message }; }
  renderAudit();
}
async function changeAudit(changes) {
  if (needsReason(shared.env, audState)) { renderAudit(); return; }
  audState.notice = { kind: "info", text: `Updating ${changes.length} item(s) and publishing…` };
  renderAudit();
  try {
    const { results } = await api("/api/audit/set", { env: shared.env, changes, reason: audState.reason });
    const failed = results.filter((r) => !r.ok);
    audState.notice = failed.length ? { kind: "bad", text: `${results.length - failed.length} changed, ${failed.length} failed: ${failed.map((f) => `${f.column || f.table} (${f.error})`).join("; ")}` } : { kind: "ok", text: `Auditing updated for ${results.length} item(s) and published.` };
  } catch (err) { audState.notice = { kind: "bad", text: err.message }; }
  audState.selT.clear(); audState.selC.clear();
  const t = audState.table;
  audState.tables = (await api(`/api/audit/tables?env=${encodeURIComponent(shared.env)}`)).tables;
  if (t) await loadAuditTable(t); else renderAudit();
}
async function changeSystem(field, value) {
  if (needsReason(shared.env, audState)) { renderAudit(); return; }
  try {
    audState.system = await api("/api/audit/system", { env: shared.env, [field]: value, reason: audState.reason });
    audState.notice = { kind: "ok", text: "System auditing updated." };
  } catch (err) { audState.notice = { kind: "bad", text: err.message }; }
  renderAudit();
}
function renderAudit() {
  const env = envOf(shared.env);
  const head = header("Governance", "Audit", "Auditing from the whole system down to each table and column, and what changed.", envPicker(env.name, (n) => { shared.env = n; audState.notice = null; audit(new URLSearchParams()); }));
  if (audState.error) return mount(head, notice("bad", audState.error));
  if (!audState.tables) return mount(head, loading(`audit settings from ${env.name}`));
  const sys = audState.system;
  const reason = reasonInput(audState, env.name);
  reason.className = "input";
  const q = audState.q.trim().toLowerCase();
  const tables = audState.tables.filter((t) => (!q || `${t.displayName} ${t.logicalName}`.toLowerCase().includes(q)) && (audState.only === "all" || (audState.only === "on" ? t.auditEnabled : audState.only === "off" ? !t.auditEnabled : t.isCustom)));
  const search = h("input", { type: "search", placeholder: "Search tables", value: audState.q, "aria-label": "Search tables" });
  search.addEventListener("input", () => { audState.q = search.value; const pos = search.selectionStart; renderAudit(); const el = main().querySelector("input[type=search]"); el.focus(); el.setSelectionRange(pos, pos); });
  const tableObj = audState.tables.find((t) => t.logicalName === audState.table);
  const selCount = audState.selT.size + audState.selC.size;
  const bulk = selCount ? h("section", { class: "bulk", "aria-label": "Change selected" },
    h("strong", {}, `${audState.selT.size ? `${audState.selT.size} tables` : ""}${audState.selT.size && audState.selC.size ? " and " : ""}${audState.selC.size ? `${audState.selC.size} columns` : ""} selected`),
    h("div", { class: "row", style: "margin-left:auto" },
      h("button", { type: "button", class: "btn good", onclick: () => changeAudit(bulkChanges(true)) }, "Turn auditing on"),
      h("button", { type: "button", class: "btn ghost", onclick: () => changeAudit(bulkChanges(false)) }, "Turn auditing off"),
      h("button", { type: "button", class: "btn ghost", style: "border:0", onclick: () => { audState.selT.clear(); audState.selC.clear(); renderAudit(); } }, "Clear"))) : null;
  const sysRow = (labelText, on, field, help) => h("div", { class: "row between", style: "padding:6px 0" },
    h("div", {}, h("div", { style: "font-weight:600" }, labelText), h("div", { class: "small muted" }, help)),
    h("div", { class: "row" }, h("span", { class: "small", style: `font-weight:600;color:${on ? "var(--ok)" : "var(--muted)"}` }, on ? "On" : "Off"), switchButton(on, `${on ? "Turn off" : "Turn on"} ${labelText}`, () => changeSystem(field, !on))));
  mount(
    head,
    audState.notice ? notice(audState.notice.kind, audState.notice.text) : null,
    h("div", { class: "cols" },
      h("section", { class: "card", style: "flex:3 1 480px", "aria-label": "System" },
        h("h2", {}, `System · ${env.name}`),
        sys ? h("div", { class: "stack", style: "gap:4px" },
          sysRow("Auditing", sys.auditEnabled, "auditEnabled", "Master switch: nothing is audited while this is off."),
          sysRow("User sign-in logging", sys.userAccessAudit, "userAccessAudit", "Records when users access the environment."),
          h("div", { class: "small muted" }, `Audit logs kept: ${sys.retentionDays === undefined ? "unknown" : sys.retentionDays < 0 ? "forever" : `${sys.retentionDays} days`}`)) : loading("system settings")),
      env.managed ? h("section", { class: "card stack", style: "flex:2 1 300px", "aria-label": "Reason" },
        h("h2", {}, "Reason for changes"),
        h("p", { class: "small muted", style: "margin:0" }, `${env.name} is managed, so every audit change needs a reason. It is logged with your name.`), reason) : null),
    bulk,
    h("nav", { "aria-label": "Breadcrumb", class: "row small" },
      h("button", { type: "button", class: "btn link", onclick: () => { audState.table = null; audState.column = null; renderAudit(); } }, `${env.name} system`),
      tableObj ? [h("span", { "aria-hidden": "true" }, "/"), h("button", { type: "button", class: "btn link", onclick: () => { audState.column = null; loadAuditLog(); } }, tableObj.displayName)] : null,
      audState.column ? [h("span", { "aria-hidden": "true" }, "/"), h("span", { class: "mono" }, audState.column)] : null),
    h("div", { class: "cols" },
      h("section", { class: "card flush", style: "flex:1 1 300px", "aria-label": "Tables" },
        h("div", { class: "stack", style: "padding:14px 16px 8px" },
          h("div", { class: "row between" }, h("h2", {}, "Tables"), h("span", { class: "small muted" }, `${audState.tables.filter((t) => t.auditEnabled).length} of ${audState.tables.length} audited`)),
          h("label", { class: "search", style: "max-width:none" }, search),
          seg([["all", "All"], ["on", "Audited"], ["off", "Not audited"], ["custom", "Custom"]], audState.only, (v) => { audState.only = v; renderAudit(); }, "Filter tables")),
        h("ul", { class: "list", style: "max-height:520px;overflow:auto" }, tables.slice(0, 400).map((t) => {
          const box = h("input", { type: "checkbox", "aria-label": `Select ${t.displayName}`, disabled: !t.canChange });
          box.checked = audState.selT.has(t.logicalName);
          box.addEventListener("change", () => { box.checked ? audState.selT.add(t.logicalName) : audState.selT.delete(t.logicalName); renderAudit(); });
          return h("li", { style: "display:flex;align-items:center;padding-left:16px" }, box,
            h("button", { type: "button", class: "item", "aria-current": audState.table === t.logicalName ? "true" : "false", onclick: () => loadAuditTable(t.logicalName) },
              h("span", { style: "flex:1;min-width:0" }, h("span", { style: "display:block;font-weight:500" }, t.displayName), h("span", { class: "mono muted" }, t.logicalName)),
              h("span", { class: `pill ${t.auditEnabled ? "ok" : ""}` }, t.auditEnabled ? "On" : "Off")));
        }))),
      h("section", { class: "card flush", style: "flex:1 1 300px", "aria-label": "Columns" },
        h("div", { class: "row between", style: "padding:14px 16px 8px" }, h("h2", {}, tableObj ? `Columns in ${tableObj.displayName}` : "Columns"),
          audState.columns ? h("span", { class: "small muted" }, `${audState.columns.filter((c) => c.auditEnabled).length} of ${audState.columns.length} audited`) : null),
        !audState.table ? h("div", { class: "empty" }, "Pick a table to see its columns.") :
        !audState.columns ? h("div", { class: "empty" }, "Loading…") :
        h("ul", { class: "list", style: "max-height:600px;overflow:auto" }, audState.columns.map((c) => {
          const box = h("input", { type: "checkbox", "aria-label": `Select ${c.displayName}`, disabled: !c.canChange });
          box.checked = audState.selC.has(c.logicalName);
          box.addEventListener("change", () => { box.checked ? audState.selC.add(c.logicalName) : audState.selC.delete(c.logicalName); renderAudit(); });
          return h("li", { style: "display:flex;align-items:center;padding-left:16px" }, box,
            h("button", { type: "button", class: "item", "aria-current": audState.column === c.logicalName ? "true" : "false", onclick: () => { audState.column = audState.column === c.logicalName ? null : c.logicalName; loadAuditLog(); } },
              h("span", { style: "flex:1;min-width:0" }, h("span", { style: "display:block;font-weight:500" }, c.displayName), h("span", { class: "mono muted" }, `${c.logicalName} · ${c.type}`)),
              h("span", { class: `pill ${c.auditEnabled ? "ok" : ""}` }, c.auditEnabled ? "On" : "Off")));
        }))),
      h("section", { class: "card stack", style: "flex:2 1 400px", "aria-label": "Audit log" },
        h("div", { class: "row between" }, h("h2", {}, `Changes${audState.table ? ` · ${audState.column ? `${audState.table}.${audState.column}` : audState.table}` : ""}`),
          audState.table ? seg([["24h", "24h"], ["7d", "7 days"], ["30d", "30 days"]], audState.since, (v) => { audState.since = v; loadAuditLog(); }, "Time range") : null),
        !audState.table ? h("p", { class: "muted" }, "Pick a table (and optionally a column) to see who changed what.") :
        !audState.log ? loading("audit history") :
        audState.log.error ? notice("bad", audState.log.error) :
        audState.log.length === 0 ? h("p", { class: "muted" }, "No audited changes in this period. Auditing may be off for it.") :
        h("ol", { class: "list" }, audState.log.slice(0, 200).map((e) => h("li", { style: "display:grid;grid-template-columns:110px minmax(0,1fr);gap:12px;padding:10px 0" },
          h("div", { class: "small muted" }, fmtDate(e.at)),
          h("div", { class: "stack", style: "gap:4px" },
            h("div", { class: "row small" }, h("span", { class: "pill info" }, e.action || e.operation), h("strong", {}, e.record), h("span", { class: "muted" }, `by ${e.user}`)),
            e.changes.slice(0, 8).map((c) => h("div", { class: "row mono" }, h("span", { class: "muted" }, c.column), h("span", { class: "pill bad", style: "text-decoration:line-through" }, c.old || "∅"), h("span", { "aria-hidden": "true" }, "→"), h("span", { class: "pill ok" }, c.new || "∅"))))))))
  ));
}
function bulkChanges(on) {
  const ch = [...audState.selT].map((t) => ({ table: t, on }));
  if (audState.table) ch.push(...[...audState.selC].map((c) => ({ table: audState.table, column: c, on })));
  return ch;
}

// ------------------------------------------------------------------ user settings

const usState = { options: null, target: { region: "en-GB", dateformatstring: "", timeformatstring: "", timezonecode: "", uilanguageid: "", paginglimit: "" }, scope: "all", scopeName: "", overwrite: false, newUsers: false, preview: null, result: null, reason: "", notice: null, busy: false };
async function usersettings(params) {
  pickEnv(params);
  usState.preview = null; usState.result = null;
  renderUserSettings();
  if (!usState.options) { try { usState.options = await api("/api/usersettings/options"); } catch (err) { usState.notice = { kind: "bad", text: err.message }; } }
  renderUserSettings();
}
function usTarget() {
  const t = usState.target;
  const out = {};
  if (t.region && usState.options) Object.assign(out, usState.options.regions[t.region]);
  delete out.label;
  if (t.dateformatstring) out.dateformatstring = t.dateformatstring;
  if (t.timeformatstring) out.timeformatstring = t.timeformatstring;
  if (t.timezonecode) out.timezonecode = Number(t.timezonecode);
  if (t.uilanguageid) { out.uilanguageid = Number(t.uilanguageid); out.helplanguageid = Number(t.uilanguageid); }
  if (t.paginglimit) out.paginglimit = Number(t.paginglimit);
  return out;
}
function usScope() { return usState.scope === "all" ? { kind: "all" } : { kind: usState.scope, name: usState.scopeName }; }
async function usPreview() {
  usState.busy = true; usState.result = null; renderUserSettings();
  try { usState.preview = await api("/api/usersettings/preview", { env: shared.env, target: usTarget(), scope: usScope(), overwrite: usState.overwrite }); usState.notice = null; }
  catch (err) { usState.notice = { kind: "bad", text: err.message }; }
  usState.busy = false; renderUserSettings();
}
async function usApply() {
  if (needsReason(shared.env, usState)) { renderUserSettings(); return; }
  usState.busy = true; renderUserSettings();
  try {
    usState.result = await api("/api/usersettings/apply", { env: shared.env, target: usTarget(), scope: usScope(), overwrite: usState.overwrite, setOrgDefaults: usState.newUsers, reason: usState.reason });
    usState.notice = usState.result.failed.length ? { kind: "bad", text: `${usState.result.changed} updated, ${usState.result.failed.length} failed: ${usState.result.failed.slice(0, 5).map((f) => `${f.name} (${f.error})`).join("; ")}` } : { kind: "ok", text: `${usState.result.changed} users updated${usState.result.orgDefaultsUpdated ? ", and set as the default for new users" : ""}. They see it next time they open an app.` };
    usState.preview = null;
  } catch (err) { usState.notice = { kind: "bad", text: err.message }; }
  usState.busy = false; renderUserSettings();
}
/** Formats the sample date/time and numbers the way Dataverse will. */
function sampleFormat(t) {
  const d = { yyyy: "2026", MM: "10", M: "10", dd: "30", d: "30" };
  const date = (t.dateformatstring || "dd/MM/yyyy").replace(/yyyy|MM|M|dd|d/g, (m) => d[m]);
  const tf = t.timeformatstring || "HH:mm";
  const time = tf.replace(/HH|H|hh|h|mm|tt/g, (m) => ({ HH: "14", H: "14", hh: "02", h: "2", mm: "05", tt: "PM" })[m]);
  const dec = t.decimalsymbol ?? ".", grp = t.numberseparator ?? ",";
  const num = `1${grp}234${grp}567${dec}89`;
  const sym = { 2057: "£", 1033: "$", 6153: "€", 1031: "€", 1036: "€" }[t.localeid] || "¤";
  const cur = (n) => [`${sym}${n}`, `${n}${sym}`, `${sym} ${n}`, `${n} ${sym}`][t.currencyformatcode ?? 0];
  const negN = `50${dec}00`;
  const neg = [`(${negN})`, `-${negN}`, `- ${negN}`, `${negN}-`, `${negN} -`][t.negativeformatcode ?? 1];
  return { date, time, num, money: cur(num), neg };
}
function renderUserSettings() {
  const env = envOf(shared.env);
  const o = usState.options;
  const t = usState.target;
  const head = header("People", "Global user settings", "Set one standard for regional formats, time zone, language and page size, and apply it to users in bulk.",
    envPicker(env.name, (n) => { shared.env = n; usState.preview = null; usState.result = null; usState.notice = null; renderUserSettings(); }));
  if (!o) return mount(head, usState.notice ? notice(usState.notice.kind, usState.notice.text) : loading("options"));
  const sel = (labelText, key, options) => {
    const el = h("select", { class: "input" }, options.map(([v, text]) => h("option", { value: v, selected: String(t[key]) === String(v) }, text)));
    el.addEventListener("change", () => { t[key] = el.value; usState.preview = null; renderUserSettings(); });
    return h("label", { class: "field" }, h("span", {}, labelText), el);
  };
  const keep = ["", "Don't change"];
  const target = usTarget();
  const pv = sampleFormat(target);
  const scopeSel = h("select", { class: "input" }, [["all", "All enabled users"], ["role", "Users with a security role"], ["team", "Members of a team"], ["businessunit", "Users in a business unit"]].map(([v, text]) => h("option", { value: v, selected: usState.scope === v }, text)));
  scopeSel.addEventListener("change", () => { usState.scope = scopeSel.value; usState.preview = null; renderUserSettings(); });
  const scopeName = h("input", { class: "input", type: "text", value: usState.scopeName, placeholder: usState.scope === "role" ? "e.g. Salesperson" : usState.scope === "team" ? "e.g. Service Desk" : "e.g. UK" });
  scopeName.addEventListener("change", () => { usState.scopeName = scopeName.value; usState.preview = null; });
  const reason = reasonInput(usState, env.name);
  reason.className = "input";
  const p = usState.preview;
  mount(
    head,
    usState.notice ? notice(usState.notice.kind, usState.notice.text) : null,
    h("div", { class: "cols" },
      h("div", { class: "stack", style: "flex:3 1 520px" },
        h("section", { class: "card stack", "aria-label": "Formats" },
          h("h2", {}, "Formats"),
          h("div", { style: "display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px" },
            sel("Region (numbers and currency)", "region", [keep, ...Object.entries(o.regions).map(([k, r]) => [k, r.label])]),
            sel("Date format", "dateformatstring", [["", "Region default"], ["dd/MM/yyyy", "dd/MM/yyyy"], ["MM/dd/yyyy", "MM/dd/yyyy"], ["M/d/yyyy", "M/d/yyyy"], ["yyyy-MM-dd", "yyyy-MM-dd"], ["dd.MM.yyyy", "dd.MM.yyyy"]]),
            sel("Time format", "timeformatstring", [["", "Region default"], ["HH:mm", "24-hour (HH:mm)"], ["h:mm tt", "12-hour (h:mm AM)"]]),
            sel("Time zone", "timezonecode", [keep, ...Object.entries(o.timeZones)]),
            sel("Interface language", "uilanguageid", [keep, ...Object.entries(o.languages)]),
            sel("Records per page", "paginglimit", [keep, ["25", "25"], ["50", "50"], ["75", "75"], ["100", "100"], ["250", "250"]]))),
        h("section", { class: "card stack", "aria-label": "Who" },
          h("h2", {}, "Who gets these settings"),
          h("div", { style: "display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px" },
            h("label", { class: "field" }, h("span", {}, "Users"), scopeSel),
            usState.scope !== "all" ? h("label", { class: "field" }, h("span", {}, "Name"), scopeName) : null),
          checkbox("Also overwrite settings users changed themselves", usState.overwrite, (v) => { usState.overwrite = v; usState.preview = null; renderUserSettings(); }),
          checkbox("Make these the defaults for new users (organisation format settings)", usState.newUsers, (v) => { usState.newUsers = v; renderUserSettings(); }),
          h("p", { class: "small muted", style: "margin:0" }, "Without the first box, only users still on the organisation's defaults are changed. Interface language must be installed in the environment."))),
      h("div", { class: "stack", style: "flex:2 1 340px" },
        h("section", { class: "card stack", "aria-label": "Preview" },
          h("h2", {}, "Preview"),
          h("dl", { style: "margin:0;display:grid;grid-template-columns:120px minmax(0,1fr);gap:8px 12px;font-size:13px" },
            h("dt", { class: "muted" }, "Date and time"), h("dd", { class: "mono", style: "margin:0" }, `${pv.date} ${pv.time}`),
            h("dt", { class: "muted" }, "Number"), h("dd", { class: "mono", style: "margin:0" }, pv.num),
            h("dt", { class: "muted" }, "Currency"), h("dd", { class: "mono", style: "margin:0" }, pv.money),
            h("dt", { class: "muted" }, "Negative"), h("dd", { class: "mono", style: "margin:0" }, pv.neg),
            h("dt", { class: "muted" }, "Records per page"), h("dd", { class: "mono", style: "margin:0" }, target.paginglimit ?? "unchanged"))),
        h("section", { class: "card stack", "aria-label": "Apply" },
          h("h2", {}, `Apply in ${env.name}`),
          h("button", { type: "button", class: "btn", disabled: usState.busy, onclick: usPreview }, usState.busy && !p ? "Checking…" : "Preview affected users"),
          p ? h("div", { class: "stack", style: "gap:6px" },
            h("div", {}, h("strong", { style: "font:600 22px var(--head)" }, fmtNum(p.toChange)), ` of ${fmtNum(p.inScope)} users will change`),
            h("div", { class: "small muted" }, `${fmtNum(p.alreadyMatching)} already match · ${fmtNum(p.skippedPersonalised)} kept because they changed their own settings`),
            p.sample.length ? h("details", {}, h("summary", { class: "small" }, "Show who"), h("ul", { class: "small", style: "max-height:200px;overflow:auto;margin:6px 0 0;padding-left:18px" }, p.sample.map((u) => h("li", {}, `${u.name} `, h("span", { class: "muted" }, u.login))))) : null) : null,
          env.managed ? h("label", { class: "field" }, h("span", {}, `Reason (required in ${env.name})`), reason) : null,
          h("button", { type: "button", class: "btn primary", disabled: usState.busy || !p || (p.toChange === 0 && !usState.newUsers), onclick: usApply }, usState.busy && p ? "Applying…" : "Apply settings"),
          h("p", { class: "small muted", style: "margin:0" }, "Preview first. Changing other users' settings needs the System Administrator role.")))));
}

// ------------------------------------------------------------------ activity

async function activity() {
  const sub = config.mode === "hosted" ? "Changes made through this site, newest first." : "Changes made through pcx on this machine (dashboard and CLI).";
  mount(header("Governance", "Activity", sub), loading("activity"));
  let data;
  try { data = await api("/api/actions"); } catch (err) { return mount(header("Governance", "Activity"), notice("bad", err.message)); }
  mount(header("Governance", "Activity", sub),
    h("section", { class: "card flush" }, data.actions.length === 0 ? h("div", { class: "empty" }, "No changes yet.") :
      h("div", { class: "scroll" }, h("table", {},
        h("thead", {}, h("tr", {}, ["When", "Env", "Change", "Item", "Reason", "By", "Result"].map((t) => h("th", { scope: "col" }, t)))),
        h("tbody", {}, data.actions.map((a) => h("tr", {},
          h("td", { class: "small", style: "white-space:nowrap" }, fmtDate(a.at)),
          h("td", {}, chip(a.env)),
          h("td", {}, a.action === "turn-on" ? `Turned on ${a.kind}` : a.action === "turn-off" ? `Turned off ${a.kind}` : a.action),
          h("th", { scope: "row" }, a.name),
          h("td", {}, a.reason || h("span", { class: "muted" }, "—")),
          h("td", { class: "small" }, `${a.actor || "?"} · ${a.source}`),
          h("td", {}, a.ok ? h("span", { class: "pill ok" }, "OK") : h("span", { class: "pill bad", title: a.error || "" }, "Failed")))))))));
}

// ------------------------------------------------------------------ router

const ROUTES = { overview, solutions, compare, components, runs, audit, usersettings, activity };
async function route() {
  hideTip();
  if (!config) {
    try { config = await api("/api/config"); }
    catch (err) {
      if (err instanceof NeedsLogin) return key() ? mount(header(null, "Env Console"), notice("bad", err.message)) : needKeyScreen();
      return mount(header(null, "Env Console"), notice("bad", err.message));
    }
    if (config.mode === "hosted") document.getElementById("who").replaceChildren(h("div", {}, config.name || config.user), h("div", {}, config.user), h("a", { href: "/auth/logout" }, "Sign out"));
  }
  const [path, query] = (location.hash.replace(/^#\/?/, "") || "overview").split("?");
  const name = ROUTES[path] ? path : "overview";
  document.querySelectorAll(".side a").forEach((a) => {
    a.classList.toggle("active", a.dataset.route === name);
    a.dataset.route === name ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current");
  });
  if (config.environments.length === 0) return noEnvScreen();
  await ROUTES[name](new URLSearchParams(query || ""));
}
window.addEventListener("hashchange", route);
route();
