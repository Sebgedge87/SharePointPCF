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
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { output: data.output });
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
/** The name people see: the environment's real display name, or its short name. */
function envLabel(name) {
  return (config && config.environments.find((e) => e.name === name)?.label) || name;
}
const STAGE_WORDS = [[/\b(pre[-_ ]?prod(uction)?|staging)\b/i, "PREPROD"], [/\b(uat|acceptance)\b/i, "UAT"], [/\b(test|testing|qa|sit)\b/i, "TEST"], [/\b(dev|development|sandbox)\b/i, "DEV"], [/\b(prod|production|live)\b/i, "PROD"]];
function envColor(name) {
  if (KNOWN_COLORS[name.toUpperCase()]) return KNOWN_COLORS[name.toUpperCase()];
  const label = envLabel(name);
  for (const [re, stage] of STAGE_WORDS) if (re.test(label)) return KNOWN_COLORS[stage];
  const i = config ? config.environments.findIndex((e) => e.name === name) : 0;
  return PALETTE[Math.max(0, i) % PALETTE.length];
}
const chip = (name) => h("span", { class: "chip", style: `background:${envColor(name)}`, title: envLabel(name) !== name ? `${envLabel(name)} (pcx --env ${name})` : null }, envLabel(name));
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
      return h("button", { type: "button", "aria-pressed": on ? "true" : "false", style: on ? `background:${envColor(e.name)};border-color:${envColor(e.name)};color:#FFFFFF` : "", onclick: () => onPick(e.name), title: e.label ? `pcx --env ${e.name}` : null }, envLabel(e.name));
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

// ------------------------------------------------------------------ dialogs (instead of the browser's confirm/alert)

/**
 * Shows a dialog in the console's style. Resolves true when confirmed, false when cancelled
 * (Cancel, ×, Escape or clicking outside).
 */
function confirmDialog({ title, message, confirmText = "OK", cancelText = "Cancel", danger = false, details = null }) {
  return new Promise((resolveDialog) => {
    let result = false;
    const ok = h("button", { type: "button", class: danger ? "btn danger-solid" : "btn primary", onclick: () => { result = true; dlg.close(); } }, confirmText);
    const dlg = h("dialog", { class: "modal", "aria-labelledby": "dlg-title", "aria-describedby": "dlg-msg" },
      h("div", { class: "modal-head" }, h("h2", { id: "dlg-title" }, title), h("button", { type: "button", class: "iconbtn", "aria-label": "Close", onclick: () => dlg.close() }, "×")),
      h("div", { class: "modal-body" },
        h("p", { id: "dlg-msg", style: "margin:0;color:var(--text-2)" }, message),
        details,
        h("div", { class: "row", style: "justify-content:flex-end" },
          cancelText ? h("button", { type: "button", class: "btn", onclick: () => dlg.close() }, cancelText) : null,
          ok)));
    dlg.addEventListener("click", (ev) => { if (ev.target === dlg) dlg.close(); });
    dlg.addEventListener("close", () => { dlg.remove(); resolveDialog(result); });
    document.body.append(dlg);
    dlg.showModal();
    (danger && cancelText ? dlg.querySelector(".modal-body .btn:not(.danger-solid)") : ok).focus();
  });
}
const messageDialog = (title, message) => confirmDialog({ title, message, confirmText: "OK", cancelText: null });

/** A panel that slides in from the right over the page. Returns a handle to update or close it. */
function openFlyout({ title, subtitle, onClose }) {
  const body = h("div", { class: "flyout-body" });
  const tools = h("div", { class: "row" });
  const dlg = h("dialog", { class: "flyout", "aria-labelledby": "flyout-title" },
    h("div", { class: "flyout-head" },
      h("div", { style: "min-width:0" }, subtitle ? h("div", { class: "eyebrow" }, subtitle) : null, h("h2", { id: "flyout-title" }, title)),
      h("button", { type: "button", class: "iconbtn", "aria-label": "Close", onclick: () => dlg.close() }, "×")),
    tools, body);
  dlg.addEventListener("click", (ev) => { if (ev.target === dlg) dlg.close(); });
  dlg.addEventListener("close", () => { dlg.remove(); onClose?.(); });
  document.body.append(dlg);
  dlg.showModal();
  return {
    set: (...nodes) => body.replaceChildren(...nodes.flat().filter(Boolean)),
    tools: (...nodes) => tools.replaceChildren(...nodes.flat().filter(Boolean)),
    isOpen: () => dlg.open,
    close: () => dlg.close()
  };
}

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

// ------------------------------------------------------------------ sign-in and environment list

const acctState = { busy: false, notice: null, user: null, found: null, finding: false, findError: null, picks: new Map() };
async function findEnvironments() {
  acctState.finding = true; acctState.findError = null; acctState.open = true;
  overview();
  try {
    const { environments } = await api("/api/account/discover");
    // Unique suggested names that don't clash with environments already added.
    const used = new Set(config.environments.map((e) => e.name.toUpperCase()));
    acctState.picks = new Map();
    for (const f of environments) {
      if (f.added) continue;
      let n = f.suggestedName, i = 2;
      while (used.has(n.toUpperCase())) n = `${f.suggestedName}-${i++}`.slice(0, 32);
      used.add(n.toUpperCase());
      acctState.picks.set(f.url, { on: false, name: n, label: f.friendlyName, managed: f.suggestedManaged });
    }
    acctState.found = environments;
  } catch (err) { acctState.findError = err.message; }
  acctState.finding = false;
  overview();
}
async function addPicked() {
  const list = acctState.found.filter((f) => acctState.picks.get(f.url)?.on).map((f) => ({ url: f.url, ...acctState.picks.get(f.url) }));
  if (!list.length) return;
  try {
    await api("/api/account/envs", { environments: list.map(({ url, name, label, managed }) => ({ url, name, label, managed })) });
    await reloadConfig();
    acctState.found = null;
    acctState.notice = { kind: "ok", text: `Added ${list.map((e) => e.label || e.name).join(", ")}.` };
  } catch (err) { acctState.findError = err.message; }
  overview();
}
function foundTable() {
  if (acctState.finding) return loading("the environments your account can reach");
  if (acctState.findError) return notice("bad", acctState.findError);
  if (!acctState.found) return null;
  if (!acctState.found.length) return notice("info", "Your account can't reach any Dataverse environments in this tenant. Check the tenant setting below, or sign in with another account.");
  const chosen = [...acctState.picks.values()].filter((p) => p.on).length;
  return h("div", { class: "stack" },
    h("div", { class: "scroll" }, h("table", {},
      h("thead", {}, h("tr", {}, ["", "Environment", "URL", "Region", "Unmanaged (DEV)"].map((t) => h("th", { scope: "col" }, t)))),
      h("tbody", {}, acctState.found.map((f) => {
        const p = acctState.picks.get(f.url);
        if (!p) return h("tr", {}, h("td", {}, h("span", { class: "pill ok" }, "Added")), h("th", { scope: "row" }, f.friendlyName), h("td", { style: "max-width:320px" }, envLink(f.url)), h("td", { class: "small" }, f.region || ""), h("td", {}));
        const pick = h("input", { type: "checkbox", "aria-label": `Add ${f.friendlyName}`, disabled: !f.enabled });
        pick.checked = p.on;
        pick.addEventListener("change", () => { p.on = pick.checked; overview(); });
        const unm = h("input", { type: "checkbox", "aria-label": `${f.friendlyName} is unmanaged` });
        unm.checked = !p.managed;
        unm.addEventListener("change", () => { p.managed = !unm.checked; });
        return h("tr", { class: p.on ? "sel" : "" }, h("td", {}, pick),
          h("th", { scope: "row" }, f.friendlyName, f.enabled ? null : h("span", { class: "pill", style: "margin-left:6px" }, "Disabled")),
          h("td", { style: "max-width:320px" }, envLink(f.url)), h("td", { class: "small" }, f.region || ""), h("td", {}, unm));
      })))),
    h("div", { class: "row" }, h("button", { type: "button", class: "btn primary", disabled: !chosen, onclick: addPicked }, chosen ? `Add ${chosen} selected` : "Tick the environments to add"),
      h("button", { type: "button", class: "btn", onclick: () => { acctState.found = null; overview(); } }, "Close")));
}
/** Sign-in dialog: shows a code to enter at microsoft.com/devicelogin, and waits for it to finish. */
let signInDialog = null;
function signIn() {
  if (signInDialog?.open) return;
  const body = h("div", { class: "modal-body" });
  const dlg = h("dialog", { class: "modal", "aria-labelledby": "signin-title" },
    h("div", { class: "modal-head" }, h("h2", { id: "signin-title" }, "Sign in"), h("button", { type: "button", class: "iconbtn", "aria-label": "Close", onclick: () => dlg.close() }, "×")),
    body);
  document.body.append(dlg);
  signInDialog = dlg;
  let finished = false;
  let mode = "code";
  let poll = null;
  const stop = () => { if (poll) clearInterval(poll); poll = null; };
  const show = (...nodes) => body.replaceChildren(...nodes.flat().filter(Boolean));
  const tenantLine = () => h("p", { class: "small muted", style: "margin:0" }, config.tenantId ? `Tenant: ${config.tenantId}. Change it under Manage environments.` : "Uses your default tenant. Set a tenant under Manage environments if your environments are in another one.");
  const success = async () => {
    finished = true;
    stop();
    show(h("div", { class: "row" }, h("span", { class: "dot ok" }), h("strong", {}, "Signed in")), h("p", { class: "muted", style: "margin:0" }, "Loading your environments…"));
    acctState.user = null;
    setTimeout(() => { dlg.close(); acctState.notice = { kind: "ok", text: "Signed in." }; overview(); refreshAlertBadge(); }, 900);
  };
  const failed = (msg, output) => {
    stop();
    show(notice("bad", msg),
      output ? h("details", {}, h("summary", { class: "small" }, "What the sign-in tool printed"), h("div", { class: "code wrap", style: "margin-top:8px;max-height:200px" }, output.split("\n").map((l) => h("div", {}, l)))) : null,
      h("div", { class: "row" },
      h("button", { type: "button", class: "btn primary", onclick: startCode }, "Try again"),
      h("button", { type: "button", class: "btn", onclick: startBrowser }, "Use a browser window instead")));
  };
  async function startCode() {
    mode = "code";
    show(h("div", { class: "row" }, h("span", { class: "spinner", "aria-hidden": "true" }), "Getting a sign-in code… (up to 30 seconds)"), tenantLine(),
      h("button", { type: "button", class: "btn link", style: "align-self:flex-start;padding:0", onclick: () => { api("/api/account/device/cancel", {}).catch(() => {}); startBrowser(); } }, "Use a browser window instead"));
    let start;
    try { start = await api("/api/account/device/start", {}); } catch (err) { if (!dlg.open || mode !== "code") return; return failed(err.message, err.output); }
    if (!dlg.open || mode !== "code") return;
    const copyBtn = h("button", { type: "button", class: "btn sm", onclick: async () => {
      try { await navigator.clipboard.writeText(start.code); copyBtn.textContent = "Copied"; } catch { copyBtn.textContent = "Select and copy"; }
    } }, "Copy");
    show(
      h("ol", { class: "steps" },
        h("li", {}, "Copy this code"),
        h("li", {}, "Open the Microsoft sign-in page and paste it"),
        h("li", {}, "Pick your work account. This window closes by itself.")),
      h("div", { class: "devcode" }, h("span", { class: "devcode-text", "aria-label": "Sign-in code" }, start.code), copyBtn),
      h("a", { class: "btn primary", href: start.url, target: "_blank", rel: "noopener noreferrer", style: "justify-content:center" }, "Open Microsoft sign-in"),
      h("div", { class: "row small muted", role: "status" }, h("span", { class: "spinner", "aria-hidden": "true" }), "Waiting for you to finish signing in…"),
      tenantLine(),
      h("button", { type: "button", class: "btn link", style: "align-self:flex-start;padding:0", onclick: () => { api("/api/account/device/cancel", {}).catch(() => {}); stop(); startBrowser(); } }, "Code not accepted by your organisation? Use a browser window instead"));
    poll = setInterval(async () => {
      try {
        const st = await api("/api/account/device/status");
        if (st.state === "done") success();
        else if (st.state === "failed") failed(`Sign-in didn't finish: ${st.error || "unknown error"}`);
      } catch { /* keep waiting */ }
    }, 2000);
  }
  async function startBrowser() {
    mode = "browser";
    stop();
    show(h("div", { class: "row" }, h("span", { class: "spinner", "aria-hidden": "true" }), "A Microsoft sign-in tab has opened in your browser. Pick your work account there."), tenantLine());
    try { await api("/api/account/login", {}); success(); } catch (err) { failed(`Sign-in didn't finish: ${err.message}`); }
  }
  dlg.addEventListener("close", () => {
    stop();
    if (!finished) api("/api/account/device/cancel", {}).catch(() => {});
    dlg.remove();
    signInDialog = null;
  });
  dlg.showModal();
  startCode();
}
async function signOut() {
  if (!(await confirmDialog({ title: "Sign out?", message: "The console can't read any environment until you sign in again.", confirmText: "Sign out" }))) return;
  try { await api("/api/account/logout", {}); acctState.notice = { kind: "info", text: "Signed out." }; acctState.user = null; document.getElementById("who").textContent = "Not signed in"; }
  catch (err) { acctState.notice = { kind: "bad", text: err.message }; }
  overview();
}
async function reloadConfig() {
  config = await api("/api/config");
  solState.data = null;
}
function accountBar() {
  if (config.mode === "hosted") {
    return h("section", { class: "card row between", "aria-label": "Account" },
      h("div", {}, h("strong", {}, `Signed in as ${config.user}`), h("div", { class: "small muted" }, "Each environment is read as you, with your own security roles.")),
      h("div", { class: "row" }, h("a", { class: "btn", href: "/auth/login?returnTo=%2F%23%2Foverview" }, "Sign in again"), h("a", { class: "btn", href: "/auth/logout" }, "Sign out")));
  }
  const via = config.provider === "azps" ? "PowerShell (Connect-AzAccount)" : "Azure CLI (az login)";
  return h("section", { class: "card row between", "aria-label": "Account" },
    h("div", {}, h("strong", {}, acctState.user ? `Signed in as ${acctState.user}` : "Sign-in"),
      h("div", { class: "small muted" }, `Uses your ${via} sign-in${config.tenantId ? ` · tenant ${config.tenantId}` : ""}.`)),
    config.canManage ? h("div", { class: "row" },
      h("button", { type: "button", class: "btn primary", onclick: signIn }, acctState.user ? "Sign in again" : "Sign in"),
      acctState.user ? h("button", { type: "button", class: "btn", disabled: acctState.busy, onclick: signOut }, "Sign out") : null) : null);
}
function manageEnvironments() {
  if (!config.canManage) return null;
  const url = h("input", { class: "input", placeholder: "https://contoso-uat.crm4.dynamics.com", style: "min-width:320px", "aria-label": "Environment URL", required: true });
  const kind = h("select", { class: "input", "aria-label": "Type" }, h("option", { value: "" }, "Detect from its name"), h("option", { value: "managed" }, "Managed"), h("option", { value: "unmanaged" }, "Unmanaged (DEV)"));
  const addBtn = h("button", { type: "submit", class: "btn primary" }, "Add environment");
  const tenant = h("input", { class: "input", placeholder: "Leave empty for your default tenant", value: config.tenantId || "", style: "min-width:320px", "aria-label": "Tenant" });
  const status = h("div", { role: "status", class: "small" });
  const fail = (err) => { status.textContent = err.message; status.style.color = "var(--bad-text)"; };
  const add = async (ev) => {
    ev.preventDefault();
    addBtn.disabled = true;
    addBtn.textContent = "Looking it up…";
    status.textContent = "";
    try {
      const body = { url: url.value.trim() };
      if (kind.value) body.managed = kind.value === "managed";
      const { environments } = await api("/api/account/env", body);
      const added = environments[environments.length - 1];
      await reloadConfig();
      acctState.notice = { kind: "ok", text: `Added ${added.label || added.name} (${added.managed ? "managed" : "unmanaged"}, pcx --env ${added.name}).` };
      overview();
    } catch (err) { fail(err); addBtn.disabled = false; addBtn.textContent = "Add environment"; }
  };
  const remove = async (n) => {
    if (!(await confirmDialog({ title: `Remove ${n}?`, message: `${n} is removed from the console only. Nothing changes in the environment itself, and you can add it back at any time.`, confirmText: "Remove", danger: true }))) return;
    try { await api("/api/account/env/remove", { name: n }); await reloadConfig(); overview(); } catch (err) { fail(err); }
  };
  const saveTenant = async () => {
    try { await api("/api/account/tenant", { tenant: tenant.value.trim() }); await reloadConfig(); status.textContent = "Tenant saved. Sign in again if your environments live in that tenant."; status.style.color = ""; }
    catch (err) { fail(err); }
  };
  const details = h("details", { class: "card", open: config.environments.length === 0 || acctState.open ? true : null },
    h("summary", { style: "cursor:pointer;font:600 15px var(--head)" }, `Manage environments (${config.environments.length})`),
    h("div", { class: "stack", style: "margin-top:14px" },
      h("div", { class: "row between" },
        h("div", { class: "small muted" }, "Pick from the environments your account can reach, or paste a URL below."),
        h("button", { type: "button", class: "btn primary", disabled: acctState.finding, onclick: findEnvironments }, acctState.finding ? "Looking…" : "Find my environments")),
      foundTable(),
      config.environments.length ? h("div", { class: "scroll" }, h("table", {},
        h("thead", {}, h("tr", {}, ["Display name", "Short name (for pcx --env)", "URL", "Type", ""].map((t) => h("th", { scope: "col" }, t)))),
        h("tbody", {}, config.environments.map((e) => {
          const label = h("input", { class: "input", value: e.label || "", placeholder: e.name, maxlength: 100, "aria-label": `Display name for ${e.name}`, style: "min-width:200px" });
          label.addEventListener("change", async () => {
            try { await api("/api/account/env/label", { name: e.name, label: label.value }); await reloadConfig(); overview(); } catch (err) { fail(err); }
          });
          return h("tr", {}, h("td", {}, label), h("td", {}, h("span", { class: "chip", style: `background:${envColor(e.name)}` }, e.name)), h("td", { style: "max-width:320px" }, envLink(e.url)), h("td", { class: "small" }, e.managed ? "Managed (changes need a reason)" : "Unmanaged"),
            h("td", { style: "text-align:right" }, h("button", { type: "button", class: "btn sm", onclick: () => remove(e.name) }, "Remove")));
        })))) : null,
      h("form", { class: "row", style: "align-items:flex-end", onsubmit: add },
        h("label", { class: "field", style: "flex:1" }, h("span", {}, "Environment URL (its name is looked up for you)"), url),
        h("label", { class: "field" }, h("span", {}, "Type"), kind),
        addBtn),
      h("div", { class: "row", style: "align-items:flex-end" },
        h("label", { class: "field", style: "flex:1" }, h("span", {}, "Tenant (only if your account can sign in to several)"), tenant),
        h("button", { type: "button", class: "btn", onclick: saveTenant }, "Save tenant")),
      status));
  details.addEventListener("toggle", () => { acctState.open = details.open; });
  return details;
}

/** The environment's address as a link that opens it in a new tab. */
function envLink(url) {
  return h("a", { class: "mono truncate envlink", href: url, target: "_blank", rel: "noopener noreferrer", title: `Open ${url}` }, url.replace(/^https:\/\//, ""));
}

// ------------------------------------------------------------------ overview

async function overview() {
  const cards = new Map();
  const grid = h("section", { class: "grid", "aria-label": "Environments" });
  for (const e of config.environments) {
    const card = h("article", { class: "card stack" },
      h("div", { class: "env-head" },
        h("h2", { class: "env-title", title: `pcx --env ${e.name}` }, h("span", { class: "envdot", style: `background:${envColor(e.name)}`, "aria-hidden": "true" }), envLabel(e.name)),
        h("span", { class: e.managed ? "pill" : "pill ok" }, e.managed ? "Managed" : "Unmanaged")),
      envLink(e.url), h("div", { class: "muted small" }, "Checking…"));
    cards.set(e.name, card);
    grid.append(card);
  }
  const via = config.mode === "hosted" ? `signed in as ${config.user}` : `signed in through ${config.provider === "azps" ? "PowerShell" : "Azure CLI"}`;
  const alertBox = h("section", { class: "card row between", "aria-label": "Alerts" }, h("span", { class: "muted" }, "Checking for alerts…"));
  mount(header("Overview", "Environments", `${config.environments.length} environments · ${via}`, ...reportButtons(), h("button", { class: "btn", type: "button", onclick: () => overview() }, "Refresh")),
    acctState.notice ? notice(acctState.notice.kind, acctState.notice.text) : null, accountBar(), alertBox, grid, manageEnvironments());
  api("/api/alerts").then((d) => {
    alertState.data = d;
    const c = (sv) => d.alerts.filter((a) => a.severity === sv).length;
    alertBox.replaceChildren(
      h("div", { class: "row" }, h("strong", {}, d.alerts.length ? `${d.alerts.length} alerts in the last 24 hours` : "No alerts in the last 24 hours"),
        c("critical") ? h("span", { class: "pill bad" }, `${c("critical")} critical`) : null, c("warning") ? h("span", { class: "pill warn" }, `${c("warning")} warnings`) : null, c("info") ? h("span", { class: "pill info" }, `${c("info")} info`) : null),
      h("a", { class: "btn sm", href: "#/alerts" }, "View alerts"));
  }, () => alertBox.remove());
  let anyLogin = false;
  let learned = false;
  await Promise.all(config.environments.map(async (e) => {
    const card = cards.get(e.name);
    let st;
    try { st = await api(`/api/status?env=${encodeURIComponent(e.name)}`); } catch (err) { st = { connected: false, error: err.message }; }
    if (st.needsLogin) anyLogin = true;
    if (st.labelLearned) learned = true;
    if (st.connected && st.user && config.mode !== "hosted") {
      document.getElementById("who").textContent = `Signed in as ${st.user}`;
      if (acctState.user !== st.user) { acctState.user = st.user; main().querySelector("[aria-label=Account]")?.replaceWith(accountBar()); }
    }
    const q = `?env=${encodeURIComponent(e.name)}`;
    const body = st.connected
      ? [h("div", { class: "row small" }, h("span", { class: "dot ok" }), h("strong", {}, "Connected"), h("span", { class: "muted" }, st.version ? `v${st.version}` : "")),
         h("dl", { class: "stats" },
           h("div", {}, h("dt", {}, "Solutions"), h("dd", {}, st.solutions !== undefined ? fmtNum(st.solutions) : "—")),
           h("div", {}, h("dt", {}, "Flows on"), h("dd", {}, st.flowsTotal !== undefined ? [fmtNum(st.flowsOn), h("span", { class: "of" }, ` / ${fmtNum(st.flowsTotal)}`)] : "—")),
           h("div", {}, h("dt", {}, "Plugin steps on"), h("dd", {}, st.pluginStepsTotal !== undefined ? [fmtNum(st.pluginStepsOn), h("span", { class: "of" }, ` / ${fmtNum(st.pluginStepsTotal)}`)] : "—"))),
         st.error ? h("div", { class: "small muted" }, st.error) : null,
         h("div", { class: "row small" }, h("a", { href: "#/components" }, "Flows & plugins"), h("a", { href: `#/runs${q}` }, "Run history"), h("a", { href: "#/jobs" }, "Background jobs"))]
      : [h("div", { class: "row small" }, h("span", { class: "dot bad" }), h("strong", {}, st.needsLogin ? "Sign-in needed" : "Not reachable")), h("div", { class: "small muted" }, st.needsLogin && config.canManage ? "You're not signed in, or the sign-in has expired." : st.error || ""),
         config.canManage ? h("button", { type: "button", class: "btn sm primary", disabled: acctState.busy, onclick: signIn }, "Sign in") : config.mode === "hosted" ? h("a", { class: "btn sm", href: "/auth/login?returnTo=%2F%23%2Foverview" }, "Sign in again") : null];
    card.replaceChildren(card.children[0], card.children[1], ...body.filter(Boolean));
  }));
  if (learned) { await reloadConfig(); return overview(); }
  if (anyLogin && !config.canManage && config.mode !== "hosted") main().insertBefore(notice("warn", "Some environments need you to sign in. In a terminal run ", h("code", {}, "pcx auth login"), ", then press Refresh."), grid);
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
function removeLayerBox(row, env) {
  const reason = reasonInput(cmpState, env);
  reason.className = "input";
  return h("div", { class: "notice warn stack" },
    h("div", {}, `Someone changed this directly in ${env}, which is managed. That unmanaged change hides what the next import brings. Removing it puts the managed version back; anything changed directly in ${env} is lost, so move it to DEV first if you need it.`),
    h("label", { class: "field" }, h("span", {}, `Reason (required in ${env})`), reason),
    h("div", {}, h("button", { type: "button", class: "btn danger", disabled: cmpState.busy, onclick: () => removeLayer(row, env) }, `Remove unmanaged change in ${env}`)));
}
async function removeLayer(row, env) {
  if (missingReason(cmpState, [env])) { cmpState.error = cmpState.notice.text; renderCompare(); return; }
  if (!(await confirmDialog({ title: "Remove unmanaged change?", message: `The change made directly to "${row.name}" in ${env} is removed and the managed version comes back. This can't be undone.`, confirmText: "Remove change", danger: true }))) return;
  cmpState.busy = true; renderCompare();
  try {
    await api("/api/compare/remove-layer", { env, type: row.type, id: row.objectId, name: row.name, reason: cmpState.reason });
    cmpState.busy = false;
    await runCompare();
    cmpState.error = null;
    main().prepend(notice("ok", `Unmanaged change removed from ${row.name} in ${env}.`));
  } catch (err) { cmpState.busy = false; cmpState.error = err.message; renderCompare(); }
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
          (cmpState.sel.layerA || cmpState.sel.layerB) ? removeLayerBox(cmpState.sel, cmpState.sel.layerA ? A : B) : null,
          cmpState.diff?.loading ? loading("both definitions") :
          cmpState.diff?.error ? notice("bad", cmpState.diff.error) :
          cmpState.diff?.tooLarge ? notice("info", "These definitions are too large to show line by line, but they are different.") :
          cmpState.diff && !cmpState.diff.changed ? notice("ok", "The definitions are identical.") :
          cmpState.diff ? h("div", { class: "code" }, cmpState.diff.lines.map((l) => h("div", { class: l.t === "ctx" ? "" : l.t }, (l.t === "add" ? "+ " : l.t === "del" ? "- " : l.t === "skip" ? "" : "  ") + l.text))) : null)
        : null)
    ] : null
  );
}

// ------------------------------------------------------------------ environment-column helpers

const envNames = () => config.environments.map((e) => e.name);
const anyManaged = (names) => names.some((n) => envOf(n)?.managed);
function envHeads(names, extra) {
  return names.map((n) => h("th", { scope: "col", class: "envcol" }, chip(n), extra ? h("div", { class: "small muted", style: "margin-top:4px;font-weight:400" }, extra(n)) : null));
}
/** Lines up per-environment lists into rows keyed by `key`, one cell per environment. */
function toMatrix(results, names, key, base) {
  const rows = new Map();
  for (const n of names) for (const item of results[n] || []) {
    const k = key(item);
    if (!rows.has(k)) rows.set(k, { key: k, ...base(item), cells: {} });
    rows.get(k).cells[n] = item;
  }
  return [...rows.values()];
}
function errorsNotice(errors) {
  const e = Object.entries(errors || {});
  return e.length ? notice("bad", e.map(([n, m]) => `${n}: ${m}`).join(" · ")) : null;
}
/** Reason box shown once per page when any environment involved is managed. */
function reasonCard(state, names = envNames()) {
  if (!anyManaged(names)) return null;
  const input = reasonInput(state, names.filter((n) => envOf(n).managed).join(", "));
  input.className = "input";
  input.style.flex = "1";
  return h("label", { class: "card row", style: "padding:10px 16px" }, h("strong", { class: "small" }, `Reason for changes in ${names.filter((n) => envOf(n).managed).join(", ")}`), input);
}
function missingReason(state, names) {
  const managed = names.filter((n) => envOf(n)?.managed);
  if (managed.length && (state.reason || "").trim().length < 3) {
    state.notice = { kind: "warn", text: `${managed.join(", ")} ${managed.length > 1 ? "are" : "is"} managed: enter a reason first.` };
    return true;
  }
  return false;
}
function envChecks(state, names = envNames()) {
  state.targets ??= new Set(names);
  return h("div", { class: "envchecks", role: "group", "aria-label": "Apply to environments" },
    h("span", { class: "small" }, "Apply to"),
    names.map((n) => checkbox(envLabel(n), state.targets.has(n), (v) => { v ? state.targets.add(n) : state.targets.delete(n); })));
}
async function download(path) {
  const res = await fetch(path, { headers: { "x-pcx-request": "1", ...(key() ? { "x-pcx-key": key() } : {}) } });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  const name = (res.headers.get("Content-Disposition") || "").match(/filename="([^"]+)"/)?.[1] || "report";
  const url = URL.createObjectURL(await res.blob());
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
function reportButtons() {
  const go = (fmt) => async (ev) => {
    const b = ev.currentTarget;
    const label = b.textContent;
    b.disabled = true;
    b.textContent = "Building report…";
    try { await download(`/api/report?format=${fmt}&days=7`); } catch (err) { await messageDialog("Report not created", err.message); }
    b.disabled = false;
    b.textContent = label;
  };
  return [h("button", { type: "button", class: "btn primary", onclick: go("html") }, "Download report"), h("button", { type: "button", class: "btn", onclick: go("csv") }, "CSV")];
}

// ------------------------------------------------------------------ alerts

const alertState = { data: null, error: null, sev: "all", notice: null };
async function refreshAlertBadge() {
  try {
    const d = await api("/api/alerts");
    alertState.data = d;
    const n = d.alerts.filter((a) => a.severity !== "info").length;
    const b = document.getElementById("alert-badge");
    b.hidden = n === 0;
    b.textContent = String(n);
  } catch { /* badge is optional */ }
}
async function alerts() {
  alertState.error = null;
  renderAlerts();
  try { alertState.data = await api("/api/alerts"); } catch (err) { alertState.error = err.message; }
  renderAlerts();
}
function renderAlerts() {
  const d = alertState.data;
  const head = header("Monitoring", "Alerts", "Problems across every environment in the last 24 hours: failures, things not set up, and settings that need attention.",
    ...reportButtons(),
    d?.teams ? h("button", { type: "button", class: "btn", onclick: async () => {
      try { const r = await api("/api/alerts/teams", {}); alertState.notice = { kind: "ok", text: `Posted ${r.posted} alerts to Teams.` }; } catch (err) { alertState.notice = { kind: "bad", text: err.message }; }
      renderAlerts();
    } }, "Send to Teams") : null);
  if (alertState.error) return mount(head, notice("bad", alertState.error));
  if (!d) return mount(head, loading("alerts from every environment"));
  const list = d.alerts.filter((a) => alertState.sev === "all" || a.severity === alertState.sev);
  const count = (s) => d.alerts.filter((a) => a.severity === s).length;
  const names = envNames();
  const kinds = [...new Set(d.alerts.map((a) => a.kind))];
  const kindLabel = { access: "Access", flow: "Flow failures", plugin: "Plugin errors", tracing: "Plugin tracing", jobs: "Background jobs", variable: "Variables", connection: "Connections", audit: "Auditing" };
  mount(head,
    alertState.notice ? notice(alertState.notice.kind, alertState.notice.text) : null,
    !d.teams ? notice("info", "To get these in a Teams channel, add a webhook: ", h("code", {}, "pcx config set teams-webhook <url>"), ", then ", h("code", {}, "pcx alerts schedule --install"), ".") : null,
    h("section", { class: "tiles" },
      [["critical", "Critical", "var(--bad)"], ["warning", "Warnings", "var(--warn-text)"], ["info", "Info", "var(--accent-text)"]].map(([k, t, col]) =>
        h("div", { class: "tile" }, h("div", { class: "k" }, t), h("div", { class: "v", style: count(k) ? `color:${col}` : "" }, count(k))))),
    kinds.length ? h("section", { class: "card flush", "aria-label": "Alerts by environment" },
      h("div", { class: "scroll" }, h("table", { class: "envtable" },
        h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Area"), envHeads(names))),
        h("tbody", {}, kinds.map((k) => h("tr", {}, h("th", { scope: "row" }, kindLabel[k] || k),
          names.map((n) => {
            const x = d.alerts.filter((a) => a.kind === k && a.env === n);
            const worst = x.some((a) => a.severity === "critical") ? "bad" : x.some((a) => a.severity === "warning") ? "warn" : x.length ? "info" : "ok";
            return h("td", { class: "envcol" }, x.length ? h("span", { class: `pill ${worst}` }, x.length) : h("span", { class: "muted" }, "—"));
          }))))))) : null,
    seg([["all", `All (${d.alerts.length})`], ["critical", "Critical"], ["warning", "Warnings"], ["info", "Info"]], alertState.sev, (v) => { alertState.sev = v; renderAlerts(); }, "Severity"),
    h("section", { class: "card flush" },
      list.length === 0 ? h("div", { class: "empty" }, "No alerts. Everything looks healthy.") :
      h("ul", { class: "list" }, list.map((a) => h("li", { style: "display:grid;grid-template-columns:76px 84px minmax(0,1fr) auto;gap:12px;align-items:start;padding:12px 20px" },
        h("span", { class: `pill ${a.severity === "critical" ? "bad" : a.severity === "warning" ? "warn" : "info"}` }, a.severity === "critical" ? "Critical" : a.severity === "warning" ? "Warning" : "Info"),
        chip(a.env),
        h("div", { style: "min-width:0" }, h("div", { style: "font-weight:600" }, a.title), a.detail ? h("div", { class: "small muted", style: "overflow:hidden;text-overflow:ellipsis;white-space:nowrap" }, a.detail) : null),
        h("a", { class: "btn sm", href: a.route }, "Open"))))));
}

// ------------------------------------------------------------------ flows, rules, plugins (one column per environment)

const compState = { kind: "flow", sel: new Set(), reason: "", data: null, notice: null, all: false, q: "", onlyDiff: false, busy: false };
async function components(params) {
  if (params.get("kind") && KIND_LABEL[params.get("kind")]) compState.kind = params.get("kind");
  if (params.get("q") !== null) compState.q = params.get("q") || "";
  compState.sel.clear();
  compState.data = null;
  renderComponents();
  try { compState.data = await api(`/api/components/all?kind=${compState.kind}${compState.all ? "&all=1" : ""}`); }
  catch (err) { compState.data = { error: err.message }; }
  renderComponents();
}
/** Turns the given rows on or off in the given environments (one request per environment). */
async function setStates(rows, names, on) {
  if (missingReason(compState, names)) { renderComponents(); return; }
  compState.busy = true;
  renderComponents();
  const done = [], failed = [];
  for (const n of names) {
    const ids = rows.map((r) => r.cells[n]).filter((c) => c && c.on !== on).map((c) => c.id);
    if (!ids.length) continue;
    try {
      const { results } = await api("/api/components/state", { env: n, kind: compState.kind, ids, on, reason: compState.reason });
      results.forEach((r) => (r.ok ? done : failed).push(`${n}: ${r.name}${r.error ? ` (${r.error})` : ""}`));
    } catch (err) { failed.push(`${n}: ${err.message}`); }
  }
  compState.notice = failed.length ? { kind: "bad", text: `${done.length} changed, ${failed.length} failed. ${failed.slice(0, 5).join("; ")}` } : done.length ? { kind: "ok", text: `${done.length} change${done.length === 1 ? "" : "s"} made: turned ${on ? "on" : "off"} in ${names.join(", ")}.` } : { kind: "info", text: `Nothing to change: already ${on ? "on" : "off"}.` };
  compState.busy = false;
  await components(new URLSearchParams());
}
function renderComponents() {
  const d = compState.data;
  const names = d?.environments?.filter((n) => d.results[n]) ?? envNames();
  const q = compState.q.trim().toLowerCase();
  let rows = d && !d.error ? toMatrix(d.results, names, (i) => i.id.toLowerCase(), (i) => ({ name: i.name, target: i.target, solution: i.solution, custom: i.custom })) : [];
  rows.sort((a, b) => a.name.localeCompare(b.name));
  rows = rows.filter((r) => !q || `${r.name} ${r.target} ${r.solution || ""}`.toLowerCase().includes(q));
  if (compState.onlyDiff) rows = rows.filter((r) => new Set(names.map((n) => (r.cells[n] ? String(r.cells[n].on) : "-"))).size > 1);
  const search = h("input", { type: "search", placeholder: "Search name, table or solution", value: compState.q, "aria-label": "Search" });
  search.addEventListener("input", () => { compState.q = search.value; const pos = search.selectionStart; renderComponents(); const el = main().querySelector("input[type=search]"); el.focus(); el.setSelectionRange(pos, pos); });
  const allBox = h("input", { type: "checkbox", "aria-label": "Select all shown" });
  allBox.checked = rows.length > 0 && rows.every((r) => compState.sel.has(r.key));
  allBox.addEventListener("change", () => { allBox.checked ? rows.forEach((r) => compState.sel.add(r.key)) : compState.sel.clear(); renderComponents(); });
  const selRows = rows.filter((r) => compState.sel.has(r.key));
  const bulk = selRows.length ? h("section", { class: "bulk", "aria-label": "Change selected" },
    h("strong", {}, `${selRows.length} selected`), envChecks(compState, names),
    h("div", { class: "row", style: "margin-left:auto" },
      h("button", { type: "button", class: "btn good", disabled: compState.busy, onclick: () => setStates(selRows, [...compState.targets].filter((n) => names.includes(n)), true) }, "Turn on"),
      h("button", { type: "button", class: "btn ghost", disabled: compState.busy, onclick: () => setStates(selRows, [...compState.targets].filter((n) => names.includes(n)), false) }, "Turn off"),
      h("button", { type: "button", class: "btn ghost", style: "border:0", onclick: () => { compState.sel.clear(); renderComponents(); } }, "Clear"))) : null;
  const onCount = (n) => rows.filter((r) => r.cells[n]?.on).length;
  mount(
    header("Automation", "Flows, business rules & plugins", "Every environment side by side. Switch one cell, or tick rows and choose which environments to change."),
    h("div", { class: "row between" },
      seg(Object.entries(KIND_LABEL), compState.kind, (k) => { compState.kind = k; compState.notice = null; components(new URLSearchParams()); }, "Type", "tablist"),
      h("div", { class: "row" }, h("label", { class: "search" }, search),
        checkbox("Only where environments differ", compState.onlyDiff, (v) => { compState.onlyDiff = v; renderComponents(); }),
        checkbox("Show Microsoft and system items", compState.all, (v) => { compState.all = v; components(new URLSearchParams()); }))),
    compState.notice ? notice(compState.notice.kind, compState.notice.text) : null,
    d ? errorsNotice(d.errors) : null,
    reasonCard(compState, names),
    bulk,
    h("section", { class: "card flush", "aria-label": KIND_LABEL[compState.kind] },
      !d ? h("div", { class: "empty" }, "Loading from every environment…") :
      d.error ? h("div", { style: "padding:16px" }, notice("bad", d.error)) :
      rows.length === 0 ? h("div", { class: "empty" }, `No ${KIND_LABEL[compState.kind].toLowerCase()} ${q || compState.onlyDiff ? "match" : "found"}${compState.all ? "" : " (custom only)"}.`) :
      h("div", { class: "scroll" }, h("table", { class: "envtable" },
        h("thead", {}, h("tr", {}, h("th", { scope: "col", style: "width:44px" }, allBox), h("th", { scope: "col" }, "Name"), h("th", { scope: "col" }, compState.kind === "plugin" ? "Table · message · stage" : "Table"), h("th", { scope: "col" }, "Solution"),
          envHeads(names, (n) => `${onCount(n)} on`))),
        h("tbody", {}, rows.map((r) => {
          const box = h("input", { type: "checkbox", "aria-label": `Select ${r.name}` });
          box.checked = compState.sel.has(r.key);
          box.addEventListener("change", () => { box.checked ? compState.sel.add(r.key) : compState.sel.delete(r.key); renderComponents(); });
          const states = new Set(names.map((n) => (r.cells[n] ? String(r.cells[n].on) : "-")));
          return h("tr", { class: compState.sel.has(r.key) ? "sel" : "" },
            h("td", {}, box),
            h("th", { scope: "row" }, r.name, r.custom ? null : h("span", { class: "pill", style: "margin-left:8px" }, "Microsoft / system")),
            h("td", { class: "muted small" }, r.target),
            h("td", { class: "muted small" }, r.solution || ""),
            names.map((n) => {
              const c = r.cells[n];
              if (!c) return h("td", { class: "envcol muted" }, "—");
              return h("td", { class: `envcol${states.size > 1 ? " differs" : ""}` }, switchButton(c.on, `${c.on ? "Turn off" : "Turn on"} ${r.name} in ${n}`, () => setStates([r], [n], !c.on)));
            }));
        }))))),
    h("p", { class: "small muted", style: "margin:0" }, "Highlighted rows are on in some environments and off in others. — means it isn't in that environment. Every change is logged on the Activity page."));
}

// ------------------------------------------------------------------ run history (all environments)

const runState = { since: "7d", data: null, error: null, tab: "flows", failedOnly: true, open: null, reason: "", notice: null, envFilter: "all" };
async function runs(params) {
  if (params.get("env") && envOf(params.get("env"))) runState.envFilter = params.get("env");
  runState.data = null; runState.error = null; runState.open = null;
  renderRuns();
  try { runState.data = await api(`/api/runs/all?since=${runState.since}`); } catch (err) { runState.error = err.message; }
  renderRuns();
}
async function setTrace(env, setting) {
  if (missingReason(runState, [env])) { renderRuns(); return; }
  try {
    await api("/api/runs/trace", { env, setting, reason: runState.reason });
    runState.notice = { kind: "ok", text: `Plugin trace log in ${env} set to "${setting}".` };
  } catch (err) { runState.notice = { kind: "bad", text: err.message }; }
  await runs(new URLSearchParams());
}

/** Stacked daily bars: succeeded below, failed on top, 2px gap, rounded top. */
function dailyChart(points, series, label, W = 760) {
  const H = 200, L = 36, R = 8, T = 10, B = 26;
  const totals = points.map((p) => series.reduce((a, s2) => a + (p[s2.key] || 0), 0));
  const max = Math.max(1, ...totals);
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const y = (v) => T + (H - T - B) * (1 - v / top);
  const bw = (W - L - R) / Math.max(1, points.length);
  const barW = Math.max(3, Math.min(24, bw * 0.6));
  const svg = s("svg", { class: "chart", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": label });
  const grid = s("g", { class: "grid" });
  for (let v = 0; v <= top; v += step) grid.append(s("line", { x1: L, x2: W - R, y1: y(v), y2: y(v) }), s("text", { x: L - 6, y: y(v) + 4, "text-anchor": "end" }, fmtNum(v)));
  svg.append(grid);
  const every = Math.ceil(points.length / (W / 70));
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
function barPath(x, y, w, hgt, r) {
  if (r <= 0) return `M${x},${y}h${w}v${hgt}h${-w}Z`;
  r = Math.min(r, hgt);
  return `M${x},${y + hgt}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + hgt}Z`;
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
function statusPill(status) {
  const map = { succeeded: ["Succeeded", "ok"], failed: ["Failed", "bad"], cancelled: ["Cancelled", ""], running: ["Running", "info"], other: ["Other", ""] };
  const [t, c] = map[status] || [status, ""];
  return h("span", { class: `pill ${c}` }, t);
}
function renderRuns() {
  const d = runState.data;
  const head = header("Monitoring", "Run history", "Cloud flow runs and plugin errors in every environment, with the error behind every failure.",
    seg([["24h", "24 hours"], ["7d", "7 days"], ["30d", "30 days"]], runState.since, (v) => { runState.since = v; runs(new URLSearchParams()); }, "Time range"));
  if (runState.error) return mount(head, notice("bad", runState.error));
  if (!d) return mount(head, loading("runs from every environment"));
  const names = d.environments.filter((n) => d.results[n]);
  const R = d.results;
  const flowSeries = [{ key: "flowSucceeded", label: "Succeeded", cls: "ok", color: "--chart-ok" }, { key: "flowFailed", label: "Failed", cls: "bad", color: "--chart-bad" }];
  const metric = (label, f) => h("tr", {}, h("th", { scope: "row" }, label), names.map((n) => h("td", { class: "envcol" }, f(R[n], n))));
  const traceSeg = (n) => {
    const sel = h("select", { class: "input", style: "min-height:32px", "aria-label": `Plugin trace log in ${n}` }, [["off", "Off"], ["exceptions", "Exceptions"], ["all", "All"]].map(([v, t]) => h("option", { value: v, selected: R[n].plugins.setting === v }, t)));
    sel.addEventListener("change", () => setTrace(n, sel.value));
    return sel;
  };
  // failures by component across environments
  const comp = new Map();
  for (const n of names) for (const g of R[n].top) {
    const k = `${g.kind}:${g.name}`;
    if (!comp.has(k)) comp.set(k, { kind: g.kind, name: g.name, cells: {}, total: 0, lastError: g.lastError });
    comp.get(k).cells[n] = g;
    comp.get(k).total += g.failures;
  }
  const failing = [...comp.values()].sort((a, b) => b.total - a.total).slice(0, 15);
  const pick = runState.envFilter;
  const allFlows = names.flatMap((n) => R[n].flows.runs.map((r) => ({ ...r, env: n }))).filter((r) => (pick === "all" || r.env === pick) && (!runState.failedOnly || r.status === "failed")).sort((a, b) => b.start.localeCompare(a.start));
  const allLogs = names.flatMap((n) => R[n].plugins.logs.map((l) => ({ ...l, env: n }))).filter((l) => (pick === "all" || l.env === pick) && (!runState.failedOnly || l.failed)).sort((a, b) => b.at.localeCompare(a.at));
  mount(head,
    runState.notice ? notice(runState.notice.kind, runState.notice.text) : null,
    errorsNotice(d.errors),
    reasonCard(runState, names),
    h("section", { class: "card flush", "aria-label": "Summary by environment" },
      h("div", { class: "scroll" }, h("table", { class: "envtable" },
        h("thead", {}, h("tr", {}, h("th", { scope: "col" }, `Last ${runState.since}`), envHeads(names))),
        h("tbody", {},
          metric("Flow runs", (x) => (x.flows.available ? fmtNum(x.totals.flowRuns) : h("span", { class: "muted", title: x.flows.error || "" }, "not available"))),
          metric("Failed flow runs", (x) => (x.totals.flowFailed ? h("strong", { style: "color:var(--bad)" }, fmtNum(x.totals.flowFailed)) : "0")),
          metric("Failure rate", (x) => (x.totals.flowRuns ? `${Math.round((x.totals.flowFailed / x.totals.flowRuns) * 1000) / 10}%` : "—")),
          metric("Plugin errors", (x) => (x.totals.pluginFailed ? h("strong", { style: "color:var(--bad)" }, fmtNum(x.totals.pluginFailed)) : "0")),
          metric("Plugin trace log", (x, n) => traceSeg(n)),
          metric("Components failing", (x) => fmtNum(x.top.length)))))),
    h("div", { class: "row between" }, h("h2", {}, "Flow runs per day"), legend(flowSeries)),
    h("div", { class: "small-multiples" }, names.map((n) => h("section", { class: "card stack", "aria-label": `Flow runs per day in ${n}` },
      h("div", { class: "row between" }, chip(n), h("span", { class: "small muted" }, `${fmtNum(R[n].totals.flowFailed)} failed of ${fmtNum(R[n].totals.flowRuns)}`)),
      dailyChart(R[n].daily, flowSeries, `Flow runs per day in ${n}: succeeded and failed`, 460)))),
    h("section", { class: "card flush", "aria-label": "Failures by component" },
      h("h2", { style: "padding:16px 20px 8px" }, "Failures by component"),
      failing.length === 0 ? h("div", { class: "empty" }, "Nothing failed in this period.") :
      h("div", { class: "scroll" }, h("table", { class: "envtable" },
        h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Component"), envHeads(names), h("th", { scope: "col" }, ""))),
        h("tbody", {}, failing.map((g) => h("tr", {},
          h("th", { scope: "row" }, g.name, h("div", { class: "small muted", style: "max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" }, `${g.kind === "flow" ? "Cloud flow" : "Plugin"} · ${firstLine(g.lastError, 120)}`)),
          names.map((n) => h("td", { class: "envcol" }, g.cells[n] ? [h("strong", { style: "color:var(--bad)" }, g.cells[n].failures), h("span", { class: "muted" }, ` / ${g.cells[n].total}`)] : h("span", { class: "muted" }, "—"))),
          h("td", { style: "text-align:right" }, h("a", { class: "btn sm", href: `#/components?kind=${g.kind === "flow" ? "flow" : "plugin"}&q=${encodeURIComponent(g.kind === "flow" ? g.name : g.name.split(".").pop())}` }, "Turn off…")))))))),
    h("section", { class: "card flush", "aria-label": "Runs" },
      h("div", { class: "row between", style: "padding:12px 20px" },
        seg([["flows", `Flow runs (${allFlows.length})`], ["plugins", `Plugin log (${allLogs.length})`]], runState.tab, (v) => { runState.tab = v; runState.open = null; renderRuns(); }, "Run list", "tablist"),
        h("div", { class: "row" }, seg([["all", "All environments"], ...names.map((n) => [n, envLabel(n)])], pick, (v) => { runState.envFilter = v; renderRuns(); }, "Environment"),
          checkbox("Failures only", runState.failedOnly, (v) => { runState.failedOnly = v; renderRuns(); }))),
      runState.tab === "flows" ? runTable(allFlows) : pluginTable(allLogs)));
}
function runTable(rows) {
  if (!rows.length) return h("div", { class: "empty" }, runState.failedOnly ? "No failed flow runs in this period." : "No flow runs in this period.");
  return h("div", { class: "scroll" }, h("table", {},
    h("thead", {}, h("tr", {}, ["Env", "Status", "Flow", "Started", "Duration", "Error", ""].map((t) => h("th", { scope: "col" }, t)))),
    h("tbody", {}, rows.slice(0, 300).flatMap((r) => {
      const id = `${r.env}:${r.id}`;
      const open = runState.open === id;
      const row = h("tr", { class: open ? "sel" : "" },
        h("td", {}, chip(r.env)), h("td", {}, statusPill(r.status)), h("th", { scope: "row" }, r.flowName),
        h("td", { class: "small", style: "white-space:nowrap" }, fmtDate(r.start)),
        h("td", { class: "mono" }, r.durationMs !== undefined ? `${(r.durationMs / 1000).toFixed(1)}s` : ""),
        h("td", { class: "small", style: "color:var(--bad-text);max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" }, r.errorCode || firstLine(r.errorMessage)),
        h("td", { style: "text-align:right" }, (r.errorMessage || r.link) ? h("button", { type: "button", class: "btn sm", "aria-expanded": open ? "true" : "false", onclick: () => { runState.open = open ? null : id; renderRuns(); } }, open ? "Hide" : "Details") : null));
      if (!open) return [row];
      return [row, h("tr", {}, h("td", { colspan: 7 }, h("div", { class: "stack" },
        r.errorMessage ? h("div", { class: "code wrap" }, h("div", {}, r.errorMessage)) : null,
        h("div", { class: "row small muted" }, r.trigger ? `Trigger: ${r.trigger}` : null, r.link ? h("a", { href: r.link, target: "_blank", rel: "noopener noreferrer" }, "Open this run in Power Automate") : null))))];
    }))));
}
function pluginTable(rows) {
  if (!rows.length) return h("div", { class: "empty" }, runState.failedOnly ? "No plugin errors recorded in this period." : "Nothing in the plugin trace log for this period.");
  return h("div", { class: "scroll" }, h("table", {},
    h("thead", {}, h("tr", {}, ["Env", "Status", "Plugin", "Message", "When", "Duration", ""].map((t) => h("th", { scope: "col" }, t)))),
    h("tbody", {}, rows.slice(0, 300).flatMap((l) => {
      const id = `${l.env}:${l.id}`;
      const open = runState.open === id;
      const row = h("tr", { class: open ? "sel" : "" },
        h("td", {}, chip(l.env)), h("td", {}, statusPill(l.failed ? "failed" : "succeeded")),
        h("th", { scope: "row" }, l.typeName, h("div", { class: "small", style: "color:var(--bad-text)" }, l.failed ? firstLine(l.exception, 120) : "")),
        h("td", { class: "small" }, `${l.table || "any"} · ${l.message} · ${l.mode}`),
        h("td", { class: "small", style: "white-space:nowrap" }, fmtDate(l.at)),
        h("td", { class: "mono" }, l.durationMs !== undefined ? `${l.durationMs} ms` : ""),
        h("td", { style: "text-align:right" }, h("button", { type: "button", class: "btn sm", "aria-expanded": open ? "true" : "false", onclick: () => { runState.open = open ? null : id; renderRuns(); } }, open ? "Hide" : "Details")));
      if (!open) return [row];
      return [row, h("tr", {}, h("td", { colspan: 7 }, h("div", { class: "stack" },
        l.exception ? [h("h3", {}, "Exception"), h("div", { class: "code wrap" }, l.exception.split("\n").map((x) => h("div", {}, x)))] : null,
        l.trace ? [h("h3", {}, "Trace"), h("div", { class: "code wrap" }, l.trace.split("\n").map((x) => h("div", {}, x)))] : null,
        h("div", { class: "small muted" }, `Depth ${l.depth ?? "?"} · correlation ${l.correlationId || "?"}`))))];
    }))));
}

// ------------------------------------------------------------------ background jobs

const PROBLEM = { failed: ["Failed", "bad"], suspended: ["Suspended", "warn"], waiting: ["Waiting over 1 hour", "warn"], "long-running": ["Running over 2 hours", "info"] };
const jobState = { since: "7d", data: null, error: null, sel: new Set(), reason: "", notice: null, envFilter: "all", problem: "all", busy: false };
async function jobs() {
  jobState.data = null; jobState.error = null; jobState.sel.clear();
  renderJobs();
  try { jobState.data = await api(`/api/jobs/all?since=${jobState.since}`); } catch (err) { jobState.error = err.message; }
  renderJobs();
}
async function changeJobsUi(action, rows) {
  const names = [...new Set(rows.map((r) => r.env))];
  if (missingReason(jobState, names)) { renderJobs(); return; }
  if (action === "cancel" && !(await confirmDialog({ title: `Cancel ${rows.length} background job${rows.length === 1 ? "" : "s"}?`, message: "Cancelled jobs stop and can't be restarted.", confirmText: "Cancel jobs", cancelText: "Keep them", danger: true }))) return;
  jobState.busy = true; renderJobs();
  let ok = 0; const failed = [];
  for (const n of names) {
    try {
      const { results } = await api("/api/jobs/change", { env: n, action, ids: rows.filter((r) => r.env === n).map((r) => r.id), reason: jobState.reason });
      results.forEach((r) => (r.ok ? ok++ : failed.push(`${n}: ${r.name} (${r.error})`)));
    } catch (err) { failed.push(`${n}: ${err.message}`); }
  }
  jobState.notice = failed.length ? { kind: "bad", text: `${ok} done, ${failed.length} failed. ${failed.slice(0, 4).join("; ")}` } : { kind: "ok", text: `${ok} job${ok === 1 ? "" : "s"} ${action === "cancel" ? "cancelled" : "resumed"}.` };
  jobState.busy = false;
  await jobs();
}
function renderJobs() {
  const d = jobState.data;
  const head = header("Automation", "Background jobs", "System jobs that failed, are suspended, or have been waiting or running far too long, in every environment.",
    seg([["24h", "24 hours"], ["7d", "7 days"], ["30d", "30 days"]], jobState.since, (v) => { jobState.since = v; jobs(); }, "Time range"));
  if (jobState.error) return mount(head, notice("bad", jobState.error));
  if (!d) return mount(head, loading("background jobs from every environment"));
  const names = d.environments.filter((n) => d.results[n]);
  const all = names.flatMap((n) => d.results[n].map((j) => ({ ...j, env: n, key: `${n}:${j.id}` }))).sort((a, b) => b.created.localeCompare(a.created));
  const rows = all.filter((j) => (jobState.envFilter === "all" || j.env === jobState.envFilter) && (jobState.problem === "all" || j.problem === jobState.problem));
  const sel = rows.filter((j) => jobState.sel.has(j.key));
  const allBox = h("input", { type: "checkbox", "aria-label": "Select all shown" });
  allBox.checked = rows.length > 0 && rows.every((j) => jobState.sel.has(j.key));
  allBox.addEventListener("change", () => { allBox.checked ? rows.forEach((j) => jobState.sel.add(j.key)) : jobState.sel.clear(); renderJobs(); });
  // by job name across environments
  const byName = new Map();
  for (const j of all) {
    if (!byName.has(j.name)) byName.set(j.name, { name: j.name, type: j.type, cells: {} });
    const c = byName.get(j.name).cells;
    c[j.env] = (c[j.env] || 0) + 1;
  }
  const grouped = [...byName.values()].sort((a, b) => Object.values(b.cells).reduce((x, y) => x + y, 0) - Object.values(a.cells).reduce((x, y) => x + y, 0)).slice(0, 12);
  mount(head,
    jobState.notice ? notice(jobState.notice.kind, jobState.notice.text) : null,
    errorsNotice(d.errors),
    h("section", { class: "card flush", "aria-label": "Summary by environment" },
      h("div", { class: "scroll" }, h("table", { class: "envtable" },
        h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Problem"), envHeads(names))),
        h("tbody", {}, Object.entries(PROBLEM).map(([k, [label, cls]]) => h("tr", {}, h("th", { scope: "row" }, label),
          names.map((n) => {
            const c = d.results[n].filter((j) => j.problem === k).length;
            return h("td", { class: "envcol" }, c ? h("span", { class: `pill ${cls}` }, c) : h("span", { class: "muted" }, "0"));
          }))))))),
    grouped.length ? h("section", { class: "card flush", "aria-label": "Jobs by name" },
      h("h2", { style: "padding:16px 20px 8px" }, "Which jobs"),
      h("div", { class: "scroll" }, h("table", { class: "envtable" },
        h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Job"), h("th", { scope: "col" }, "Type"), envHeads(names))),
        h("tbody", {}, grouped.map((g) => h("tr", {}, h("th", { scope: "row" }, g.name), h("td", { class: "muted small" }, g.type), names.map((n) => h("td", { class: "envcol" }, g.cells[n] || h("span", { class: "muted" }, "—"))))))))) : null,
    reasonCard(jobState, names),
    sel.length ? h("section", { class: "bulk", "aria-label": "Change selected" }, h("strong", {}, `${sel.length} selected`),
      h("div", { class: "row", style: "margin-left:auto" },
        h("button", { type: "button", class: "btn good", disabled: jobState.busy || !sel.some((j) => j.problem === "suspended"), onclick: () => changeJobsUi("resume", sel.filter((j) => j.problem === "suspended")) }, "Resume suspended"),
        h("button", { type: "button", class: "btn ghost", disabled: jobState.busy, onclick: () => changeJobsUi("cancel", sel.filter((j) => j.problem !== "failed")) }, "Cancel"),
        h("button", { type: "button", class: "btn ghost", style: "border:0", onclick: () => { jobState.sel.clear(); renderJobs(); } }, "Clear"))) : null,
    h("section", { class: "card flush", "aria-label": "Jobs" },
      h("div", { class: "row between", style: "padding:12px 20px" },
        seg([["all", "All"], ...Object.entries(PROBLEM).map(([k, [l]]) => [k, l])], jobState.problem, (v) => { jobState.problem = v; renderJobs(); }, "Problem"),
        seg([["all", "All environments"], ...names.map((n) => [n, envLabel(n)])], jobState.envFilter, (v) => { jobState.envFilter = v; renderJobs(); }, "Environment")),
      rows.length === 0 ? h("div", { class: "empty" }, "No background jobs need attention.") :
      h("div", { class: "scroll" }, h("table", {},
        h("thead", {}, h("tr", {}, h("th", { scope: "col", style: "width:44px" }, allBox), ["Env", "Problem", "Job", "Type", "Created", "Message"].map((t) => h("th", { scope: "col" }, t)))),
        h("tbody", {}, rows.slice(0, 300).map((j) => {
          const box = h("input", { type: "checkbox", "aria-label": `Select ${j.name}`, disabled: j.problem === "failed" });
          box.checked = jobState.sel.has(j.key);
          box.addEventListener("change", () => { box.checked ? jobState.sel.add(j.key) : jobState.sel.delete(j.key); renderJobs(); });
          return h("tr", { class: jobState.sel.has(j.key) ? "sel" : "" },
            h("td", {}, box), h("td", {}, chip(j.env)), h("td", {}, h("span", { class: `pill ${PROBLEM[j.problem][1]}` }, PROBLEM[j.problem][0])),
            h("th", { scope: "row" }, j.name, j.regarding ? h("div", { class: "small muted" }, j.regarding) : null),
            h("td", { class: "small muted" }, j.type), h("td", { class: "small", style: "white-space:nowrap" }, fmtDate(j.created)),
            h("td", { class: "small", style: "max-width:380px" }, firstLine(j.message, 200)));
        }))))),
    h("p", { class: "small muted", style: "margin:0" }, "Failed jobs are finished and can't be changed; they're listed so you can see why they failed."));
}

// ------------------------------------------------------------------ audit (all environments)

const audState = { system: null, tables: null, table: null, columns: null, column: null, log: null, since: "7d", q: "", only: "all", selT: new Set(), selC: new Set(), reason: "", notice: null, error: null, busy: false };
async function audit() {
  audState.error = null;
  renderAudit();
  try {
    const [sys, tables] = await Promise.all([api("/api/audit/system/all"), api("/api/audit/tables/all")]);
    audState.system = sys; audState.tables = tables;
  } catch (err) { audState.error = err.message; }
  renderAudit();
  if (audState.table) loadAuditTable(audState.table);
}
async function loadAuditTable(t) {
  audState.table = t; audState.column = null; audState.columns = null; audState.log = null; audState.selC.clear();
  renderAudit();
  const [cols, log] = await Promise.allSettled([api(`/api/audit/columns/all?table=${t}`), api(`/api/audit/log/all?table=${t}&since=${audState.since}`)]);
  audState.columns = cols.status === "fulfilled" ? cols.value : { error: cols.reason.message };
  audState.log = log.status === "fulfilled" ? log.value : { error: log.reason.message };
  renderAudit();
}
async function loadAuditLog() {
  audState.log = null; renderAudit();
  const col = audState.column ? `&column=${audState.column}` : "";
  try { audState.log = await api(`/api/audit/log/all?table=${audState.table}${col}&since=${audState.since}`); } catch (err) { audState.log = { error: err.message }; }
  renderAudit();
}
/** changes: [{env, table, column?, on}] */
async function applyAudit(changes) {
  const names = [...new Set(changes.map((c) => c.env))];
  if (!changes.length) { audState.notice = { kind: "info", text: "Nothing to change." }; renderAudit(); return; }
  if (missingReason(audState, names)) { renderAudit(); return; }
  audState.busy = true;
  audState.notice = { kind: "info", text: `Updating ${changes.length} item(s) and publishing…` };
  renderAudit();
  let ok = 0; const failed = [];
  for (const n of names) {
    try {
      const { results } = await api("/api/audit/set", { env: n, changes: changes.filter((c) => c.env === n).map(({ table, column, on }) => ({ table, column, on })), reason: audState.reason });
      results.forEach((r) => (r.ok ? ok++ : failed.push(`${n}: ${r.column || r.table} (${r.error})`)));
    } catch (err) { failed.push(`${n}: ${err.message}`); }
  }
  audState.notice = failed.length ? { kind: "bad", text: `${ok} changed, ${failed.length} failed. ${failed.slice(0, 4).join("; ")}` } : { kind: "ok", text: `Auditing updated for ${ok} item(s) and published.` };
  audState.busy = false;
  audState.selT.clear(); audState.selC.clear();
  audState.tables = await api("/api/audit/tables/all");
  if (audState.table) await loadAuditTable(audState.table); else renderAudit();
}
async function changeSystem(env, field, value) {
  if (missingReason(audState, [env])) { renderAudit(); return; }
  try {
    await api("/api/audit/system", { env, [field]: value, reason: audState.reason });
    audState.system = await api("/api/audit/system/all");
    audState.notice = { kind: "ok", text: `System auditing updated in ${env}.` };
  } catch (err) { audState.notice = { kind: "bad", text: err.message }; }
  renderAudit();
}
function renderAudit() {
  const head = header("Governance", "Audit", "Auditing in every environment: the whole system, each table and each column, and what changed.");
  if (audState.error) return mount(head, notice("bad", audState.error));
  if (!audState.tables || !audState.system) return mount(head, loading("audit settings from every environment"));
  const names = audState.tables.environments.filter((n) => audState.tables.results[n]);
  const sys = audState.system.results;
  const q = audState.q.trim().toLowerCase();
  let tables = toMatrix(audState.tables.results, names, (t) => t.logicalName, (t) => ({ logicalName: t.logicalName, displayName: t.displayName, isCustom: t.isCustom }));
  tables.sort((a, b) => a.displayName.localeCompare(b.displayName));
  const differs = (r) => new Set(names.map((n) => (r.cells[n] ? String(r.cells[n].auditEnabled) : "-"))).size > 1;
  tables = tables.filter((t) => (!q || `${t.displayName} ${t.logicalName}`.toLowerCase().includes(q)) &&
    (audState.only === "all" || (audState.only === "off" ? names.some((n) => t.cells[n] && !t.cells[n].auditEnabled) : audState.only === "diff" ? differs(t) : t.isCustom)));
  const search = h("input", { type: "search", placeholder: "Search tables", value: audState.q, "aria-label": "Search tables" });
  search.addEventListener("input", () => { audState.q = search.value; const pos = search.selectionStart; renderAudit(); const el = main().querySelector("input[type=search]"); el.focus(); el.setSelectionRange(pos, pos); });
  const cell = (item, onToggle, label) => (!item ? h("td", { class: "envcol muted" }, "—") : h("td", { class: "envcol" }, item.canChange === false ? h("span", { class: `pill ${item.auditEnabled ? "ok" : ""}` }, item.auditEnabled ? "On" : "Off") : switchButton(item.auditEnabled, label, onToggle)));
  const tObj = tables.find((t) => t.logicalName === audState.table) || toMatrix(audState.tables.results, names, (t) => t.logicalName, (t) => ({ displayName: t.displayName })).find((t) => t.key === audState.table);
  const cols = audState.columns && !audState.columns.error ? toMatrix(audState.columns.results, names, (c) => c.logicalName, (c) => ({ logicalName: c.logicalName, displayName: c.displayName, type: c.type })).sort((a, b) => a.displayName.localeCompare(b.displayName)) : [];
  const selCount = audState.selT.size + audState.selC.size;
  const bulkChanges = (on) => {
    const t = [...audState.targets].filter((n) => names.includes(n));
    const out = [];
    for (const n of t) {
      for (const tb of audState.selT) { const c = audState.tables.results[n]?.find((x) => x.logicalName === tb); if (c && c.auditEnabled !== on) out.push({ env: n, table: tb, on }); }
      if (audState.table) for (const col of audState.selC) { const c = audState.columns?.results?.[n]?.find((x) => x.logicalName === col); if (c && c.auditEnabled !== on) out.push({ env: n, table: audState.table, column: col, on }); }
    }
    return out;
  };
  const bulk = selCount ? h("section", { class: "bulk", "aria-label": "Change selected" },
    h("strong", {}, [audState.selT.size ? `${audState.selT.size} tables` : "", audState.selC.size ? `${audState.selC.size} columns` : ""].filter(Boolean).join(" and ") + " selected"),
    envChecks(audState, names),
    h("div", { class: "row", style: "margin-left:auto" },
      h("button", { type: "button", class: "btn good", disabled: audState.busy, onclick: () => applyAudit(bulkChanges(true)) }, "Turn auditing on"),
      h("button", { type: "button", class: "btn ghost", disabled: audState.busy, onclick: () => applyAudit(bulkChanges(false)) }, "Turn auditing off"),
      h("button", { type: "button", class: "btn ghost", style: "border:0", onclick: () => { audState.selT.clear(); audState.selC.clear(); renderAudit(); } }, "Clear"))) : null;
  const logRows = audState.log && !audState.log.error ? names.flatMap((n) => (audState.log.results[n] || []).map((e) => ({ ...e, env: n }))).sort((a, b) => b.at.localeCompare(a.at)) : [];
  mount(head,
    audState.notice ? notice(audState.notice.kind, audState.notice.text) : null,
    errorsNotice(audState.tables.errors),
    reasonCard(audState, names),
    h("section", { class: "card flush", "aria-label": "System auditing" },
      h("div", { class: "scroll" }, h("table", { class: "envtable" },
        h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "System"), envHeads(names))),
        h("tbody", {},
          h("tr", {}, h("th", { scope: "row" }, "Auditing", h("div", { class: "small muted" }, "Master switch: nothing is audited while it's off")), names.map((n) => cell(sys[n] && { auditEnabled: sys[n].auditEnabled }, () => changeSystem(n, "auditEnabled", !sys[n].auditEnabled), `Auditing in ${n}`))),
          h("tr", {}, h("th", { scope: "row" }, "User sign-in logging"), names.map((n) => cell(sys[n] && { auditEnabled: sys[n].userAccessAudit }, () => changeSystem(n, "userAccessAudit", !sys[n].userAccessAudit), `User sign-in logging in ${n}`))),
          h("tr", {}, h("th", { scope: "row" }, "Logs kept"), names.map((n) => h("td", { class: "envcol small" }, !sys[n] || sys[n].retentionDays === undefined ? "?" : sys[n].retentionDays < 0 ? "Forever" : `${sys[n].retentionDays} days`))))))),
    bulk,
    h("div", { class: "row between" },
      h("div", { class: "row" }, h("label", { class: "search" }, search), seg([["all", "All tables"], ["off", "Off somewhere"], ["diff", "Differs"], ["custom", "Custom"]], audState.only, (v) => { audState.only = v; renderAudit(); }, "Filter tables")),
      h("span", { class: "small muted" }, `${tables.length} tables`)),
    h("section", { class: "card flush", "aria-label": "Tables" },
      h("div", { class: "scroll", style: "max-height:520px;overflow:auto" }, h("table", { class: "envtable" },
        h("thead", {}, h("tr", {}, h("th", { scope: "col", style: "width:44px" }, ""), h("th", { scope: "col" }, "Table"), envHeads(names, (n) => `${(audState.tables.results[n] || []).filter((t) => t.auditEnabled).length} audited`))),
        h("tbody", {}, tables.slice(0, 400).map((t) => {
          const box = h("input", { type: "checkbox", "aria-label": `Select ${t.displayName}` });
          box.checked = audState.selT.has(t.logicalName);
          box.addEventListener("change", () => { box.checked ? audState.selT.add(t.logicalName) : audState.selT.delete(t.logicalName); renderAudit(); });
          return h("tr", { class: audState.table === t.logicalName ? "sel" : "" },
            h("td", {}, box),
            h("th", { scope: "row" }, h("button", { type: "button", class: "btn link", style: "padding:0;font-weight:600", onclick: () => loadAuditTable(t.logicalName) }, t.displayName), h("div", { class: "mono muted" }, t.logicalName)),
            names.map((n) => cell(t.cells[n], () => applyAudit([{ env: n, table: t.logicalName, on: !t.cells[n].auditEnabled }]), `Auditing for ${t.displayName} in ${n}`)));
        }))))),
    audState.table ? h("div", { class: "cols" },
      h("section", { class: "card flush", style: "flex:3 1 520px", "aria-label": "Columns" },
        h("div", { class: "row between", style: "padding:14px 16px 8px" }, h("h2", {}, `Columns in ${tObj?.displayName || audState.table}`), h("span", { class: "small muted" }, "Click a column name to see its history")),
        !audState.columns ? h("div", { class: "empty" }, "Loading…") : audState.columns.error ? h("div", { style: "padding:16px" }, notice("bad", audState.columns.error)) :
        h("div", { class: "scroll", style: "max-height:560px;overflow:auto" }, h("table", { class: "envtable" },
          h("thead", {}, h("tr", {}, h("th", { scope: "col", style: "width:44px" }, ""), h("th", { scope: "col" }, "Column"), envHeads(names))),
          h("tbody", {}, cols.map((c) => {
            const box = h("input", { type: "checkbox", "aria-label": `Select ${c.displayName}` });
            box.checked = audState.selC.has(c.logicalName);
            box.addEventListener("change", () => { box.checked ? audState.selC.add(c.logicalName) : audState.selC.delete(c.logicalName); renderAudit(); });
            return h("tr", { class: audState.column === c.logicalName ? "sel" : "" },
              h("td", {}, box),
              h("th", { scope: "row" }, h("button", { type: "button", class: "btn link", style: "padding:0;font-weight:600", onclick: () => { audState.column = audState.column === c.logicalName ? null : c.logicalName; loadAuditLog(); } }, c.displayName), h("div", { class: "mono muted" }, `${c.logicalName} · ${c.type}`)),
              names.map((n) => cell(c.cells[n], () => applyAudit([{ env: n, table: audState.table, column: c.logicalName, on: !c.cells[n].auditEnabled }]), `Auditing for ${c.displayName} in ${n}`)));
          }))))),
      h("section", { class: "card stack", style: "flex:2 1 400px", "aria-label": "Audit history" },
        h("div", { class: "row between" }, h("h2", {}, `Changes · ${audState.column ? `${audState.table}.${audState.column}` : audState.table}`),
          seg([["24h", "24h"], ["7d", "7 days"], ["30d", "30 days"]], audState.since, (v) => { audState.since = v; loadAuditLog(); }, "Time range")),
        !audState.log ? loading("audit history") : audState.log.error ? notice("bad", audState.log.error) :
        logRows.length === 0 ? h("p", { class: "muted" }, "No audited changes in this period.") :
        h("ol", { class: "list" }, logRows.slice(0, 200).map((e) => h("li", { style: "display:grid;grid-template-columns:70px 110px minmax(0,1fr);gap:12px;padding:10px 0" },
          chip(e.env), h("div", { class: "small muted" }, fmtDate(e.at)),
          h("div", { class: "stack", style: "gap:4px" },
            h("div", { class: "row small" }, h("span", { class: "pill info" }, e.action || e.operation), h("strong", {}, e.record), h("span", { class: "muted" }, `by ${e.user}`)),
            e.changes.slice(0, 8).map((c) => h("div", { class: "row mono" }, h("span", { class: "muted" }, c.column), h("span", { class: "pill bad", style: "text-decoration:line-through" }, c.old || "∅"), h("span", { "aria-hidden": "true" }, "→"), h("span", { class: "pill ok" }, c.new || "∅")))))))))
    : h("p", { class: "muted" }, "Click a table name to see its columns and change history."));
}

// ------------------------------------------------------------------ security

const secState = { tab: "users", users: null, roles: null, error: null, q: "", onlyDiff: false, role: "", noRoles: false, privRole: null, priv: null, privDiff: true };
async function security() {
  secState.error = null;
  renderSecurity();
  try {
    const [users, roles] = await Promise.all([api("/api/security/users/all"), api("/api/security/roles/all")]);
    secState.users = users; secState.roles = roles;
  } catch (err) { secState.error = err.message; }
  renderSecurity();
}
/** Opens the privilege comparison for one role in a flyout beside the role list. */
async function loadPrivileges(role) {
  secState.privRole = role; secState.priv = null;
  renderSecurity();
  const names = secState.roles.environments.filter((n) => secState.roles.results[n]);
  const fly = openFlyout({ title: role, subtitle: "Privileges by environment", onClose: () => { secState.privRole = null; renderSecurity(); } });
  const draw = () => {
    const p = secState.priv;
    fly.tools(checkbox("Only differences", secState.privDiff, (v) => { secState.privDiff = v; draw(); }),
      h("span", { class: "small muted" }, "Access level the role grants for each privilege."));
    if (!p) return fly.set(loading("privileges from every environment"));
    if (p.error) return fly.set(notice("bad", p.error));
    const pn = p.environments.filter((n) => p.results[n] !== undefined);
    const m = new Map();
    for (const n of pn) for (const x of p.results[n] || []) { if (!m.has(x.name)) m.set(x.name, {}); m.get(x.name)[n] = x.depth; }
    const all = [...m.entries()].map(([name, cells]) => ({ name, cells, differs: new Set(pn.map((n) => cells[n] || "-")).size > 1 }));
    const rows = all.filter((r) => !secState.privDiff || r.differs).sort((a, b) => a.name.localeCompare(b.name));
    const missing = names.filter((n) => p.results[n] === null);
    fly.set(
      h("div", { class: "small muted" }, `${all.length} privileges · ${all.filter((r) => r.differs).length} differ between environments`),
      missing.length ? notice("warn", `This role doesn't exist in ${missing.join(", ")}.`) : null,
      rows.length === 0 ? notice("ok", secState.privDiff ? "This role grants the same privileges at the same level everywhere." : "No privileges.") :
      h("div", { class: "scroll card flush" }, h("table", { class: "envtable" },
        h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Privilege"), envHeads(names))),
        h("tbody", {}, rows.map((r) => h("tr", {}, h("th", { scope: "row", class: "mono" }, r.name),
          names.map((n) => h("td", { class: `envcol small${r.differs ? " differs" : ""}` }, p.results[n] === null ? h("span", { class: "muted" }, "role missing") : r.cells[n] || h("span", { class: "muted" }, "none")))))))));
  };
  draw();
  try { secState.priv = await api(`/api/security/privileges?role=${encodeURIComponent(role)}`); } catch (err) { secState.priv = { error: err.message }; }
  if (fly.isOpen() && secState.privRole === role) draw();
}
function renderSecurity() {
  const head = header("Governance", "Security", "Who has which roles in every environment, and how roles differ between environments.");
  if (secState.error) return mount(head, notice("bad", secState.error));
  if (!secState.users || !secState.roles) return mount(head, loading("users and roles from every environment"));
  const names = secState.users.environments.filter((n) => secState.users.results[n]);
  const tabs = seg([["users", "Users"], ["roles", "Roles"]], secState.tab, (v) => { secState.tab = v; renderSecurity(); }, "View", "tablist");
  if (secState.tab === "roles") return renderRoles(head, tabs, names);
  const q = secState.q.trim().toLowerCase();
  const key = (u) => (u ? [...u.roles].sort().join("|") : "-");
  let rows = toMatrix(secState.users.results, names, (u) => u.login, (u) => ({ name: u.name, login: u.login })).sort((a, b) => a.name.localeCompare(b.name));
  rows = rows.filter((r) => (!q || `${r.name} ${r.login}`.toLowerCase().includes(q)) &&
    (!secState.onlyDiff || new Set(names.map((n) => key(r.cells[n]))).size > 1) &&
    (!secState.role || names.some((n) => r.cells[n]?.roles.includes(secState.role))) &&
    (!secState.noRoles || names.some((n) => r.cells[n] && r.cells[n].roles.length === 0 && r.cells[n].teamRoles.length === 0)));
  const allRoles = [...new Set(names.flatMap((n) => secState.users.results[n].flatMap((u) => u.roles)))].sort();
  const roleSel = h("select", { class: "input", "aria-label": "Role" }, h("option", { value: "" }, "Any role"), allRoles.map((r) => h("option", { value: r, selected: r === secState.role }, r)));
  roleSel.addEventListener("change", () => { secState.role = roleSel.value; renderSecurity(); });
  const search = h("input", { type: "search", placeholder: "Search people", value: secState.q, "aria-label": "Search people" });
  search.addEventListener("input", () => { secState.q = search.value; const pos = search.selectionStart; renderSecurity(); const el = main().querySelector("input[type=search]"); el.focus(); el.setSelectionRange(pos, pos); });
  mount(head, tabs, errorsNotice(secState.users.errors),
    h("div", { class: "row" }, h("label", { class: "search" }, search), roleSel,
      checkbox("Only where roles differ", secState.onlyDiff, (v) => { secState.onlyDiff = v; renderSecurity(); }),
      checkbox("Users with no roles", secState.noRoles, (v) => { secState.noRoles = v; renderSecurity(); })),
    h("section", { class: "card flush", "aria-label": "Users and roles" },
      h("div", { class: "small muted", style: "padding:12px 20px" }, `${rows.length} people · enabled users only · roles from teams shown in italics`),
      rows.length === 0 ? h("div", { class: "empty" }, "Nobody matches.") :
      h("div", { class: "scroll" }, h("table", { class: "envtable" },
        h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Person"), envHeads(names, (n) => `${secState.users.results[n].length} users`))),
        h("tbody", {}, rows.slice(0, 500).map((r) => {
          const differs = new Set(names.map((n) => key(r.cells[n]))).size > 1;
          return h("tr", {}, h("th", { scope: "row" }, r.name, h("div", { class: "small muted" }, r.login)),
            names.map((n) => {
              const u = r.cells[n];
              if (!u) return h("td", { class: "envcol muted" }, "—");
              return h("td", { class: `envcol${differs ? " differs" : ""}` },
                u.roles.length || u.teamRoles.length ? h("div", { class: "roles" }, u.roles.map((x) => h("span", { class: "pill info" }, x)), u.teamRoles.filter((x) => !u.roles.includes(x)).map((x) => h("span", { class: "pill", style: "font-style:italic" }, x))) : h("span", { class: "pill warn" }, "No roles"));
            }));
        }))))),
    h("p", { class: "small muted", style: "margin:0" }, "— means the person has no user record in that environment. Highlighted rows have different roles between environments."));
}
function renderRoles(head, tabs, names) {
  const rows = toMatrix(secState.roles.results, names, (r) => r.name, (r) => ({ name: r.name, managed: r.managed })).sort((a, b) => a.name.localeCompare(b.name));
  mount(head, tabs, errorsNotice(secState.roles.errors),
    h("section", { class: "card flush", "aria-label": "Roles" },
      h("div", { class: "scroll" }, h("table", { class: "envtable" },
        h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Role"), envHeads(names), h("th", { scope: "col" }, ""))),
        h("tbody", {}, rows.map((r) => h("tr", { class: secState.privRole === r.name ? "sel" : "" },
          h("th", { scope: "row" }, r.name, r.managed ? h("span", { class: "pill", style: "margin-left:8px" }, "Managed") : null),
          names.map((n) => h("td", { class: "envcol" }, r.cells[n] ? `${r.cells[n].users} user${r.cells[n].users === 1 ? "" : "s"}` : h("span", { class: "pill warn" }, "Missing"))),
          h("td", { style: "text-align:right" }, h("button", { type: "button", class: "btn sm", "aria-haspopup": "dialog", onclick: () => loadPrivileges(r.name) }, "Compare privileges")))))))));
}

// ------------------------------------------------------------------ connections & environment variables

const cfgState = { data: null, error: null, reason: "", notice: null, editing: null, value: "", onlyProblems: false, q: "" };
async function configPage() {
  cfgState.error = null; cfgState.editing = null;
  renderConfig();
  try { cfgState.data = await api("/api/config/all"); } catch (err) { cfgState.error = err.message; }
  renderConfig();
}
async function saveVar(env, schemaName) {
  if (missingReason(cfgState, [env])) { renderConfig(); return; }
  try {
    await api("/api/config/envvar", { env, schemaName, value: cfgState.value, reason: cfgState.reason });
    cfgState.notice = { kind: "ok", text: `${schemaName} saved in ${env}.` };
    cfgState.editing = null;
    cfgState.data = await api("/api/config/all");
  } catch (err) { cfgState.notice = { kind: "bad", text: err.message }; }
  renderConfig();
}
function renderConfig() {
  const head = header("Solutions", "Connections & variables", "Environment variable values and connection references in every environment. These are the usual reason a flow won't switch on after a deployment.");
  if (cfgState.error) return mount(head, notice("bad", cfgState.error));
  const d = cfgState.data;
  if (!d) return mount(head, loading("variables and connections from every environment"));
  const names = d.environments.filter((n) => d.results[n]);
  const q = cfgState.q.trim().toLowerCase();
  const vars = toMatrix(Object.fromEntries(names.map((n) => [n, d.results[n].vars])), names, (v) => v.schemaName, (v) => ({ schemaName: v.schemaName, displayName: v.displayName, type: v.type, secret: v.secret }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .filter((v) => (!q || `${v.displayName} ${v.schemaName}`.toLowerCase().includes(q)) && (!cfgState.onlyProblems || names.some((n) => !v.cells[n] || v.cells[n].missing)));
  const refs = toMatrix(Object.fromEntries(names.map((n) => [n, d.results[n].refs])), names, (r) => r.logicalName, (r) => ({ logicalName: r.logicalName, displayName: r.displayName, connector: r.connector }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .filter((r) => (!q || `${r.displayName} ${r.logicalName} ${r.connector}`.toLowerCase().includes(q)) && (!cfgState.onlyProblems || names.some((n) => !r.cells[n] || !r.cells[n].connected)));
  const search = h("input", { type: "search", placeholder: "Search variables and connections", value: cfgState.q, "aria-label": "Search" });
  search.addEventListener("input", () => { cfgState.q = search.value; const pos = search.selectionStart; renderConfig(); const el = main().querySelector("input[type=search]"); el.focus(); el.setSelectionRange(pos, pos); });
  const varCell = (v, n) => {
    const c = v.cells[n];
    if (!c) return h("td", { class: "envcol" }, h("span", { class: "pill warn" }, "Not here"));
    if (c.secret) return h("td", { class: "envcol muted small" }, "Secret (Key Vault)");
    const id = `${n}:${v.schemaName}`;
    if (cfgState.editing === id) {
      const input = h("input", { class: "input", value: cfgState.value, "aria-label": `New value for ${v.schemaName} in ${n}`, style: "min-width:200px" });
      input.addEventListener("input", () => { cfgState.value = input.value; });
      setTimeout(() => input.focus());
      return h("td", { class: "envcol" }, h("div", { class: "row", style: "justify-content:center" }, input,
        h("button", { type: "button", class: "btn sm primary", onclick: () => saveVar(n, v.schemaName) }, "Save"),
        h("button", { type: "button", class: "btn sm", onclick: () => { cfgState.editing = null; renderConfig(); } }, "Cancel")));
    }
    const differs = new Set(names.map((x) => v.cells[x]?.effective ?? "∅")).size > 1;
    return h("td", { class: `envcol${differs ? " differs" : ""}` },
      c.missing ? h("span", { class: "pill bad" }, "No value") : [h("span", { class: "cellval", title: c.effective }, c.effective), c.currentValue ? null : h("span", { class: "tag" }, "default")],
      h("button", { type: "button", class: "btn link sm", "aria-label": `Edit ${v.schemaName} in ${n}`, onclick: () => { cfgState.editing = id; cfgState.value = c.currentValue ?? c.effective ?? ""; renderConfig(); } }, "Edit"));
  };
  mount(head,
    cfgState.notice ? notice(cfgState.notice.kind, cfgState.notice.text) : null,
    errorsNotice(d.errors),
    h("div", { class: "row" }, h("label", { class: "search" }, search), checkbox("Only problems", cfgState.onlyProblems, (v) => { cfgState.onlyProblems = v; renderConfig(); })),
    reasonCard(cfgState, names),
    h("section", { class: "card flush", "aria-label": "Environment variables" },
      h("h2", { style: "padding:16px 20px 8px" }, `Environment variables (${vars.length})`),
      vars.length === 0 ? h("div", { class: "empty" }, "None.") :
      h("div", { class: "scroll" }, h("table", { class: "envtable" },
        h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Variable"), envHeads(names, (n) => { const m = d.results[n].vars.filter((x) => x.missing).length; return m ? `${m} without a value` : "all set"; }))),
        h("tbody", {}, vars.map((v) => h("tr", {}, h("th", { scope: "row" }, v.displayName, h("div", { class: "mono muted" }, `${v.schemaName} · ${v.type}`)), names.map((n) => varCell(v, n)))))))),
    h("section", { class: "card flush", "aria-label": "Connection references" },
      h("h2", { style: "padding:16px 20px 8px" }, `Connection references (${refs.length})`),
      refs.length === 0 ? h("div", { class: "empty" }, "None.") :
      h("div", { class: "scroll" }, h("table", { class: "envtable" },
        h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Connection reference"), h("th", { scope: "col" }, "Connector"), envHeads(names, (n) => { const m = d.results[n].refs.filter((x) => !x.connected).length; return m ? `${m} not connected` : "all connected"; }))),
        h("tbody", {}, refs.map((r) => h("tr", {}, h("th", { scope: "row" }, r.displayName, h("div", { class: "mono muted" }, r.logicalName)), h("td", { class: "small muted" }, r.connector),
          names.map((n) => h("td", { class: "envcol" }, !r.cells[n] ? h("span", { class: "pill warn" }, "Not here") : r.cells[n].connected ? h("span", { class: "pill ok" }, "Connected") : h("span", { class: "pill bad" }, "Not connected"))))))))),
    h("p", { class: "small muted", style: "margin:0" }, "Connections are set up per environment in the maker portal (Solutions › Connection references). Secret variables live in Azure Key Vault and are never shown."));
}

// ------------------------------------------------------------------ user settings (several environments at once)

const usState = { options: null, target: { region: "en-GB", dateformatstring: "", timeformatstring: "", timezonecode: "", uilanguageid: "", paginglimit: "" }, scope: "all", scopeName: "", overwrite: false, newUsers: false, preview: null, reason: "", notice: null, busy: false, targets: null };
async function usersettings() {
  usState.preview = null;
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
const usScope = () => (usState.scope === "all" ? { kind: "all" } : { kind: usState.scope, name: usState.scopeName });
const usTargets = () => [...(usState.targets ?? new Set(envNames()))].filter((n) => envOf(n));
async function usPreview() {
  usState.busy = true; renderUserSettings();
  const out = {};
  await Promise.all(usTargets().map(async (n) => {
    try { out[n] = await api("/api/usersettings/preview", { env: n, target: usTarget(), scope: usScope(), overwrite: usState.overwrite }); } catch (err) { out[n] = { error: err.message }; }
  }));
  usState.preview = out; usState.notice = null; usState.busy = false; renderUserSettings();
}
async function usApply() {
  const names = usTargets();
  if (missingReason(usState, names)) { renderUserSettings(); return; }
  const counts = usState.preview ? names.map((n) => `${n}: ${usState.preview[n]?.toChange ?? "?"} users`).join(" · ") : "";
  if (!(await confirmDialog({ title: "Apply user settings?", message: `Settings change for users in ${names.join(", ")}${usState.newUsers ? ", and become the defaults for new users" : ""}.`, details: counts ? h("p", { class: "small muted", style: "margin:0" }, counts) : null, confirmText: "Apply settings" }))) return;
  usState.busy = true; renderUserSettings();
  const msgs = []; let failed = 0;
  for (const n of names) {
    try {
      const r = await api("/api/usersettings/apply", { env: n, target: usTarget(), scope: usScope(), overwrite: usState.overwrite, setOrgDefaults: usState.newUsers, reason: usState.reason });
      msgs.push(`${n}: ${r.changed} users${r.orgDefaultsUpdated ? " + new-user defaults" : ""}${r.failed.length ? `, ${r.failed.length} failed` : ""}`);
      failed += r.failed.length;
    } catch (err) { msgs.push(`${n}: ${err.message}`); failed++; }
  }
  usState.notice = { kind: failed ? "bad" : "ok", text: msgs.join(" · ") };
  usState.preview = null; usState.busy = false; renderUserSettings();
}
/** Formats the sample date/time and numbers the way Dataverse will. */
function sampleFormat(t) {
  const d = { yyyy: "2026", MM: "10", M: "10", dd: "30", d: "30" };
  const date = (t.dateformatstring || "dd/MM/yyyy").replace(/yyyy|MM|M|dd|d/g, (m) => d[m]);
  const time = (t.timeformatstring || "HH:mm").replace(/HH|H|hh|h|mm|tt/g, (m) => ({ HH: "14", H: "14", hh: "02", h: "2", mm: "05", tt: "PM" })[m]);
  const dec = t.decimalsymbol ?? ".", grp = t.numberseparator ?? ",";
  const num = `1${grp}234${grp}567${dec}89`;
  const sym = { 2057: "£", 1033: "$", 6153: "€", 1031: "€", 1036: "€" }[t.localeid] || "¤";
  const cur = (n) => [`${sym}${n}`, `${n}${sym}`, `${sym} ${n}`, `${n} ${sym}`][t.currencyformatcode ?? 0];
  const negN = `50${dec}00`;
  const neg = [`(${negN})`, `-${negN}`, `- ${negN}`, `${negN}-`, `${negN} -`][t.negativeformatcode ?? 1];
  return { date, time, num, money: cur(num), neg };
}
function renderUserSettings() {
  const o = usState.options;
  const t = usState.target;
  const head = header("People", "Global user settings", "Set one standard for regional formats, time zone, language and page size, and apply it to users in several environments at once.");
  if (!o) return mount(head, usState.notice ? notice(usState.notice.kind, usState.notice.text) : loading("options"));
  const sel = (labelText, k, options) => {
    const el = h("select", { class: "input" }, options.map(([v, text]) => h("option", { value: v, selected: String(t[k]) === String(v) }, text)));
    el.addEventListener("change", () => { t[k] = el.value; usState.preview = null; renderUserSettings(); });
    return h("label", { class: "field" }, h("span", {}, labelText), el);
  };
  const keep = ["", "Don't change"];
  const target = usTarget();
  const pv = sampleFormat(target);
  const scopeSel = h("select", { class: "input" }, [["all", "All enabled users"], ["role", "Users with a security role"], ["team", "Members of a team"], ["businessunit", "Users in a business unit"]].map(([v, text]) => h("option", { value: v, selected: usState.scope === v }, text)));
  scopeSel.addEventListener("change", () => { usState.scope = scopeSel.value; usState.preview = null; renderUserSettings(); });
  const scopeName = h("input", { class: "input", type: "text", value: usState.scopeName, placeholder: usState.scope === "role" ? "e.g. Salesperson" : usState.scope === "team" ? "e.g. Service Desk" : "e.g. UK" });
  scopeName.addEventListener("change", () => { usState.scopeName = scopeName.value; usState.preview = null; });
  const names = usTargets();
  const p = usState.preview;
  const metric = (label, f) => h("tr", {}, h("th", { scope: "row" }, label), names.map((n) => h("td", { class: "envcol" }, !p?.[n] ? "—" : p[n].error ? h("span", { class: "pill bad", title: p[n].error }, "Error") : f(p[n]))));
  mount(head,
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
          envChecks(usState, envNames()),
          h("div", { style: "display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px" },
            h("label", { class: "field" }, h("span", {}, "Users"), scopeSel),
            usState.scope !== "all" ? h("label", { class: "field" }, h("span", {}, "Name"), scopeName) : null),
          checkbox("Also overwrite settings users changed themselves", usState.overwrite, (v) => { usState.overwrite = v; usState.preview = null; renderUserSettings(); }),
          checkbox("Make these the defaults for new users (organisation format settings)", usState.newUsers, (v) => { usState.newUsers = v; renderUserSettings(); }),
          h("p", { class: "small muted", style: "margin:0" }, "Without the first box, only users still on the organisation's defaults are changed. Interface language must be installed in each environment."))),
      h("div", { class: "stack", style: "flex:2 1 340px" },
        h("section", { class: "card stack", "aria-label": "Preview" },
          h("h2", {}, "How it will look"),
          h("dl", { style: "margin:0;display:grid;grid-template-columns:120px minmax(0,1fr);gap:8px 12px;font-size:13px" },
            h("dt", { class: "muted" }, "Date and time"), h("dd", { class: "mono", style: "margin:0" }, `${pv.date} ${pv.time}`),
            h("dt", { class: "muted" }, "Number"), h("dd", { class: "mono", style: "margin:0" }, pv.num),
            h("dt", { class: "muted" }, "Currency"), h("dd", { class: "mono", style: "margin:0" }, pv.money),
            h("dt", { class: "muted" }, "Negative"), h("dd", { class: "mono", style: "margin:0" }, pv.neg),
            h("dt", { class: "muted" }, "Records per page"), h("dd", { class: "mono", style: "margin:0" }, target.paginglimit ?? "unchanged"))),
        reasonCard(usState, names))),
    h("section", { class: "card flush", "aria-label": "Who will change" },
      h("div", { class: "row between", style: "padding:14px 20px" }, h("h2", {}, "Who will change"),
        h("div", { class: "row" },
          h("button", { type: "button", class: "btn", disabled: usState.busy || !names.length, onclick: usPreview }, usState.busy && !p ? "Checking…" : "Preview"),
          h("button", { type: "button", class: "btn primary", disabled: usState.busy || !p, onclick: usApply }, usState.busy && p ? "Applying…" : `Apply in ${names.length} environment${names.length === 1 ? "" : "s"}`))),
      h("div", { class: "scroll" }, h("table", { class: "envtable" },
        h("thead", {}, h("tr", {}, h("th", { scope: "col" }, ""), envHeads(names))),
        h("tbody", {},
          metric("Users in scope", (x) => fmtNum(x.inScope)),
          metric("Will change", (x) => h("strong", {}, fmtNum(x.toChange))),
          metric("Already match", (x) => fmtNum(x.alreadyMatching)),
          metric("Kept (own settings)", (x) => fmtNum(x.skippedPersonalised))))),
      !p ? h("p", { class: "small muted", style: "margin:0;padding:0 20px 14px" }, "Press Preview to count users in each environment. Changing other users' settings needs the System Administrator role.") : null));
}

// ------------------------------------------------------------------ CLI (terminal + command reference)

const CLI_COMMANDS = [
  { group: "Sign-in and environments", items: [
    ["auth status", "Check sign-in against every environment", "auth status"],
    ["env list", "Health, version, solutions, flows and plugin steps per environment", "env list"],
    ["env discover", "Every environment your account can reach", "env discover"],
    ["env add <URL>", "Add an environment by URL; its name is looked up", "env add https://contoso-uat.crm4.dynamics.com"],
    ["env remove <NAME>", "Remove an environment from the console", "env remove UAT"],
    ["config path", "Which config file is in use", "config path"],
    ["config set tenant <id-or-domain>", "Sign in to a specific tenant", "config set tenant contoso.onmicrosoft.com"]
  ] },
  { group: "Solutions", items: [
    ["solution list", "Installed solutions and versions in every environment", "solution list --diff-only"],
    ["solution list --publisher <P>", "Only one publisher's solutions", "solution list --publisher fp"],
    ["solution diff <UniqueName> --from <ENV> --to <ENV>", "Component-by-component compare", "solution diff CoreCase --from UAT --to PROD"],
    ["vars list", "Environment variable values in every environment", "vars list"],
    ["vars set --env <ENV> <schema> <value> --reason <TEXT>", "Set a variable's value", "vars set --env UAT fp_Region UK --reason \"go-live config\""],
    ["connections list", "Connection references and whether they're connected", "connections list"]
  ] },
  { group: "Flows, business rules and plugins", items: [
    ["flows list", "Every cloud flow, one column per environment", "flows list"],
    ["rules list / plugins list", "Business rules or plugin steps the same way", "plugins list --off"],
    ["flows list --env <ENV> --include-system", "One environment, including Microsoft and system items", "flows list --env DEV --include-system"],
    ["flows on|off --env <ENV> <name>… --reason <TEXT>", "Switch named items on or off", "flows off --env UAT \"SAP order sync\" --reason \"SAP outage\""],
    ["flows off --env <ENV> --filter <TEXT> --dry-run", "Preview a bulk change without making it", "flows off --env UAT --filter SAP --dry-run"]
  ] },
  { group: "Monitoring", items: [
    ["runs list --env <ENV> [--since 7d] [--failed]", "Flow runs and plugin errors", "runs list --env PROD --since 7d --failed"],
    ["runs trace --env <ENV> [--set exceptions --reason <TEXT>]", "Read or change plugin trace logging", "runs trace --env PROD"],
    ["jobs list [--since 7d]", "Failed, suspended or stuck background jobs", "jobs list --since 7d"],
    ["alerts list", "Current problems across every environment", "alerts list"],
    ["alerts run --post", "Post new alerts to Teams", "alerts run --post"],
    ["report [--days 7] [--format html|csv|json]", "Save a health and drift report", "report --days 7 --format html"]
  ] },
  { group: "Governance", items: [
    ["audit status --env <ENV>", "System auditing settings", "audit status --env PROD"],
    ["audit tables --env <ENV> [--off]", "Tables and whether they're audited", "audit tables --env PROD --off"],
    ["audit log --env <ENV> --table <T> [--column <C>]", "Who changed what", "audit log --env PROD --table account --since 7d"],
    ["audit set on|off --env <ENV> --table <T> [--column <C>]", "Turn auditing on or off", "audit set on --env PROD --table account --column creditlimit --reason \"finance request\""],
    ["security users [--diff-only]", "Users and roles in every environment", "security users --diff-only"],
    ["security roles", "Which roles exist where", "security roles"],
    ["usersettings show --env <ENV>", "Users' format, time zone and language settings", "usersettings show --env UAT"],
    ["usersettings apply --env <ENV> --region en-GB --dry-run", "Preview applying settings to users", "usersettings apply --env UAT --region en-GB --dry-run"]
  ] }
];

const cliState = { entries: [], history: [], pos: -1, draft: "", busy: false };

/** Splits a command line into arguments, honouring "double" and 'single' quotes. */
function splitArgs(line) {
  const out = [];
  let cur = "", quote = null, any = false;
  for (const ch of line) {
    if (quote) { if (ch === quote) quote = null; else cur += ch; continue; }
    if (ch === '"' || ch === "'") { quote = ch; any = true; continue; }
    if (/\s/.test(ch)) { if (cur || any) out.push(cur); cur = ""; any = false; continue; }
    cur += ch;
  }
  if (cur || any) out.push(cur);
  return out;
}

async function runCli(line) {
  let args = splitArgs(line.trim());
  if (args[0] === "pcx") args = args.slice(1);
  if (!args.length) return;
  cliState.history.unshift(line.trim());
  cliState.pos = -1;
  const entry = { cmd: `pcx ${line.trim().replace(/^pcx\s+/, "")}`, output: "", code: null };
  cliState.entries.push(entry);
  cliState.busy = true;
  renderCli();
  try { const r = await api("/api/cli/run", { args }); entry.output = r.output; entry.code = r.code; }
  catch (err) { entry.output = err.message; entry.code = 1; }
  cliState.busy = false;
  renderCli();
}

function cli() { renderCli(); }
function renderCli() {
  const local = config.mode !== "hosted" && config.canManage;
  const input = h("input", { type: "text", class: "term-input", "aria-label": "pcx command", placeholder: local ? "Type a command, e.g. env list, then press Enter" : "", autocomplete: "off", spellcheck: "false", value: cliState.draft, disabled: !local || cliState.busy });
  input.addEventListener("input", () => { cliState.draft = input.value; });
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") { ev.preventDefault(); const line = input.value; cliState.draft = ""; runCli(line); }
    else if (ev.key === "ArrowUp" && cliState.history.length) { ev.preventDefault(); cliState.pos = Math.min(cliState.pos + 1, cliState.history.length - 1); input.value = cliState.draft = cliState.history[cliState.pos]; }
    else if (ev.key === "ArrowDown") { ev.preventDefault(); cliState.pos = Math.max(cliState.pos - 1, -1); input.value = cliState.draft = cliState.pos < 0 ? "" : cliState.history[cliState.pos]; }
  });
  const screen = h("div", { class: "term-screen", role: "log", "aria-live": "polite", "aria-label": "Terminal output" },
    cliState.entries.length === 0 ? h("div", { class: "term-dim" }, local ? "Run any pcx command here. Pick one from the list on the right to start. ↑ and ↓ go through earlier commands." : "The terminal runs on your own machine only. Install pcx and use these commands in PowerShell.") : null,
    cliState.entries.map((e) => h("div", { class: "term-entry" },
      h("div", { class: "term-cmd" }, h("span", { class: "term-prompt" }, "› "), e.cmd),
      e.code === null ? h("div", { class: "term-dim row" }, h("span", { class: "spinner", "aria-hidden": "true" }), "Running…") : h("pre", { class: e.code === 0 ? "term-out" : "term-out term-err" }, e.output || "(no output)"))));
  mount(
    header("Tools", "CLI", local ? "Run pcx commands here, or copy them for PowerShell and pipelines. Commands that change things still need --reason outside DEV." : "Every pcx command, for PowerShell and pipelines."),
    h("div", { class: "cols" },
      h("section", { class: "term", style: "flex:3 1 560px", "aria-label": "Terminal" },
        h("div", { class: "term-bar" }, h("span", {}, "pcx"), h("button", { type: "button", class: "btn sm ghost", onclick: () => { cliState.entries = []; renderCli(); } }, "Clear")),
        screen,
        h("label", { class: "term-line" }, h("span", { class: "term-prompt", "aria-hidden": "true" }, "pcx ›"), input)),
      h("section", { class: "card stack", style: "flex:2 1 380px;max-height:calc(100vh - 160px);overflow:auto", "aria-label": "Command reference" },
        h("h2", {}, "Commands"),
        h("p", { class: "small muted", style: "margin:0" }, `Use the short names with --env: ${config.environments.map((e) => e.label ? `${e.name} (${e.label})` : e.name).join(", ") || "add environments first"}.`),
        CLI_COMMANDS.map((g) => h("div", { class: "stack", style: "gap:6px" },
          h("h3", { class: "eyebrow", style: "margin:8px 0 0" }, g.group),
          g.items.map(([cmd, desc, example]) => h("div", { class: "cmd-ref" },
            h("code", { class: "cmd-syntax" }, `pcx ${cmd}`),
            h("div", { class: "small muted" }, desc),
            h("button", { type: "button", class: "cmd-example", title: local ? "Put this in the terminal" : "Copy", onclick: async () => {
              if (local) { cliState.draft = example; renderCli(); const el = main().querySelector(".term-input"); el.focus(); el.setSelectionRange(example.length, example.length); }
              else { try { await navigator.clipboard.writeText(`pcx ${example}`); } catch { /* ignore */ } }
            } }, `pcx ${example}`))))))));
  const scr = main().querySelector(".term-screen");
  scr.scrollTop = scr.scrollHeight;
  if (local && !cliState.busy) main().querySelector(".term-input").focus();
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

const ROUTES = { overview, alerts, solutions, compare, config: configPage, components, runs, jobs, audit, security, usersettings, activity, cli };
async function route() {
  hideTip();
  if (!config) {
    try { config = await api("/api/config"); }
    catch (err) {
      if (err instanceof NeedsLogin) return key() ? mount(header(null, "Env Console"), notice("bad", err.message)) : needKeyScreen();
      return mount(header(null, "Env Console"), notice("bad", err.message));
    }
    if (config.mode === "hosted") document.getElementById("who").replaceChildren(h("div", {}, config.name || config.user), h("div", {}, config.user), h("a", { href: "/auth/logout" }, "Sign out"));
    if (config.environments.length) refreshAlertBadge();
  }
  const [path, query] = (location.hash.replace(/^#\/?/, "") || "overview").split("?");
  const name = ROUTES[path] ? path : "overview";
  document.querySelectorAll(".side a").forEach((a) => {
    a.classList.toggle("active", a.dataset.route === name);
    a.dataset.route === name ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current");
  });
  if (config.environments.length === 0) return config.canManage ? mount(header("Overview", "Environments", "Add your first environment to get started."), accountBar(), manageEnvironments()) : noEnvScreen();
  await ROUTES[name](new URLSearchParams(query || ""));
}
window.addEventListener("hashchange", route);
route();
