/* Ledger Obsidian plugin verifier. Run: node verify.js
   Static checks only (the plugin runs inside Obsidian, not Node):
   - manifest.json parses + has the required fields; versions.json maps the version.
   - main.js parses (node --check) and exports a Plugin subclass.
   - all six governance commands are registered.
   - LOCAL-ONLY guarantee: the plugin makes NO network calls and stores no token —
     no fetch / requestUrl / XMLHttpRequest, no Authorization/Bearer, no http(s) URLs.
   - the governance layer is present: status lifecycle, frontmatter writes, audit log.
   Exits non-zero on any failure. */
"use strict";
var fs = require("fs");
var path = require("path");
var cp = require("child_process");
var DIR = __dirname;
var fails = [];
function ok(cond, msg) { if (cond) console.log("  ✓ " + msg); else { fails.push(msg); console.log("  ✗ " + msg); } }

console.log("Manifest:");
var man = JSON.parse(fs.readFileSync(path.join(DIR, "manifest.json"), "utf8"));
["id", "name", "version", "minAppVersion", "description"].forEach(function (k) { ok(!!man[k], "manifest has " + k + " (" + (man[k] || "") + ")"); });
ok(man.isDesktopOnly === false, "works on desktop + mobile (isDesktopOnly false)");
ok(!/sign[- ]?in to|requires? (an )?account|create an account|paste[\s\S]{0,20}token/i.test(man.description), "manifest description states no account/login requirement");
var ver = JSON.parse(fs.readFileSync(path.join(DIR, "versions.json"), "utf8"));
ok(!!ver[man.version], "versions.json maps " + man.version + " -> " + ver[man.version]);

console.log("\nmain.js:");
var checkOut = cp.spawnSync(process.execPath, ["--check", path.join(DIR, "main.js")], { encoding: "utf8" });
ok(checkOut.status === 0, "main.js parses (node --check)" + (checkOut.status ? " — " + checkOut.stderr : ""));
var src = fs.readFileSync(path.join(DIR, "main.js"), "utf8");
ok(/module\.exports\s*=\s*class\s+\w+\s+extends\s+Plugin/.test(src), "exports a Plugin subclass");

console.log("\nCommands:");
["ledger-new-doc", "ledger-set-status", "ledger-set-owner", "ledger-mark-reviewed", "ledger-governance", "ledger-audit"]
  .forEach(function (id) { ok(src.indexOf('"' + id + '"') >= 0, "command " + id + " registered"); });

console.log("\nLocal-only (no network, no account):");
ok(!/\bfetch\s*\(/.test(src), "no raw fetch()");
ok(!/requestUrl/.test(src), "no Obsidian requestUrl (the plugin never goes to the network)");
ok(!/XMLHttpRequest|WebSocket|navigator\.sendBeacon/.test(src), "no XHR / WebSocket / sendBeacon");
ok(!/Authorization|Bearer|access[_ ]?token|apiBase/i.test(src), "no auth token / API base (no sign-in)");
ok(!/https?:\/\//.test(src), "no http(s) URLs in the plugin (no servers contacted)");

console.log("\nGovernance layer:");
ok(/STATUSES\s*=\s*\[\s*"draft"[\s\S]*"published"\s*\]/.test(src), "status lifecycle draft -> published defined");
ok(/processFrontMatter/.test(src), "governance is written to standard frontmatter (processFrontMatter)");
ok(/AUDIT_PATH\s*=\s*"_ledger\/audit\.md"/.test(src), "in-vault audit log path defined");
ok(/async\s+logAudit\s*\(/.test(src), "logAudit() appends governance actions to the audit log");
ok(/reviewed_on/.test(src) && /\bowner\b/.test(src) && /ungoverned/.test(src), "tracks reviewed_on + owner + flags ungoverned docs");
ok(/getMarkdownFiles\(\)[\s\S]{0,120}_ledger\//.test(src), "the audit log is excluded from the governed-docs scan");

console.log("");
if (fails.length) { console.error("FAIL — " + fails.length + " issue(s):"); fails.forEach(function (f) { console.error("  - " + f); }); process.exit(1); }
console.log("OK — Ledger Obsidian plugin verified (structure, commands, local-only, governance layer).");
