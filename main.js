/* ============================================================
   Ledger — governance for Obsidian (community plugin).

   Turns a personal vault into a governed, company-grade one entirely WITHIN
   Obsidian. 100% local: no account, no login, no tokens, no network, no servers.
   Your notes stay plain markdown; governance lives in standard frontmatter
   (owner, status, reviewed_on, reviewer, review_cadence_days). Free and open
   source (MIT).

   What it gives a team that Obsidian alone doesn't:
     • Governed-document template + a status lifecycle: draft → in-review →
       approved → published.
     • Ownership + reviewer assignment.
     • Review tracking — stamp "reviewed today"; stale detection by cadence.
     • A governance dashboard — status mix, review freshness, and which docs are
       ungoverned (missing an owner or a status).
     • An in-vault audit log (_ledger/audit.md) recording every governance action.

   No build step (Obsidian loads main.js directly). No secrets, no telemetry.
   ============================================================ */
"use strict";

const { Plugin, Notice, PluginSettingTab, Setting, Modal, TFile } = require("obsidian");

// Local governance lifecycle (all in-vault frontmatter — no account needed).
const STATUSES = ["draft", "in-review", "approved", "published"];
const AUDIT_PATH = "_ledger/audit.md";
const DEFAULTS = { reviewStaleDays: 90, requireOwner: true, requireStatus: true };

function todayISO() { return new Date().toISOString().slice(0, 10); }

module.exports = class LedgerPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());

    this.statusEl = this.addStatusBarItem();
    this.refreshStatus();
    this.addRibbonIcon("book-marked", "Ledger — governance dashboard", () => this.governanceReport());

    this.addCommand({ id: "ledger-new-doc", name: "New governed document", callback: () => this.newGovernedDoc() });
    this.addCommand({ id: "ledger-set-status", name: "Set document status", callback: () => this.setDocStatus() });
    this.addCommand({ id: "ledger-set-owner", name: "Set document owner", callback: () => this.setOwner() });
    this.addCommand({ id: "ledger-mark-reviewed", name: "Mark current note reviewed", callback: () => this.markReviewed() });
    this.addCommand({ id: "ledger-governance", name: "Governance dashboard", callback: () => this.governanceReport() });
    this.addCommand({ id: "ledger-audit", name: "Open governance audit log", callback: () => this.openAudit() });

    this.addSettingTab(new LedgerSettingTab(this.app, this));

    // Keep the status bar summary live as frontmatter changes.
    this.registerEvent(this.app.metadataCache.on("changed", () => this.refreshStatus()));
  }

  async saveSettings() { await this.saveData(this.settings); this.refreshStatus(); }
  setStatus(text) { if (this.statusEl) this.statusEl.setText(text); }

  refreshStatus() {
    if (!this.statusEl) return;
    const rows = this.govRows();
    const stale = rows.filter((r) => r.g.status === "stale").length;
    const ungoverned = rows.filter((r) => r.g.ungoverned).length;
    this.setStatus("Ledger: " + rows.length + " docs · " + stale + " stale · " + ungoverned + " ungoverned");
  }

  activeFile() {
    const f = this.app.workspace.getActiveFile();
    if (!f) new Notice("Ledger: open a note first.");
    return f;
  }
  fmOf(file) { return (this.app.metadataCache.getFileCache(file) || {}).frontmatter || {}; }

  async newGovernedDoc() {
    let path = "Governed document.md", i = 1;
    while (this.app.vault.getAbstractFileByPath(path)) path = "Governed document " + (++i) + ".md";
    const scaffold =
      "---\n" +
      "title: \n" +
      "owner: \n" +
      "status: draft\n" +
      "type: page\n" +
      "reviewed_on: \n" +
      "reviewer: \n" +
      "review_cadence_days: " + this.settings.reviewStaleDays + "\n" +
      "---\n\n# \n";
    const f = await this.app.vault.create(path, scaffold);
    await this.app.workspace.getLeaf(false).openFile(f);
    await this.logAudit("created", path, "status draft");
    new Notice("Ledger: created a governed document.");
  }

  setDocStatus() {
    const f = this.activeFile();
    if (!f) return;
    new StatusModal(this.app, async (status) => {
      await this.app.fileManager.processFrontMatter(f, (fm) => { fm.status = status; });
      await this.logAudit("status", f.path, "→ " + status);
      this.refreshStatus();
      new Notice("Ledger: status → " + status);
    }).open();
  }

  setOwner() {
    const f = this.activeFile();
    if (!f) return;
    const current = this.fmOf(f).owner || "";
    new PromptModal(this.app, "Set document owner", "name or email", current, async (owner) => {
      await this.app.fileManager.processFrontMatter(f, (fm) => { fm.owner = owner; });
      await this.logAudit("owner", f.path, "→ " + owner);
      this.refreshStatus();
      new Notice("Ledger: owner → " + owner);
    }).open();
  }

  async markReviewed() {
    const f = this.activeFile();
    if (!f) return;
    await this.app.fileManager.processFrontMatter(f, (fm) => { fm.reviewed_on = todayISO(); });
    await this.logAudit("reviewed", f.path, "reviewed_on " + todayISO());
    this.refreshStatus();
    new Notice("Ledger: stamped reviewed_on " + todayISO());
  }

  // Governance status for one file from its frontmatter — purely local.
  govOf(file) {
    const fm = this.fmOf(file);
    const owner = fm.owner ? String(fm.owner) : null;
    const docStatus = STATUSES.indexOf(String(fm.status)) >= 0 ? String(fm.status) : null;
    const reviewed = fm.reviewed_on ? String(fm.reviewed_on) : null;
    const cadence = Number(fm.review_cadence_days) > 0 ? Number(fm.review_cadence_days) : this.settings.reviewStaleDays;
    let status = "never", days = null;
    if (reviewed) {
      const t = Date.parse(reviewed);
      if (!isNaN(t)) { days = Math.floor((Date.now() - t) / 86400000); status = days <= cadence ? "fresh" : "stale"; }
    }
    const ungoverned = (this.settings.requireOwner && !owner) || (this.settings.requireStatus && !docStatus);
    return { owner, docStatus, reviewed, status, days, ungoverned };
  }

  // All governed markdown files (excludes the plugin's own audit log).
  govRows() {
    return this.app.vault.getMarkdownFiles()
      .filter((f) => !f.path.startsWith("_ledger/"))
      .map((f) => ({ f: f, g: this.govOf(f) }));
  }

  governanceReport() {
    const rows = this.govRows();
    const rank = { never: 0, stale: 1, fresh: 2 };
    rows.sort((a, b) =>
      (Number(b.g.ungoverned) - Number(a.g.ungoverned)) ||
      (rank[a.g.status] - rank[b.g.status]) ||
      ((b.g.days || 0) - (a.g.days || 0)));
    new GovernanceModal(this.app, this, rows).open();
  }

  async openAudit() {
    const f = this.app.vault.getAbstractFileByPath(AUDIT_PATH);
    if (f instanceof TFile) await this.app.workspace.getLeaf(false).openFile(f);
    else new Notice("Ledger: no audit log yet — it's created on the first governance action.");
  }

  async ensureFolder(filePath) {
    const i = filePath.lastIndexOf("/");
    if (i < 0) return;
    const dir = filePath.slice(0, i);
    if (!dir || this.app.vault.getAbstractFileByPath(dir)) return;
    try { await this.app.vault.createFolder(dir); } catch (e) { /* exists / race — fine */ }
  }

  // Append-only in-vault audit trail (plain markdown table). No network.
  async logAudit(action, path, detail) {
    const line = "| " + todayISO() + " | " + action + " | " + path + " | " + (detail || "") + " |\n";
    const existing = this.app.vault.getAbstractFileByPath(AUDIT_PATH);
    if (existing instanceof TFile) {
      await this.app.vault.append(existing, line);
    } else {
      await this.ensureFolder(AUDIT_PATH);
      await this.app.vault.create(
        AUDIT_PATH,
        "# Ledger governance audit log\n\nAppend-only record of governance actions in this vault.\n\n" +
        "| date | action | document | detail |\n| --- | --- | --- | --- |\n" + line,
      );
    }
  }
};

/* --- governance dashboard modal --- */
class GovernanceModal extends Modal {
  constructor(app, plugin, rows) { super(app); this.plugin = plugin; this.rows = rows; }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Governance dashboard" });

    const review = { never: 0, stale: 0, fresh: 0 };
    const lifecycle = { draft: 0, "in-review": 0, approved: 0, published: 0, none: 0 };
    let ungoverned = 0;
    this.rows.forEach((r) => { review[r.g.status]++; lifecycle[r.g.docStatus || "none"]++; if (r.g.ungoverned) ungoverned++; });

    contentEl.createEl("p", { text: this.rows.length + " documents · " + ungoverned + " ungoverned · review: " + review.never + " never / " + review.stale + " stale / " + review.fresh + " fresh" });
    contentEl.createEl("p", { cls: "setting-item-description", text: "lifecycle: " + lifecycle.draft + " draft · " + lifecycle["in-review"] + " in-review · " + lifecycle.approved + " approved · " + lifecycle.published + " published · " + lifecycle.none + " unset" });

    const list = contentEl.createEl("div");
    this.rows.slice(0, 300).forEach((r) => {
      const row = list.createEl("div");
      row.style.cssText = "display:flex;justify-content:space-between;gap:.5rem;padding:.25rem 0;border-bottom:1px solid var(--background-modifier-border);cursor:pointer";
      const left = row.createEl("span", { text: r.f.path });
      const reviewBadge = r.g.status === "fresh" ? "✓ reviewed" : r.g.status === "stale" ? "⚠ " + r.g.days + "d stale" : "✗ never reviewed";
      const right = row.createEl("span", { text: [r.g.docStatus || "no-status", r.g.owner || "no-owner", reviewBadge].join(" · ") });
      if (r.g.ungoverned) { left.style.fontWeight = "600"; right.style.color = "var(--text-error)"; }
      left.style.opacity = r.g.status === "fresh" && !r.g.ungoverned ? "0.7" : "1";
      row.addEventListener("click", () => { this.app.workspace.getLeaf(false).openFile(r.f); this.close(); });
    });
    if (this.rows.length > 300) contentEl.createEl("p", { cls: "mod-warning", text: "(showing first 300 of " + this.rows.length + ")" });
  }
  onClose() { this.contentEl.empty(); }
}

/* --- status picker modal --- */
class StatusModal extends Modal {
  constructor(app, onPick) { super(app); this.onPick = onPick; }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Set document status" });
    const row = contentEl.createEl("div");
    row.style.cssText = "display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.5rem";
    STATUSES.forEach((s) => {
      const b = row.createEl("button", { text: s });
      b.style.textTransform = "capitalize";
      b.addEventListener("click", () => { this.close(); this.onPick(s); });
    });
  }
  onClose() { this.contentEl.empty(); }
}

/* --- single-field prompt modal --- */
class PromptModal extends Modal {
  constructor(app, title, placeholder, value, onSubmit) { super(app); this.title = title; this.placeholder = placeholder; this.value = value; this.onSubmit = onSubmit; }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: this.title });
    const input = contentEl.createEl("input", { type: "text" });
    input.placeholder = this.placeholder; input.value = this.value || "";
    input.style.cssText = "width:100%;margin:.5rem 0";
    const submit = () => { this.close(); this.onSubmit(input.value.trim()); };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
    const b = contentEl.createEl("button", { text: "Save", cls: "mod-cta" });
    b.addEventListener("click", submit);
    setTimeout(() => input.focus(), 0);
  }
  onClose() { this.contentEl.empty(); }
}

/* --- settings tab (all local) --- */
class LedgerSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Ledger — governance for Obsidian" });
    containerEl.createEl("p", { cls: "setting-item-description", text: "Local, free, and open source. No account, no login, no network — governance lives in standard frontmatter (owner, status, reviewed_on) so your notes stay portable markdown." });

    new Setting(containerEl)
      .setName("Review-stale threshold (days)")
      .setDesc("Notes not reviewed within this many days count as stale. A per-note review_cadence_days overrides it.")
      .addText((t) => t.setValue(String(this.plugin.settings.reviewStaleDays)).onChange(async (v) => { const n = parseInt(v, 10); this.plugin.settings.reviewStaleDays = isNaN(n) ? 90 : n; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName("Require an owner")
      .setDesc("Flag documents without an owner as ungoverned in the dashboard.")
      .addToggle((tg) => tg.setValue(this.plugin.settings.requireOwner).onChange(async (v) => { this.plugin.settings.requireOwner = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName("Require a status")
      .setDesc("Flag documents without a lifecycle status as ungoverned in the dashboard.")
      .addToggle((tg) => tg.setValue(this.plugin.settings.requireStatus).onChange(async (v) => { this.plugin.settings.requireStatus = v; await this.plugin.saveSettings(); }));
  }
}
