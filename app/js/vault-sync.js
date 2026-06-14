/* ============================================================
   Ledger — Obsidian VAULT SYNC (real two-way, file-granular).

   The Obsidian story so far was paste-a-bundle import/export. This module makes
   it a real, governed sync: point Ledger at an actual Obsidian vault FOLDER of
   .md files and keep both sides in step — edit in Obsidian, edit in Ledger,
   converge. It is the on-disk counterpart to the cloud ORG vault (cloud.js):
   Obsidian (your editor) ↔ Ledger (governance) ↔ org cloud (the team).

   TWO BACKENDS, ONE ENGINE:
     • Browser  — the File System Access API (showDirectoryPicker). The vault
       folder handle is persisted in IndexedDB so it reconnects across sessions
       (the browser re-asks permission). Chromium-class browsers only.
     • Desktop  — window.LedgerNative, injected by the Mac/Windows/Linux shell
       (Tauri/Electron). Full native FS, every OS, no permission prompts. The
       expected contract (so a shell can implement it):
            pickVault()            -> absolute folder path (or null)
            list(root)             -> array of vault-relative ".md" paths
            read(root, relPath)    -> file text
            write(root, relPath, t)-> void   (creates parent dirs)
            remove(root, relPath)  -> void

   SYNC SEMANTICS (safe by construction — never loses an unsynced edit):
     A per-file content-hash snapshot from the last sync drives a 3-way decision:
       both sides equal ............... in sync, nothing to do
       only one side changed .......... copy that side to the other
       both sides changed ............. Obsidian (the file) wins; the prior
                                        Ledger version is kept in version history
       new on one side ................ created on the other
       deleted on one side ............ mirrored ONLY if the other side is
                                        unchanged since last sync; an edit on the
                                        surviving side always beats a delete
     Dotfolders (incl. .obsidian, .trash, .git) are skipped. Ledger stores no
     secrets, so the vault carries none by construction.
   ============================================================ */
(function () {
  "use strict";

  var SNAP_KEY = "ledger_vault_snapshot_v1"; // { relPath: contentHash } at last sync
  var META_KEY = "ledger_vault_meta_v1";     // { label, auto }
  var NATIVE_PATH_KEY = "ledger_vault_native_path";
  var IDB_DB = "ledger-vault", IDB_STORE = "handles", IDB_KEY = "root";

  // --- content hash (djb2) — change detection only, not crypto ---------------
  function hash(s) { var h = 5381, i = s.length; while (i) h = (h * 33) ^ s.charCodeAt(--i); return (h >>> 0).toString(16); }

  // Reject path traversal at the FS boundary: a "../" segment, an absolute path,
  // or a backslash could make the native bridge read/write/remove OUTSIDE the
  // vault folder. Only plain in-vault relative paths are allowed to touch disk.
  function safeRel(p) {
    p = String(p == null ? "" : p);
    if (p.charAt(0) === "/" || /\\/.test(p)) return false;
    return p.split("/").every(function (s) { return s !== "" && s !== "." && s !== ".."; });
  }

  // --- localStorage: snapshot + panel meta -----------------------------------
  function snap() { try { return JSON.parse(localStorage.getItem(SNAP_KEY) || "{}"); } catch (e) { return {}; } }
  function setSnap(o) { try { localStorage.setItem(SNAP_KEY, JSON.stringify(o)); } catch (e) {} }
  function meta() { try { return JSON.parse(localStorage.getItem(META_KEY) || "{}"); } catch (e) { return {}; } }
  function setMeta(o) { try { localStorage.setItem(META_KEY, JSON.stringify(o)); } catch (e) {} }

  // --- IndexedDB: persist the directory handle (FSA backend) -----------------
  function idb() { return new Promise(function (res, rej) { var r = indexedDB.open(IDB_DB, 1); r.onupgradeneeded = function () { r.result.createObjectStore(IDB_STORE); }; r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); }
  function idbPut(k, v) { return idb().then(function (db) { return new Promise(function (res, rej) { var t = db.transaction(IDB_STORE, "readwrite"); t.objectStore(IDB_STORE).put(v, k); t.oncomplete = function () { res(); }; t.onerror = function () { rej(t.error); }; }); }); }
  function idbGet(k) { return idb().then(function (db) { return new Promise(function (res, rej) { var t = db.transaction(IDB_STORE, "readonly"); var rq = t.objectStore(IDB_STORE).get(k); rq.onsuccess = function () { res(rq.result); }; rq.onerror = function () { rej(rq.error); }; }); }); }
  function idbDel(k) { return idb().then(function (db) { return new Promise(function (res) { var t = db.transaction(IDB_STORE, "readwrite"); t.objectStore(IDB_STORE).delete(k); t.oncomplete = function () { res(); }; }); }); }

  // --- backend: desktop native (window.LedgerNative) -------------------------
  function nativeBackend() {
    var N = window.LedgerNative;
    if (!N || typeof N.pickVault !== "function") return null;
    var root = null;
    function name(p) { return p ? String(p).replace(/[\\/]+$/, "").split(/[\\/]/).pop() : p; }
    return {
      kind: "native",
      connect: async function () { var p = await N.pickVault(); if (!p) return null; root = p; localStorage.setItem(NATIVE_PATH_KEY, p); return name(p); },
      reconnect: async function () { var p = localStorage.getItem(NATIVE_PATH_KEY); if (!p) return null; root = p; return name(p); },
      ensurePermission: async function () { return !!root; },
      disconnect: async function () { root = null; localStorage.removeItem(NATIVE_PATH_KEY); },
      listPaths: async function () { return (await N.list(root)) || []; },
      read: async function (p) { return await N.read(root, p); },
      write: async function (p, t) { return await N.write(root, p, t); },
      remove: async function (p) { return N.remove ? await N.remove(root, p) : undefined; },
      connected: function () { return !!root; },
    };
  }

  // --- backend: browser File System Access API -------------------------------
  function fsaBackend() {
    if (typeof window.showDirectoryPicker !== "function") return null;
    var root = null;
    async function verify(handle, write) {
      var opts = { mode: write ? "readwrite" : "read" };
      if ((await handle.queryPermission(opts)) === "granted") return true;
      return (await handle.requestPermission(opts)) === "granted";
    }
    async function walk(dir, prefix, out) {
      for await (var entry of dir.values()) {
        if (entry.name.charAt(0) === ".") continue; // skip .obsidian/.trash/.git etc.
        if (entry.kind === "directory") await walk(entry, prefix + entry.name + "/", out);
        else if (/\.md$/i.test(entry.name)) out.push(prefix + entry.name);
      }
    }
    async function fileHandle(path, create) {
      var parts = path.split("/"), dir = root;
      for (var i = 0; i < parts.length - 1; i++) dir = await dir.getDirectoryHandle(parts[i], { create: !!create });
      return dir.getFileHandle(parts[parts.length - 1], { create: !!create });
    }
    return {
      kind: "fsa",
      connect: async function () { var h = await window.showDirectoryPicker(); if (!h) return null; if (!(await verify(h, true))) throw new Error("Permission to the vault folder was denied"); root = h; await idbPut(IDB_KEY, h); return h.name; },
      reconnect: async function () { var h = await idbGet(IDB_KEY); if (!h) return null; root = h; return h.name; },
      ensurePermission: async function () { return root ? verify(root, true) : false; },
      disconnect: async function () { root = null; try { await idbDel(IDB_KEY); } catch (e) {} },
      listPaths: async function () { var out = []; await walk(root, "", out); return out; },
      read: async function (p) { var fh = await fileHandle(p, false); var f = await fh.getFile(); return f.text(); },
      write: async function (p, t) { var fh = await fileHandle(p, true); var w = await fh.createWritable(); await w.write(t); await w.close(); },
      remove: async function (p) { var parts = p.split("/"), dir = root; for (var i = 0; i < parts.length - 1; i++) dir = await dir.getDirectoryHandle(parts[i]); await dir.removeEntry(parts[parts.length - 1]); },
      connected: function () { return !!root; },
    };
  }

  var backend = nativeBackend() || fsaBackend();

  // (Re)connect a vault folder; resets the snapshot so the next sync reconciles
  // from scratch. Returns the folder label (or null if cancelled/unsupported).
  async function connectVault() {
    if (!backend) return null;
    var label = await backend.connect();
    if (!label) return null;
    var mm = meta(); mm.label = label; setMeta(mm);
    setSnap({});
    return label;
  }
  async function disconnectVault() {
    if (backend) await backend.disconnect();
    setMeta({ auto: false }); setSnap({});
  }
  function status() {
    return { supported: !!backend, connected: !!(backend && backend.connected()), kind: backend && backend.kind, label: meta().label || null, auto: !!meta().auto };
  }

  // --- the sync engine -------------------------------------------------------
  async function sync(bridge) {
    if (!backend || !backend.connected()) throw new Error("Connect an Obsidian vault first");
    if (!(await backend.ensurePermission())) throw new Error("Vault permission not granted — reconnect the folder");
    var s = snap();
    var vaultPaths = await backend.listPaths();
    var inVault = {}; vaultPaths.forEach(function (p) { inVault[p] = 1; });
    var local = bridge.kbDocs();
    var union = {};
    vaultPaths.forEach(function (p) { union[p] = 1; });
    Object.keys(local).forEach(function (p) { union[p] = 1; });

    var stats = { pulled: 0, pushed: 0, conflicts: 0, deletedLocal: 0, deletedVault: 0 };
    var next = {};
    var keys = Object.keys(union);
    for (var i = 0; i < keys.length; i++) {
      var p = keys[i];
      if (!safeRel(p)) continue; // never let a traversal path touch the vault FS
      var v = inVault[p] ? await backend.read(p) : null;
      var l = local[p] != null ? local[p] : null;
      var prev = s[p] || null;

      if (v != null && l != null) {
        var vh = hash(v), lh = hash(l);
        if (vh === lh) { next[p] = vh; continue; }                       // already in sync
        var vChanged = prev == null || vh !== prev;
        var lChanged = prev == null || lh !== prev;
        if (vChanged && !lChanged) { bridge.upsertDoc(p, v); next[p] = vh; stats.pulled++; }
        else if (lChanged && !vChanged) { await backend.write(p, l); next[p] = lh; stats.pushed++; }
        else { bridge.upsertDoc(p, v); next[p] = vh; stats.conflicts++; } // both: vault wins, prior kept in history
      } else if (v != null && l == null) {
        if (prev != null && hash(v) === prev) { await backend.remove(p); stats.deletedVault++; } // local delete, vault untouched
        else { bridge.upsertDoc(p, v); next[p] = hash(v); stats.pulled++; }                       // new in vault (or vault edited)
      } else if (v == null && l != null) {
        if (prev != null && hash(l) === prev) { bridge.removeDoc(p); stats.deletedLocal++; }       // vault delete, local untouched
        else { await backend.write(p, l); next[p] = hash(l); stats.pushed++; }                     // new locally (or local edited)
      }
    }
    setSnap(next);
    bridge.rerender();
    return stats;
  }

  function summary(st) {
    var parts = [];
    if (st.pulled) parts.push(st.pulled + " pulled");
    if (st.pushed) parts.push(st.pushed + " pushed");
    if (st.conflicts) parts.push(st.conflicts + " conflict" + (st.conflicts > 1 ? "s" : "") + " (vault won; prior kept in history)");
    if (st.deletedLocal) parts.push(st.deletedLocal + " removed locally");
    if (st.deletedVault) parts.push(st.deletedVault + " removed in vault");
    return parts.length ? parts.join(" · ") : "already in sync";
  }

  // --- auto-sync (interval + on focus) ---------------------------------------
  var timer = null, bridgeRef = null, syncing = false;
  async function autoTick() {
    if (syncing || !backend || !backend.connected() || !meta().auto) return;
    syncing = true;
    try { var st = await sync(bridgeRef); if (st.pulled || st.pushed || st.conflicts || st.deletedLocal || st.deletedVault) bridgeRef.toast("Vault sync — " + summary(st)); }
    catch (e) { /* stay quiet on auto failures; manual surfaces errors */ }
    finally { syncing = false; }
  }
  function startAuto(bridge) {
    bridgeRef = bridge;
    if (timer) return;
    timer = setInterval(autoTick, 30000);
    window.addEventListener("focus", autoTick);
  }

  // --- panel UI --------------------------------------------------------------
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }
  function el(tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }
  function note(parent, cls, html) { var d = el("div", cls); d.innerHTML = html; parent.appendChild(d); return d; }
  function btn(label, cls, fn) { var b = el("button", "btn " + (cls || "")); b.textContent = label; b.onclick = function () { Promise.resolve().then(fn).catch(function (e) { window.LedgerBridge && window.LedgerBridge.toast(String((e && e.message) || e)); }); }; return b; }

  function renderPanel(elRoot, bridge) {
    bridgeRef = bridge;
    elRoot.innerHTML = "";

    if (!backend) {
      note(elRoot, "callout",
        "<p><strong>This browser can't open a folder directly.</strong> Direct two-way vault sync needs the " +
        "File System Access API (Chrome, Edge, Brave, Arc) — or the <strong>Ledger desktop app</strong> for " +
        "Mac, Windows &amp; Linux, which syncs any vault on any OS. On Firefox/Safari, use " +
        "<strong>Import vault</strong> / <strong>Export all</strong> to round-trip your markdown instead.</p>");
      return;
    }

    var m = meta();
    note(elRoot, "callout",
      "<p><strong>Point Ledger at a real Obsidian vault folder.</strong> It syncs two-way at the file level — " +
      "edit in Obsidian, edit here, and they converge. Your <code>.md</code> files, frontmatter, folders and " +
      "<code>[[wikilinks]]</code> stay exactly as Obsidian writes them. <code>.obsidian</code> and other dot-folders " +
      "are skipped, and <strong>no secrets</strong> are ever stored. " + (backend.kind === "native" ? "Running in the desktop app — native, every OS." : "Running in the browser via the File System Access API.") + "</p>");

    var statusBox = el("div"); statusBox.style.cssText = "margin:.6rem 0"; elRoot.appendChild(statusBox);
    var actions = el("div", "row"); actions.style.cssText = "gap:.5rem;flex-wrap:wrap;margin:.4rem 0"; elRoot.appendChild(actions);
    var result = el("div", "muted small"); result.style.marginTop = ".4rem"; elRoot.appendChild(result);

    function paint(label) {
      statusBox.innerHTML = label
        ? 'Connected vault: <strong>' + esc(label) + '</strong> <span class="badge good">linked</span>'
        : '<span class="muted">No vault connected yet.</span>';
      actions.innerHTML = "";
      if (label) {
        actions.appendChild(btn("⇄ Sync now", "sm primary", async function () {
          result.textContent = "Syncing…";
          var st = await sync(bridge);
          result.innerHTML = "Last sync: <strong>" + esc(summary(st)) + "</strong>.";
          bridge.toast("Vault sync — " + summary(st));
        }));
        actions.appendChild(btn("Change folder", "sm", connect));
        actions.appendChild(btn("Disconnect", "sm ghost", async function () {
          await disconnectVault();
          result.textContent = ""; paint(null);
          bridge.toast("Vault disconnected (your files are untouched)");
        }));
        // auto-sync toggle
        var lab = el("label", "muted small"); lab.style.cssText = "display:inline-flex;align-items:center;gap:.35rem;margin-left:.3rem";
        var cb = el("input"); cb.type = "checkbox"; cb.checked = !!meta().auto;
        cb.onchange = function () { var mm = meta(); mm.auto = cb.checked; setMeta(mm); if (cb.checked) { startAuto(bridge); bridge.toast("Auto-sync on (every 30s + on focus)"); } };
        lab.appendChild(cb); lab.appendChild(document.createTextNode("Auto-sync (30s + on focus)"));
        actions.appendChild(lab);
        // optional: push the merged KB to the org cloud, if signed in
        var cs = window.LedgerCloud && window.LedgerCloud.status && window.LedgerCloud.status();
        if (cs && cs.signedIn && window.LedgerCloud.syncUp) {
          actions.appendChild(btn("☁ Push to org cloud", "sm", async function () { await window.LedgerCloud.syncUp(); }));
        }
      } else {
        actions.appendChild(btn("📂 Connect Obsidian vault", "sm primary", connect));
        var cs2 = window.LedgerCloud && window.LedgerCloud.status && window.LedgerCloud.status();
        if (!(cs2 && cs2.signedIn)) note(actions, "muted small", '<span style="margin-left:.4rem">Sign in too for the shared <em>org</em> vault across your team.</span>');
      }
    }
    async function connect() {
      var label = await connectVault();
      if (!label) return;
      paint(label);
      result.textContent = "Connected. Run a first sync to reconcile the vault with Ledger.";
    }

    // try to restore a previous connection (browser re-asks permission lazily)
    paint(null);
    backend.reconnect().then(function (label) { if (label) { paint(label); if (meta().auto) startAuto(bridge); } }).catch(function () {});
  }

  window.LedgerVault = { renderPanel: renderPanel, sync: sync, connect: connectVault, disconnect: disconnectVault, status: status, supported: !!backend };
})();
