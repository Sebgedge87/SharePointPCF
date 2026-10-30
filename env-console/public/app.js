// Env Console dashboard. Talks only to the local pcx server; all text is set with textContent.

const KNOWN_COLORS = { DEV: "#127A5C", TEST: "#2F5BD3", UAT: "#9A5800", PREPROD: "#7B3FB0", PROD: "#B42318" };
const PALETTE = ["#127A5C", "#2F5BD3", "#9A5800", "#7B3FB0", "#B42318", "#0F6A8A", "#5B6370"];
const KIND_LABEL = { flow: "Cloud flows", rule: "Business rules", plugin: "Plugin steps" };

// ------------------------------------------------------------------ key + api

(function takeKey() {
  const m = location.hash.match(/key=([A-Za-z0-9_-]+)/);
  if (m) {
    try { sessionStorage.setItem("pcxKey", m[1]); } catch { window.__pcxKey = m[1]; }
    history.replaceState(null, "", location.pathname + "#/overview");
  }
})();

function key() {
  try { return sessionStorage.getItem("pcxKey") || window.__pcxKey || ""; } catch { return window.__pcxKey || ""; }
}

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
    // Hosted mode: go to Microsoft sign-in and come back to this page.
    location.href = `${data.login}?returnTo=${encodeURIComponent("/" + location.hash)}`;
    throw new NeedsLogin("Signing in…");
  }
  if (res.status === 401) throw new NeedsLogin(data.error || "Not signed in");
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ------------------------------------------------------------------ dom helper

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "style") el.style.cssText = v; // CSSOM, allowed by the page's CSP (style attributes are not)
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

let config = null;
function envColor(name) {
  if (KNOWN_COLORS[name.toUpperCase()]) return KNOWN_COLORS[name.toUpperCase()];
  const i = config ? config.environments.findIndex((e) => e.name === name) : 0;
  return PALETTE[Math.max(0, i) % PALETTE.length];
}
const chip = (name) => h("span", { class: "chip", style: `background:${envColor(name)}` }, name);

const main = () => document.getElementById("main");
function mount(...nodes) {
  main().replaceChildren(...nodes);
}

function header(title, sub, ...actions) {
  return h("header", { class: "head" }, h("div", {}, h("h1", {}, title), sub ? h("p", { class: "sub" }, sub) : null), actions.length ? h("div", { class: "row" }, ...actions) : null);
}

function needKeyScreen() {
  mount(header("Env Console"), h("div", { class: "notice warn" }, "Open the dashboard with the link printed by ", h("code", {}, "pcx serve"), ". It carries the key this page needs."));
}

function noEnvScreen() {
  mount(
    header("Environments"),
    h("div", { class: "card" },
      h("h2", {}, "No environments yet"),
      h("p", { class: "muted" }, "Add them from a terminal, then reload this page:"),
      h("p", {}, h("code", {}, "pcx env add DEV https://<org>-dev.crm.dynamics.com --unmanaged")),
      h("p", {}, h("code", {}, "pcx env add PROD https://<org>.crm.dynamics.com")),
      h("p", { class: "muted" }, "Then sign in: ", h("code", {}, "pcx auth login")))
  );
}

// ------------------------------------------------------------------ overview

async function overview() {
  const cards = new Map();
  const grid = h("section", { class: "grid", "aria-label": "Environments" });
  for (const e of config.environments) {
    const card = h("article", { class: "card env" }, h("div", { class: "row between" }, chip(e.name), h("span", { class: e.managed ? "pill" : "pill ok" }, e.managed ? "Managed" : "Unmanaged")), h("div", { class: "mono muted" }, e.url), h("div", { class: "muted small" }, "Checking…"));
    cards.set(e.name, card);
    grid.append(card);
  }
  const via = config.mode === "hosted" ? `signed in as ${config.user}` : `signed in through ${config.provider === "azps" ? "PowerShell (Az.Accounts)" : "Azure CLI"}`;
  mount(header("Environments", `${config.environments.length} environments · ${via}`, h("button", { class: "btn", type: "button", onclick: () => overview() }, "Refresh")), grid);

  let anyLogin = false;
  await Promise.all(
    config.environments.map(async (e) => {
      const card = cards.get(e.name);
      let s;
      try { s = await api(`/api/status?env=${encodeURIComponent(e.name)}`); } catch (err) { s = { connected: false, error: err.message }; }
      if (s.needsLogin) anyLogin = true;
      if (s.connected && s.user && config.mode !== "hosted") document.getElementById("who").textContent = `Signed in as ${s.user}`;
      const body = s.connected
        ? [
            h("div", { class: "row small" }, h("span", { class: "dot ok" }), h("strong", {}, "Connected"), h("span", { class: "muted" }, s.version ? `v${s.version}` : "")),
            h("dl", { class: "stats" },
              h("div", {}, h("dt", {}, "Solutions"), h("dd", {}, s.solutions ?? "—")),
              h("div", {}, h("dt", {}, "Flows on"), h("dd", {}, s.flowsTotal !== undefined ? `${s.flowsOn} / ${s.flowsTotal}` : "—")),
              h("div", {}, h("dt", {}, "Plugin steps on"), h("dd", {}, s.pluginStepsTotal !== undefined ? `${s.pluginStepsOn} / ${s.pluginStepsTotal}` : "—"))),
            s.error ? h("div", { class: "small muted" }, s.error) : null,
            h("a", { href: `#/components?env=${encodeURIComponent(e.name)}`, class: "small" }, "Flows & plugins")
          ]
        : [h("div", { class: "row small" }, h("span", { class: "dot bad" }), h("strong", {}, s.needsLogin ? "Sign-in needed" : "Not reachable")), h("div", { class: "small muted" }, s.error || "")];
      card.replaceChildren(card.children[0], card.children[1], ...body.filter(Boolean));
    })
  );
  if (anyLogin && config.mode !== "hosted") main().insertBefore(h("div", { class: "notice warn" }, "Some environments need you to sign in. In a terminal run ", h("code", {}, "pcx auth login"), ", then press Refresh."), grid);
}

// ------------------------------------------------------------------ solutions

const solState = { q: "", pubs: new Set(), ms: false, diff: false, data: null };

async function solutions() {
  mount(header("Installed solutions", "Every solution in every environment, with its version. Blue versions differ from the last environment."), h("div", { class: "muted" }, "Loading solutions from every environment…"));
  try { solState.data = await api("/api/solutions"); } catch (err) { mount(header("Installed solutions"), h("div", { class: "notice bad" }, err.message)); return; }
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
  search.addEventListener("input", () => { solState.q = search.value; const pos = search.selectionStart; renderSolutions(); const s = main().querySelector("input[type=search]"); s.focus(); s.setSelectionRange(pos, pos); });
  const check = (label, prop) => {
    const box = h("input", { type: "checkbox" });
    box.checked = solState[prop];
    box.addEventListener("change", () => { solState[prop] = box.checked; renderSolutions(); });
    return h("label", { class: "check" }, box, label);
  };
  const pubs = d.publishers.filter((p) => solState.ms || !p.isMicrosoft || solState.pubs.has(pubKey(p.publisher)));
  const errors = Object.entries(d.errors || {});

  mount(
    header("Installed solutions", "Every solution in every environment, with its version. Blue versions differ from " + ref + ".", h("button", { class: "btn", type: "button", onclick: () => solutions() }, "Refresh")),
    ...errors.map(([env, msg]) => h("div", { class: "notice bad" }, `${env}: ${msg}`)),
    h("section", { class: "card", "aria-label": "Filters", style: "display:flex;flex-direction:column;gap:12px" },
      h("div", { class: "row" }, h("label", { class: "search" }, search), check("Show Microsoft solutions", "ms"), check("Only version differences", "diff")),
      h("div", { class: "row", role: "group", "aria-label": "Publisher" },
        h("span", { class: "small", style: "font-weight:600;color:var(--text-2)" }, "Publisher"),
        pubs.map((p) => {
          const k = pubKey(p.publisher);
          return h("button", { type: "button", class: "pub", "aria-pressed": solState.pubs.has(k) ? "true" : "false", onclick: () => { solState.pubs.has(k) ? solState.pubs.delete(k) : solState.pubs.add(k); renderSolutions(); } },
            p.publisher.friendlyName || k, h("span", { class: "mono", style: "opacity:.8" }, p.publisher.prefix), h("span", { class: "n" }, p.count));
        }),
        solState.pubs.size ? h("button", { type: "button", class: "btn", style: "border:0;background:transparent;color:var(--accent)", onclick: () => { solState.pubs.clear(); renderSolutions(); } }, "Clear") : null)),
    h("section", { class: "card flush", "aria-label": "Solutions" },
      h("h2", { style: "padding:16px 20px 8px" }, `${rows.length} solutions `, hiddenMs ? h("span", { class: "muted", style: "font-weight:400" }, `· ${hiddenMs} Microsoft solutions hidden`) : null),
      rows.length === 0 ? h("div", { class: "empty" }, "No solutions match these filters.") :
      h("div", { class: "scroll" }, h("table", {},
        h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Solution"), h("th", { scope: "col" }, "Publisher"), d.environments.map((n) => h("th", { scope: "col", style: `color:${envColor(n)};font-weight:600` }, n)))),
        h("tbody", {}, rows.map((r) => h("tr", {},
          h("th", { scope: "row" }, h("div", { style: "font-weight:600" }, r.friendlyName), h("div", { class: "mono muted" }, r.uniqueName)),
          h("td", {}, h("div", {}, r.publisher.friendlyName), h("div", { class: "mono muted" }, r.publisher.prefix)),
          d.environments.map((n) => {
            const v = r.versions[n];
            if (v === undefined) return h("td", { class: "muted" }, "?");
            if (v === null) return h("td", { class: "muted" }, "—");
            const refV = r.versions[ref];
            return h("td", { style: "white-space:nowrap" }, h("span", { class: refV && refV.version === v.version ? "ver" : "ver diff" }, v.version), h("span", { class: v.isManaged ? "tag" : "tag u" }, v.isManaged ? "M" : "U"));
          })))))),
      h("p", { class: "small muted", style: "margin:0;padding:12px 20px 16px" }, "M = managed, U = unmanaged, — = not installed, ? = environment could not be read."))
  );
}

// ------------------------------------------------------------------ components

const compState = { env: null, kind: "flow", sel: new Set(), reason: "", data: null, notice: null };

async function components(params) {
  if (params.get("env")) compState.env = params.get("env");
  if (!compState.env || !config.environments.some((e) => e.name === compState.env)) compState.env = config.environments[0].name;
  compState.sel.clear();
  compState.data = null;
  renderComponents();
  try {
    compState.data = await api(`/api/components?env=${encodeURIComponent(compState.env)}&kind=${compState.kind}`);
  } catch (err) {
    compState.data = { error: err.message, items: [] };
  }
  renderComponents();
}

async function setState(ids, on) {
  const env = config.environments.find((e) => e.name === compState.env);
  if (env.managed && compState.reason.trim().length < 3) {
    compState.notice = { kind: "warn", text: `${env.name} is managed: enter a reason before changing anything.` };
    renderComponents();
    main().querySelector(".bulk input, #reason")?.focus();
    return;
  }
  try {
    const { results } = await api("/api/components/state", { env: env.name, kind: compState.kind, ids, on, reason: compState.reason });
    const failed = results.filter((r) => !r.ok);
    compState.notice = failed.length
      ? { kind: "bad", text: `${results.length - failed.length} changed, ${failed.length} failed: ${failed.map((f) => `${f.name} (${f.error})`).join("; ")}` }
      : { kind: "ok", text: `${results.length} ${results.length === 1 ? "item" : "items"} turned ${on ? "on" : "off"} in ${env.name}${env.managed ? " · reason logged" : ""}.` };
  } catch (err) {
    compState.notice = { kind: "bad", text: err.message };
  }
  await components(new URLSearchParams());
}

function renderComponents() {
  const env = config.environments.find((e) => e.name === compState.env);
  const d = compState.data;
  const items = d ? d.items : [];
  const envPick = h("div", { class: "row envpick", role: "group", "aria-label": "Environment" },
    config.environments.map((e) => h("button", { type: "button", "aria-pressed": e.name === env.name ? "true" : "false", style: e.name === env.name ? `background:${envColor(e.name)};border-color:${envColor(e.name)};color:#fff` : "", onclick: () => { compState.env = e.name; compState.notice = null; components(new URLSearchParams()); } }, e.name)));
  const tabs = h("div", { class: "seg", role: "tablist", "aria-label": "Type" },
    Object.entries(KIND_LABEL).map(([k, label]) => h("button", { type: "button", role: "tab", "aria-selected": compState.kind === k ? "true" : "false", onclick: () => { compState.kind = k; compState.notice = null; components(new URLSearchParams()); } }, label)));

  const reason = h("input", { type: "text", id: "reason", placeholder: "e.g. SAP outage, ticket INC-123", value: compState.reason });
  reason.addEventListener("input", () => { compState.reason = reason.value; });

  const allBox = h("input", { type: "checkbox", "aria-label": "Select all" });
  allBox.checked = items.length > 0 && items.every((i) => compState.sel.has(i.id));
  allBox.addEventListener("change", () => { allBox.checked ? items.forEach((i) => compState.sel.add(i.id)) : compState.sel.clear(); renderComponents(); });

  const bulk = compState.sel.size
    ? h("section", { class: "bulk", "aria-label": "Bulk actions" },
        h("strong", {}, `${compState.sel.size} selected`),
        env.managed ? h("label", {}, `Reason (required in ${env.name})`, reason) : null,
        h("div", { class: "row", style: "margin-left:auto" },
          h("button", { type: "button", class: "btn good", onclick: () => setState([...compState.sel], true) }, "Turn on"),
          h("button", { type: "button", class: "btn ghost", onclick: () => setState([...compState.sel], false) }, "Turn off"),
          h("button", { type: "button", class: "btn ghost", style: "border:0", onclick: () => { compState.sel.clear(); renderComponents(); } }, "Clear")))
    : env.managed
      ? h("label", { class: "card row small", style: "padding:10px 16px" }, h("span", { style: "font-weight:600" }, `Reason for changes in ${env.name}`), h("span", { style: "flex:1;display:flex" }, reason))
      : null;
  if (!compState.sel.size && env.managed) Object.assign(reason.style, { flex: "1", minHeight: "36px", border: "1px solid #D5D9E0", borderRadius: "6px", padding: "0 10px" });

  mount(
    header("Flows, business rules & plugins", "Turn items on or off one at a time, or select several and change them together.", envPick),
    tabs,
    compState.notice ? h("div", { class: `notice ${compState.notice.kind}`, role: "status" }, compState.notice.text) : null,
    bulk,
    h("section", { class: "card flush", "aria-label": KIND_LABEL[compState.kind] },
      !d ? h("div", { class: "empty" }, "Loading…") :
      d.error ? h("div", { class: "notice bad", style: "margin:16px" }, d.error) :
      items.length === 0 ? h("div", { class: "empty" }, `No ${KIND_LABEL[compState.kind].toLowerCase()} in ${env.name}.`) :
      h("div", { class: "scroll" }, h("table", {},
        h("thead", {}, h("tr", {}, h("th", { scope: "col", style: "width:44px" }, allBox), h("th", { scope: "col" }, "Name"), h("th", { scope: "col" }, compState.kind === "plugin" ? "Table · message · stage" : "Table"), h("th", { scope: "col" }, "Modified"), h("th", { scope: "col", style: "text-align:right" }, "State"))),
        h("tbody", {}, items.map((i) => {
          const box = h("input", { type: "checkbox", "aria-label": `Select ${i.name}` });
          box.checked = compState.sel.has(i.id);
          box.addEventListener("change", () => { box.checked ? compState.sel.add(i.id) : compState.sel.delete(i.id); renderComponents(); });
          return h("tr", { class: compState.sel.has(i.id) ? "sel" : "" },
            h("td", {}, box),
            h("th", { scope: "row" }, i.name),
            h("td", { class: "muted" }, i.target),
            h("td", { class: "muted small", style: "white-space:nowrap" }, i.modifiedOn ? new Date(i.modifiedOn).toLocaleString() : ""),
            h("td", { style: "text-align:right;white-space:nowrap" },
              h("span", { class: "small", style: `font-weight:600;color:${i.on ? "var(--ok)" : "var(--muted)"};margin-right:8px` }, i.on ? "On" : "Off"),
              h("button", { type: "button", class: "switch", role: "switch", "aria-checked": i.on ? "true" : "false", "aria-label": `${i.on ? "Turn off" : "Turn on"} ${i.name}`, onclick: () => setState([i.id], !i.on) }, h("span", { class: "track" }, h("span", { class: "knob" })))));
        }))))),
    h("p", { class: "small muted", style: "margin:0" }, "Changes are logged on the Activity page. Managed environments need a reason for every change.")
  );
}

// ------------------------------------------------------------------ activity

async function activity() {
  const sub = config.mode === "hosted" ? "Changes made through this site, newest first." : "Changes made through pcx on this machine (dashboard and CLI).";
  mount(header("Activity", sub), h("div", { class: "muted" }, "Loading…"));
  let data;
  try { data = await api("/api/actions"); } catch (err) { mount(header("Activity"), h("div", { class: "notice bad" }, err.message)); return; }
  mount(
    header("Activity", sub),
    h("section", { class: "card flush" }, data.actions.length === 0 ? h("div", { class: "empty" }, "No changes yet.") :
      h("div", { class: "scroll" }, h("table", {},
        h("thead", {}, h("tr", {}, ["When", "Env", "Change", "Item", "Reason", "By", "Result"].map((t) => h("th", { scope: "col" }, t)))),
        h("tbody", {}, data.actions.map((a) => h("tr", {},
          h("td", { class: "small", style: "white-space:nowrap" }, new Date(a.at).toLocaleString()),
          h("td", {}, chip(a.env)),
          h("td", {}, `${a.action === "turn-on" ? "Turned on" : "Turned off"} ${a.kind}`),
          h("th", { scope: "row" }, a.name),
          h("td", {}, a.reason || h("span", { class: "muted" }, "—")),
          h("td", { class: "small" }, `${a.actor || "?"} · ${a.source}`),
          h("td", {}, a.ok ? h("span", { class: "pill ok" }, "OK") : h("span", { class: "pill bad", title: a.error || "" }, "Failed"))))))))
  );
}

// ------------------------------------------------------------------ router

const ROUTES = { overview, solutions, components, activity };

async function route() {
  if (!config) {
    try {
      config = await api("/api/config");
    } catch (err) {
      if (err instanceof NeedsLogin) return key() ? mount(header("Env Console"), h("div", { class: "notice bad" }, err.message)) : needKeyScreen();
      return mount(header("Env Console"), h("div", { class: "notice bad" }, err.message));
    }
    if (config.mode === "hosted") {
      document.getElementById("who").replaceChildren(h("div", {}, config.name || config.user), h("div", {}, config.user), h("a", { href: "/auth/logout", style: "color:#C9CFD6" }, "Sign out"));
    }
  }
  const [path, query] = (location.hash.replace(/^#\/?/, "") || "overview").split("?");
  const name = ROUTES[path] ? path : "overview";
  document.querySelectorAll(".side a").forEach((a) => a.classList.toggle("active", a.dataset.route === name));
  document.querySelectorAll(".side a").forEach((a) => (a.dataset.route === name ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  if (config.environments.length === 0) return noEnvScreen();
  await ROUTES[name](new URLSearchParams(query || ""));
}

window.addEventListener("hashchange", route);
route();
