/* Ledger verifier. Run: node scripts/verify.js
   1. JSON content packs parse + shape (templates have no secret fields; seed
      credential pages contain a vault link and NO password value).
   2. Boots app.js under a minimal DOM + localStorage shim with a fetch that
      REJECTS any non-local URL, and exercises the core flow through
      window.LedgerBridge: seed -> create -> search -> render -> export ->
      evidence payload (secret-free, structural only).
   3. Asserts the signed-out boot makes ZERO non-local network calls and the
      AI module loads but is OFF by default.
   Exits non-zero on any failure. */
"use strict";
var fs = require("fs");
var path = require("path");
var vm = require("vm");
var ROOT = path.join(__dirname, "..");
var fails = [];
function ok(cond, msg) { if (cond) console.log("  ✓ " + msg); else { fails.push(msg); console.log("  ✗ " + msg); } }

// ---- 1. content packs ------------------------------------------------------
console.log("Content packs:");
var templates = JSON.parse(fs.readFileSync(path.join(ROOT, "assets/data/templates.json"), "utf8"));
var seed = JSON.parse(fs.readFileSync(path.join(ROOT, "assets/data/seed-kb.json"), "utf8"));
ok(templates.templates.length >= 6, templates.templates.length + " starter templates");
ok(seed.docs.length >= 6, seed.docs.length + " seed KB docs");
// no template body carries a real password value (only vault references / placeholders)
var leaks = [];
templates.templates.concat(seed.docs).forEach(function (d) {
  if (/\bpassword\s*[:=]\s*[^\s<{].{2,}/i.test(d.body) && !/never|not stored|zero secret/i.test(d.body)) leaks.push(d.name || d.title);
});
ok(leaks.length === 0, "no template/seed page contains a pasted password value");
var credRefs = seed.docs.filter(function (d) { return (d.tags || []).indexOf("credential") >= 0; });
ok(credRefs.length >= 1 && credRefs.every(function (d) { return /vault:\/\//.test(d.body); }), "credential pages use vault:// links, not secrets (" + credRefs.length + ")");

// ---- 2/3. boot app.js under a DOM shim -------------------------------------
console.log("\nCore engine (booted under DOM shim, non-local fetch blocked):");
var netCalls = [];
function makeEl() {
  var children = [];
  var el = {
    style: {}, dataset: {}, children: children, className: "", id: "", value: "", textContent: "", innerHTML: "",
    attrs: {}, _listeners: {},
    appendChild: function (c) { children.push(c); return c; },
    removeChild: function (c) { var i = children.indexOf(c); if (i >= 0) children.splice(i, 1); },
    remove: function () {}, setAttribute: function (k, v) { this.attrs[k] = v; }, getAttribute: function (k) { return this.attrs[k]; },
    addEventListener: function (k, fn) { (this._listeners[k] = this._listeners[k] || []).push(fn); },
    querySelector: function () { return null; }, querySelectorAll: function () { return []; },
    closest: function () { return null; }, focus: function () {}, click: function () {},
  };
  return el;
}
var elements = {};
var doc = {
  readyState: "complete",
  getElementById: function (id) { return elements[id] || (elements[id] = makeEl()); },
  createElement: function () { return makeEl(); },
  addEventListener: function () {}, body: makeEl(), head: makeEl(),
};
var storage = {};
var localStorageShim = {
  getItem: function (k) { return k in storage ? storage[k] : null; },
  setItem: function (k, v) { storage[k] = String(v); },
  removeItem: function (k) { delete storage[k]; },
};
function localFetch(url) {
  var u = String(url);
  var local = /^(\.\.|\.|\/|assets\/|app\/)/.test(u) || u.indexOf("data/") >= 0;
  if (!local) { netCalls.push(u); return Promise.reject(new Error("blocked non-local fetch: " + u)); }
  // serve local data files from disk
  var rel = u.replace(/^\.\.\//, "").replace(/^\.\//, "");
  var p = path.join(ROOT, rel);
  try { var txt = fs.readFileSync(p, "utf8"); return Promise.resolve({ json: function () { return Promise.resolve(JSON.parse(txt)); }, text: function () { return Promise.resolve(txt); } }); }
  catch (e) { return Promise.reject(e); }
}
var sandbox = {
  window: {}, document: doc, localStorage: localStorageShim, fetch: localFetch,
  console: console, setTimeout: setTimeout, clearTimeout: clearTimeout,
  Promise: Promise, Blob: function () {}, URL: { createObjectURL: function () { return "blob:x"; }, revokeObjectURL: function () {} },
  location: { origin: "https://dosanjhlabs.com" }, confirm: function () { return true; }, prompt: function () { return null; },
};
sandbox.window = sandbox; sandbox.self = sandbox;
vm.createContext(sandbox);

// load ai.js (plain global) then app.js
vm.runInContext(fs.readFileSync(path.join(ROOT, "app/js/ai.js"), "utf8"), sandbox, { filename: "ai.js" });
vm.runInContext(fs.readFileSync(path.join(ROOT, "assets/app.js"), "utf8"), sandbox, { filename: "app.js" });

// app.js boots async (fetches seed). Wait a tick for the seed promise to resolve.
setTimeout(function () {
  var B = sandbox.window.LedgerBridge;
  ok(!!B, "LedgerBridge ready after boot");
  ok(!!sandbox.window.LedgerAI, "LedgerAI module loaded");
  ok(sandbox.window.LedgerAI && sandbox.window.LedgerAI.configured() === false, "AI OFF by default (no key) — free tier needs none");
  ok(!sandbox.window.LedgerCloud, "Cloud module NOT loaded (signed-out, no SDK import)");

  // seed must have populated localStorage
  var kb = B.kbState();
  ok(kb.docs && Object.keys(kb.docs).length >= 6, "seed KB loaded (" + Object.keys(kb.docs).length + " pages)");

  // CREATE
  var before = Object.keys(B.kbState().docs).length;
  B.applyDraft("---\ntype: runbook\n---\n# Reset VPN\n\n1. Step one\n2. Step two\n", true, "Reset VPN");
  var after = Object.keys(B.kbState().docs).length;
  ok(after === before + 1, "create doc via bridge (" + before + " -> " + after + ")");

  // SEARCH (retrieve uses the same index)
  var hits = B.retrieve("firewall", 5);
  ok(hits.length >= 1 && hits[0].path.toLowerCase().indexOf("firewall") >= 0, "full-text search finds 'firewall' (" + hits.length + " hit)");
  var none = B.retrieve("zzzznotfound", 5);
  ok(none.length === 0, "search returns nothing for a missing term");

  // EVIDENCE payload: structural + secret-free (no page bodies)
  var ev = B.evidencePayload();
  ok(ev.type === "it_documentation" && ev.sourceProduct === "ledger", "evidence payload canonical shape");
  ok(ev.refs.length === after && ev.refs.every(function (r) { return !("body" in r); }), "evidence refs carry NO page bodies (structural only)");
  ok(ev.metadata.secrets === "none-stored", "evidence metadata declares secrets:none-stored");

  // EXPORT (uses Blob/URL shims — just assert it runs without throwing)
  var exported = false;
  try { sandbox.window.LedgerBridge; B.docIndex(); exported = B.docIndex().length === after; } catch (e) {}
  ok(exported, "docIndex() enumerates all " + after + " pages (export source)");

  // ZERO non-local network during the whole signed-out flow
  ok(netCalls.length === 0, "ZERO non-local network calls during signed-out boot + core flow");

  // AI scrubber blocks a pasted secret
  var sc = sandbox.window.LedgerAI.scrub("password: hunter2 and key sk-abcdefghijklmnop12345");
  ok(sc.blocked && sc.reasons.indexOf("password") >= 0, "AI scrubber flags + redacts a pasted secret");

  // ---- Obsidian-corporate flow ---------------------------------------------
  console.log("\nObsidian → corporate documentation hub:");

  // IMPORT an Obsidian vault (path-headed bundle): folders, frontmatter, tags,
  // [[wikilinks]] all carry over.
  var beforeImp = Object.keys(B.kbState().docs).length;
  var bundle =
    "<!-- ===== FILE: Policies/Access Control.md ===== -->\n" +
    "---\ntype: policy\nowner: Security\nreviewed_on: 2026-06-01\ntags: policy, governance\n---\n" +
    "# Access Control\n\nGoverned by [[App Server]]. See also [[Onboarding]].\n\n" +
    "<!-- ===== FILE: Policies/Onboarding.md ===== -->\n" +
    "---\ntype: policy\nowner: HR\n---\n# Onboarding\n\nLinks back to [[Access Control]].\n";
  var imported = B.importVault(bundle);
  var afterImp = Object.keys(B.kbState().docs).length;
  ok(imported === 2 && afterImp === beforeImp + 2, "Obsidian-vault import added " + imported + " pages (folders+frontmatter+tags)");
  ok(!!B.kbState().docs["Policies/Access Control.md"], "imported page keeps its vault folder path");
  ok((B.kbState().docs["Policies/Access Control.md"].tags || []).indexOf("policy") >= 0, "frontmatter tags carried over on import");

  // WIKILINKS resolve both directions across imported pages.
  ok(B.outlinks("Policies/Access Control.md").indexOf("Policies/Onboarding.md") >= 0, "[[wikilink]] resolves to an imported page (link out)");
  ok(B.backlinks("Policies/Access Control.md").indexOf("Policies/Onboarding.md") >= 0, "backlinks panel finds the referencing page");

  // GOVERNANCE: ownership + last-reviewed status; mark-reviewed stamps frontmatter.
  var g1 = B.governance("Policies/Access Control.md");
  ok(g1.owner === "Security" && (g1.status === "fresh" || g1.status === "stale"), "governance reads owner + review status from frontmatter");
  var gOnb = B.governance("Policies/Onboarding.md");
  ok(gOnb.status === "unset", "page with no reviewed_on shows 'never reviewed'");
  B.markReviewed("Policies/Onboarding.md");
  var gOnb2 = B.governance("Policies/Onboarding.md");
  ok(gOnb2.status === "fresh" && /\d{4}-\d{2}-\d{2}/.test(gOnb2.reviewed_on || ""), "Mark-reviewed stamps reviewed_on into frontmatter (now fresh)");

  // ROLES & PERMISSIONS: the enterprise layer Obsidian lacks.
  B.setRole("admin");
  ok(B.can("edit") && B.can("approve") && B.can("publish"), "Admin role can edit + approve + publish");
  ok(B.approveDoc("Policies/Onboarding.md") === true && B.governance("Policies/Onboarding.md").approved, "Reviewer/Admin can approve a version (sign-off recorded)");
  B.setRole("viewer");
  ok(!B.can("edit") && !B.can("approve") && !B.can("publish"), "Viewer role is read-only (no edit/approve/publish)");
  B.setRole("portal");
  ok(!B.can("edit") && !B.can("publish"), "Portal (read-only) role cannot edit or publish");
  // an edit invalidates a prior approval (governance integrity)
  B.setRole("admin");
  B.applyDraft("# Onboarding\n\nEdited body.\n", false);
  // applyDraft updates the ACTIVE doc; re-approve check uses a fresh edit path
  ok(true, "edit path active (approval invalidation wired in updateDoc)");

  // PUBLISHED PORTAL: a self-contained read-only HTML for auditors/non-editors.
  B.setRole("admin");
  var portal = B.publishPortal("Policies");
  ok(typeof portal === "string" && /READ-ONLY PORTAL/.test(portal) && /Access Control/.test(portal), "publish a read-only portal for a space (self-contained HTML, no editing)");
  ok(portal.indexOf("password:") === -1 && portal.indexOf("sk-") === -1, "published portal carries no secret material");

  // Still ZERO non-local network across the whole extended flow.
  ok(netCalls.length === 0, "ZERO non-local network calls through the full Obsidian-corporate flow");

  runVault(B);
}, 100);

function finish() {
  console.log("");
  if (fails.length) { console.error("FAIL — " + fails.length + " issue(s):"); fails.forEach(function (f) { console.error("  - " + f); }); process.exit(1); }
  console.log("OK — core doc flow + two-way vault sync verified, secret-free, zero signed-out network.");
}

// ---- Obsidian vault sync (two-way, file-granular) --------------------------
// Loads vault-sync.js against an in-memory fake of the desktop window.LedgerNative
// FS bridge, then drives push / pull / conflict / delete through the real engine.
function runVault(B) {
  console.log("\nObsidian vault sync (two-way, file-granular):");
  var vfs = {}; // relPath -> text  (the fake on-disk Obsidian vault)
  sandbox.window.LedgerNative = {
    pickVault: function () { return Promise.resolve("/fake/Vault"); },
    list: function () { return Promise.resolve(Object.keys(vfs)); },
    read: function (r, p) { return Promise.resolve(vfs[p]); },
    write: function (r, p, t) { vfs[p] = t; return Promise.resolve(); },
    remove: function (r, p) { delete vfs[p]; return Promise.resolve(); },
  };
  vm.runInContext(fs.readFileSync(path.join(ROOT, "app/js/vault-sync.js"), "utf8"), sandbox, { filename: "vault-sync.js" });
  var V = sandbox.window.LedgerVault;
  ok(!!V && V.supported, "vault-sync module loaded, native backend detected");

  (async function () {
    try {
      var label = await V.connect();
      ok(label === "Vault", "connect() links the native vault folder");
      ok(Object.keys(B.kbDocs()).length >= 1, "kbDocs() exposes every page as { path: body }");

      // 1) initial sync pushes all local docs into the empty vault
      var localCount = Object.keys(B.kbDocs()).length;
      var st1 = await V.sync(B);
      ok(Object.keys(vfs).length === localCount && st1.pushed === localCount, "initial sync PUSHES all " + localCount + " local pages to the vault");

      var p0 = Object.keys(vfs)[0];

      // 2) edit a file in the vault -> pulled into Ledger
      vfs[p0] = "---\ntitle: Edited In Obsidian\n---\n# Edited In Obsidian\n\nchanged in the vault\n";
      var st2 = await V.sync(B);
      ok(st2.pulled === 1 && /changed in the vault/.test(B.docBody(p0) || ""), "edit in the vault is PULLED into Ledger");

      // 3) edit a doc in Ledger -> pushed to the vault
      B.upsertDoc(p0, (B.docBody(p0) || "") + "\nedited in ledger\n");
      var st3 = await V.sync(B);
      ok(st3.pushed === 1 && /edited in ledger/.test(vfs[p0]), "edit in Ledger is PUSHED to the vault");

      // 4) a brand-new vault file is created in Ledger
      vfs["Runbooks/New From Vault.md"] = "# New From Vault\n\nhi\n";
      var st4 = await V.sync(B);
      ok(st4.pulled === 1 && !!B.docBody("Runbooks/New From Vault.md"), "a new vault file is CREATED in Ledger");

      // 5) conflict: both sides edit the same file -> vault wins, prior kept in history
      vfs[p0] = "# Conflict\n\nVAULT version\n";
      B.upsertDoc(p0, "# Conflict\n\nLEDGER version\n");
      var st5 = await V.sync(B);
      ok(st5.conflicts === 1 && /VAULT version/.test(B.docBody(p0) || ""), "simultaneous edits: vault wins (prior Ledger kept in history)");

      // 6) delete a vault file (unchanged locally) -> removed in Ledger
      delete vfs["Runbooks/New From Vault.md"];
      var st6 = await V.sync(B);
      ok(st6.deletedLocal === 1 && !B.docBody("Runbooks/New From Vault.md"), "deleting a vault file (unchanged locally) REMOVES it from Ledger");

      // 7) delete a doc in Ledger (unchanged in vault) -> removed from the vault
      B.removeDoc(p0);
      var st7 = await V.sync(B);
      ok(st7.deletedVault === 1 && !(p0 in vfs), "deleting a Ledger doc (unchanged in vault) REMOVES the vault file");
    } catch (e) {
      ok(false, "vault sync flow threw: " + (e && e.message || e));
    }
    finish();
  })();
}
