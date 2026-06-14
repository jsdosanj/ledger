/* ============================================================
   Ledger — enterprise governance for Obsidian (community plugin).

   Obsidian is the cross-platform desktop host; this plugin turns a personal
   vault into a governed, company-grade one WITHOUT leaving Obsidian. You enable
   it, paste a DosanjhLabs access token, and get the enterprise layer Obsidian
   lacks — all against the same Keystone platform the Ledger web app uses:

     • Sign in (a pasted access token; verified via /whoami).
     • Shared ORG vault sync — push the vault to / pull it from your team's cloud
       vault. It interoperates with the Ledger web app (same `kb-state` store key).
     • Doc-review governance — owner + reviewed_on (Obsidian frontmatter), a
       "stamp reviewed today" command, and a governance report of stale notes.
     • Compliance evidence — publish STRUCTURAL signals only (paths, titles,
       type, reviewed_on, counts — never note bodies) into the shared evidence
       graph so Sightline can map "docs exist & reviewed in last 90 days".

   No build step (Obsidian loads main.js directly). No secrets stored in notes —
   credential notes should link a password manager, never paste a secret. The
   only thing kept locally is your access token, in this vault's plugin data.

   AUTH NOTE: this uses a pasted long-lived access token (the standard plugin
   pattern), sent as `Authorization: Bearer <token>` to api.dosanjhlabs.com. That
   requires Keystone to mint personal access tokens for plugin use; the same
   /whoami, /store, /evidence, /billing endpoints back it. Network uses Obsidian's
   requestUrl (no CORS), and the tenant is always derived server-side.
   ============================================================ */
"use strict";

const { Plugin, Notice, PluginSettingTab, Setting, Modal, TFile, requestUrl } = require("obsidian");

const DEFAULTS = {
  apiBase: "https://api.dosanjhlabs.com",
  token: "",
  company: "",
  autoSync: false,
  reviewStaleDays: 90,
};
const SYNC_KEY = "kb-state"; // same store key the Ledger web app uses

function todayISO() { return new Date().toISOString().slice(0, 10); }
function debounce(fn, ms) { let t = null; return function () { const a = arguments, c = this; clearTimeout(t); t = setTimeout(() => fn.apply(c, a), ms); }; }
function normalizeTags(fm) {
  if (!fm || fm.tags == null) return [];
  let t = fm.tags;
  if (Array.isArray(t)) return t.map((x) => String(x).replace(/^#/, "").trim()).filter(Boolean);
  return String(t).replace(/[[\]]/g, "").split(",").map((s) => s.replace(/^#/, "").trim()).filter(Boolean);
}

/* --- Keystone cloud client (pasted-token bearer, via Obsidian requestUrl) --- */
class Cloud {
  constructor(settings) { this.base = String(settings.apiBase || "").replace(/\/+$/, ""); this.token = settings.token || ""; }
  hasToken() { return !!this.token; }
  async req(path, opts) {
    opts = opts || {};
    if (!this.token) { const e = new Error("not signed in"); e.status = 401; throw e; }
    const headers = Object.assign({ Authorization: "Bearer " + this.token }, opts.headers || {});
    if (opts.body !== undefined && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
    const res = await requestUrl({ url: this.base + path, method: opts.method || "GET", headers: headers, body: opts.body, throw: false });
    if (res.status >= 400) {
      let detail = "http_" + res.status;
      try { const j = JSON.parse(res.text || "{}"); if (j && j.error) detail = j.error; } catch (e) {}
      const err = new Error("Ledger cloud: " + res.status + " " + detail); err.status = res.status; throw err;
    }
    if (res.status === 204) return null;
    const txt = res.text || "";
    return txt ? JSON.parse(txt) : null;
  }
  whoami() { return this.req("/whoami"); }
  async storeGet(key) {
    try { const out = await this.req("/store/ledger/" + encodeURIComponent(key)); return out ? out.value : null; }
    catch (e) { if (e && e.status === 404) return null; throw e; }
  }
  storePut(key, value) { return this.req("/store/ledger/" + encodeURIComponent(key), { method: "PUT", body: JSON.stringify(value) }); }
  async entitled(feature) {
    const me = await this.whoami();
    const tenant = me && me.tenant && (me.tenant.id || me.tenant);
    if (!tenant) return false;
    const out = await this.req("/billing/entitled/" + encodeURIComponent(tenant) + "/ledger/" + encodeURIComponent(feature));
    return !!(out && out.entitled);
  }
  publishEvidence(obj) { return this.req("/evidence", { method: "POST", body: JSON.stringify(obj) }); }
}

module.exports = class LedgerPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());
    this.cloud = new Cloud(this.settings);
    this.me = null;

    this.statusEl = this.addStatusBarItem();
    this.setStatus("Ledger: signed out");

    this.addRibbonIcon("book-marked", "Ledger — sync vault to org cloud", () => this.syncUp());

    this.addCommand({ id: "ledger-verify", name: "Sign in (verify access token)", callback: () => this.verify() });
    this.addCommand({ id: "ledger-sync-up", name: "Push vault to org cloud", callback: () => this.syncUp() });
    this.addCommand({ id: "ledger-sync-down", name: "Pull vault from org cloud", callback: () => this.syncDown() });
    this.addCommand({ id: "ledger-mark-reviewed", name: "Mark current note reviewed (stamp reviewed_on)", callback: () => this.markReviewed() });
    this.addCommand({ id: "ledger-governance", name: "Show governance report (stale / unreviewed notes)", callback: () => this.governanceReport() });
    this.addCommand({ id: "ledger-evidence", name: "Publish documentation evidence", callback: () => this.publishEvidence() });

    this.addSettingTab(new LedgerSettingTab(this.app, this));

    // optional auto-sync: debounce a push after edits settle
    this._autoSync = debounce(() => { if (this.settings.autoSync && this.cloud.hasToken()) this.syncUp(true); }, 8000);
    this.registerEvent(this.app.vault.on("modify", () => this._autoSync()));

    // best-effort: reflect signed-in state on load (no token => stays signed out)
    if (this.cloud.hasToken()) this.verify(true);
  }

  setStatus(text) { if (this.statusEl) this.statusEl.setText(text); }
  async saveSettings() { await this.saveData(this.settings); this.cloud = new Cloud(this.settings); }
  needToken() { if (!this.cloud.hasToken()) { new Notice("Ledger: add your access token in Settings → Ledger first."); return true; } return false; }

  async verify(quiet) {
    if (this.needToken()) return;
    try {
      this.me = await this.cloud.whoami();
      const email = this.me && this.me.user && (this.me.user.email || this.me.user.primaryEmail || this.me.user.id) || "signed in";
      const tenant = this.me && this.me.tenant && (this.me.tenant.name || this.me.tenant.id) || "your org";
      this.setStatus("Ledger ✓ " + tenant);
      if (!quiet) new Notice("Ledger: signed in as " + email + " · " + tenant);
    } catch (e) {
      this.me = null; this.setStatus("Ledger: sign-in failed");
      if (!quiet) new Notice("Ledger sign-in failed: " + (e && e.message || e));
    }
  }

  // Build the same KB shape the Ledger web app stores (so they interoperate).
  async buildKb() {
    const files = this.app.vault.getMarkdownFiles();
    const docs = {};
    for (const f of files) {
      const body = await this.app.vault.read(f);
      const cache = this.app.metadataCache.getFileCache(f);
      const fm = (cache && cache.frontmatter) || {};
      const folder = f.parent && f.parent.path && f.parent.path !== "/" ? f.parent.path : "";
      docs[f.path] = { title: fm.title || f.basename, folder: folder, tags: normalizeTags(fm), body: body, history: [] };
    }
    return { company: this.settings.company || this.app.vault.getName(), docs: docs };
  }

  async syncUp(quiet) {
    if (this.needToken()) return;
    try {
      const kb = await this.buildKb();
      await this.cloud.storePut(SYNC_KEY, kb);
      const n = Object.keys(kb.docs).length;
      this.setStatus("Ledger ✓ pushed " + n);
      if (!quiet) new Notice("Ledger: pushed " + n + " note(s) to the org cloud");
    } catch (e) { new Notice("Ledger push failed: " + (e && e.message || e)); }
  }

  async syncDown() {
    if (this.needToken()) return;
    try {
      const kb = await this.cloud.storeGet(SYNC_KEY);
      if (!kb || !kb.docs) { new Notice("Ledger: nothing in the org cloud yet — push first."); return; }
      let written = 0, unchanged = 0;
      for (const path of Object.keys(kb.docs)) {
        const body = kb.docs[path].body || "";
        const existing = this.app.vault.getAbstractFileByPath(path);
        if (existing instanceof TFile) {
          const cur = await this.app.vault.read(existing);
          if (cur !== body) { await this.app.vault.modify(existing, body); written++; } else unchanged++;
        } else {
          await this.ensureFolder(path);
          await this.app.vault.create(path, body); written++;
        }
      }
      new Notice("Ledger: pulled " + written + " note(s) (" + unchanged + " already current). Nothing deleted.");
    } catch (e) { new Notice("Ledger pull failed: " + (e && e.message || e)); }
  }

  async ensureFolder(filePath) {
    const i = filePath.lastIndexOf("/");
    if (i < 0) return;
    const dir = filePath.slice(0, i);
    if (!dir || this.app.vault.getAbstractFileByPath(dir)) return;
    try { await this.app.vault.createFolder(dir); } catch (e) { /* exists / race — fine */ }
  }

  async markReviewed() {
    const f = this.app.workspace.getActiveFile();
    if (!f) { new Notice("Ledger: open a note first."); return; }
    await this.app.fileManager.processFrontMatter(f, (fm) => { fm.reviewed_on = todayISO(); });
    new Notice("Ledger: stamped reviewed_on " + todayISO());
  }

  // Governance status for one file from its frontmatter (owner + reviewed_on).
  govOf(file) {
    const fm = (this.app.metadataCache.getFileCache(file) || {}).frontmatter || {};
    const owner = fm.owner || null;
    const reviewed = fm.reviewed_on || null;
    let status = "never", days = null;
    if (reviewed) {
      const t = Date.parse(reviewed);
      if (!isNaN(t)) { days = Math.floor((Date.now() - t) / 86400000); status = days <= this.settings.reviewStaleDays ? "fresh" : "stale"; }
    }
    return { owner, reviewed, status, days };
  }

  governanceReport() {
    const rows = this.app.vault.getMarkdownFiles().map((f) => ({ f: f, g: this.govOf(f) }));
    const rank = { never: 0, stale: 1, fresh: 2 };
    rows.sort((a, b) => (rank[a.g.status] - rank[b.g.status]) || ((b.g.days || 0) - (a.g.days || 0)));
    new GovernanceModal(this.app, this, rows).open();
  }

  async publishEvidence() {
    if (this.needToken()) return;
    try {
      const refs = this.app.vault.getMarkdownFiles().map((f) => {
        const fm = (this.app.metadataCache.getFileCache(f) || {}).frontmatter || {};
        return { kind: "doc", path: f.path, title: fm.title || f.basename, type: fm.type || "page", tags: normalizeTags(fm), reviewed_on: fm.reviewed_on || null, hostname: fm.hostname || null };
      });
      const payload = {
        schemaVersion: "1.0", type: "it_documentation", sourceProduct: "ledger",
        metadata: { company: this.settings.company || this.app.vault.getName(), page_count: refs.length, secrets: "none-stored" },
        refs: refs,
      };
      const out = await this.cloud.publishEvidence(payload);
      new Notice("Ledger: published documentation evidence (" + (out && out.id ? out.id : "ok") + ")");
    } catch (e) { new Notice("Ledger evidence failed: " + (e && e.message || e)); }
  }
};

/* --- governance report modal --- */
class GovernanceModal extends Modal {
  constructor(app, plugin, rows) { super(app); this.plugin = plugin; this.rows = rows; }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Doc-review governance" });
    const counts = { never: 0, stale: 0, fresh: 0 };
    this.rows.forEach((r) => { counts[r.g.status]++; });
    contentEl.createEl("p", { text: counts.never + " never reviewed · " + counts.stale + " stale (> " + this.plugin.settings.reviewStaleDays + "d) · " + counts.fresh + " fresh" });
    const list = contentEl.createEl("div");
    this.rows.slice(0, 200).forEach((r) => {
      const row = list.createEl("div", { cls: "ledger-gov-row" });
      row.style.cssText = "display:flex;justify-content:space-between;gap:.5rem;padding:.25rem 0;border-bottom:1px solid var(--background-modifier-border);cursor:pointer";
      const left = row.createEl("span", { text: r.f.path });
      const badge = r.g.status === "fresh" ? "✓ reviewed" : r.g.status === "stale" ? "⚠ " + r.g.days + "d stale" : "✗ never reviewed";
      row.createEl("span", { text: (r.g.owner ? r.g.owner + " · " : "") + badge });
      left.style.opacity = r.g.status === "fresh" ? "0.7" : "1";
      row.addEventListener("click", () => { this.app.workspace.getLeaf(false).openFile(r.f); this.close(); });
    });
    if (this.rows.length > 200) contentEl.createEl("p", { text: "(showing first 200 of " + this.rows.length + ")", cls: "mod-warning" });
  }
  onClose() { this.contentEl.empty(); }
}

/* --- settings tab --- */
class LedgerSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Ledger — enterprise governance" });
    containerEl.createEl("p", { text: "Sign in to add a shared org vault, doc-review governance, and compliance evidence on top of this Obsidian vault. Your notes stay plain markdown. No secrets are stored — link a password manager from credential notes instead.", cls: "setting-item-description" });

    new Setting(containerEl)
      .setName("Access token")
      .setDesc("Your DosanjhLabs access token. Kept only in this vault's plugin data; never put it in a note.")
      .addText((t) => { t.setPlaceholder("paste token").setValue(this.plugin.settings.token).onChange(async (v) => { this.plugin.settings.token = v.trim(); await this.plugin.saveSettings(); }); t.inputEl.type = "password"; })
      .addExtraButton((b) => b.setIcon("globe").setTooltip("Get a token at dosanjhlabs.com").onClick(() => window.open("https://dosanjhlabs.com/ledger/account", "_blank")));

    new Setting(containerEl)
      .setName("Verify sign-in")
      .setDesc("Check the token and show your account + org.")
      .addButton((b) => b.setButtonText("Verify").setCta().onClick(() => this.plugin.verify()));

    new Setting(containerEl)
      .setName("API base")
      .setDesc("Keystone API origin.")
      .addText((t) => t.setValue(this.plugin.settings.apiBase).onChange(async (v) => { this.plugin.settings.apiBase = v.trim() || DEFAULTS.apiBase; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName("Organization name")
      .setDesc("Shown on the org vault and evidence (defaults to the vault name).")
      .addText((t) => t.setPlaceholder(this.app.vault.getName()).setValue(this.plugin.settings.company).onChange(async (v) => { this.plugin.settings.company = v.trim(); await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName("Review-stale threshold (days)")
      .setDesc("Notes not reviewed within this many days count as stale.")
      .addText((t) => t.setValue(String(this.plugin.settings.reviewStaleDays)).onChange(async (v) => { const n = parseInt(v, 10); this.plugin.settings.reviewStaleDays = isNaN(n) ? 90 : n; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName("Auto-sync on edit")
      .setDesc("Push the vault to the org cloud a few seconds after you stop editing. Off by default (pushes the whole vault).")
      .addToggle((tg) => tg.setValue(this.plugin.settings.autoSync).onChange(async (v) => { this.plugin.settings.autoSync = v; await this.plugin.saveSettings(); }));
  }
}
