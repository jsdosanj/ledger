/* Ledger Obsidian plugin verifier. Run: node verify.js
   Static checks only (the plugin runs inside Obsidian, not Node):
   - manifest.json parses + has the required fields.
   - main.js parses (node --check) and exports a Plugin subclass.
   - all six commands are registered.
   - bearer auth + Obsidian requestUrl are used (no raw fetch / CORS).
   - the evidence payload is structural-only (no note bodies) + secret-free.
   - the org-sync store key matches the web app (kb-state) for interop.
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
var ver = JSON.parse(fs.readFileSync(path.join(DIR, "versions.json"), "utf8"));
ok(!!ver[man.version], "versions.json maps " + man.version + " -> " + ver[man.version]);

console.log("\nmain.js:");
var checkOut = cp.spawnSync(process.execPath, ["--check", path.join(DIR, "main.js")], { encoding: "utf8" });
ok(checkOut.status === 0, "main.js parses (node --check)" + (checkOut.status ? " — " + checkOut.stderr : ""));
var src = fs.readFileSync(path.join(DIR, "main.js"), "utf8");
ok(/module\.exports\s*=\s*class\s+\w+\s+extends\s+Plugin/.test(src), "exports a Plugin subclass");

console.log("\nCommands:");
["ledger-verify", "ledger-sync-up", "ledger-sync-down", "ledger-mark-reviewed", "ledger-governance", "ledger-evidence"]
  .forEach(function (id) { ok(src.indexOf('"' + id + '"') >= 0, "command " + id + " registered"); });

console.log("\nSecurity & interop:");
ok(/requestUrl/.test(src) && !/\bfetch\s*\(/.test(src), "uses Obsidian requestUrl (no raw fetch / no CORS)");
ok(/Authorization["']?\s*:\s*["']Bearer/.test(src), "sends Authorization: Bearer <token>");
ok(/SYNC_KEY\s*=\s*"kb-state"/.test(src), "org-sync key is 'kb-state' (interoperates with the web app)");
ok(/secrets:\s*"none-stored"/.test(src), "evidence declares secrets:none-stored");
// the evidence refs builder must NOT include note bodies
var evIdx = src.indexOf("type: \"it_documentation\"");
var refsIdx = src.indexOf("const refs =");
ok(refsIdx >= 0 && /kind:\s*"doc"[\s\S]{0,200}reviewed_on/.test(src.slice(refsIdx, refsIdx + 400)) && !/body:/.test(src.slice(refsIdx, evIdx > 0 ? evIdx : refsIdx + 400)), "evidence refs are structural-only (no note bodies sent)");
ok(!/console\.\w+\([^)]*token/i.test(src), "access token is never logged");
// syncDown writes files from the shared (team-writable) kb-state — it must reject
// path-traversal keys before vault.create so a "../" key can't escape the vault.
ok(/function\s+safeVaultPath/.test(src), "syncDown has a path-traversal guard (safeVaultPath)");
var sdIdx = src.indexOf("async syncDown");
ok(sdIdx >= 0 && /safeVaultPath\(path\)/.test(src.slice(sdIdx, src.indexOf("async ", sdIdx + 5))), "syncDown calls safeVaultPath before writing each pulled note");

console.log("");
if (fails.length) { console.error("FAIL — " + fails.length + " issue(s):"); fails.forEach(function (f) { console.error("  - " + f); }); process.exit(1); }
console.log("OK — Ledger Obsidian plugin verified (structure, commands, security, web-app interop).");
