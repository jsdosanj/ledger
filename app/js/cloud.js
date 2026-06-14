/* ============================================================
   Ledger — OPT-IN cloud tier (Cloud / Pro).

   Loaded as a SEPARATE ES module from app/index.html. It is the ONLY code in
   Ledger that talks to the network. If it fails to load (offline, CSP, not
   deployed) the app stays 100% local-first — app.js never depends on it; it
   only LOOKS for window.LedgerCloud when opening the Cloud panel.

   Auth + cloud data go through the shared, vendored Keystone SDK
   (./keystone-client.js). The SDK hotloads Clerk only when the user explicitly
   clicks "Sign in". Until then: no network, no Clerk, no third-party script.

   WHAT SYNCS: the KB itself — it's just markdown, and Ledger stores NO secrets
   anywhere (credential pages are vault links only), so cloud sync carries no
   secret material by construction. Evidence emission publishes only STRUCTURAL
   signals ("doc exists / reviewed-on / counts") — never page bodies.
   ============================================================ */
import { createKeystoneClient } from "./keystone-client.js";

const CFG = {
  publishableKey: "pk_live_Y2xlcmsuZG9zYW5qaGxhYnMuY29tJA",
  apiBase: "https://api.dosanjhlabs.com",
};
const PRO_FEATURES = [
  ["cloud_sync", "Shared org vault", "One company vault, synced across the team — still plain markdown, no secrets stored. The shared layer Obsidian lacks."],
  ["pr_review", "Roles, approval & audit", "Per-space roles & permissions, review/approval governance, and an append-only audit trail. SSO via your DosanjhLabs account."],
  ["msp", "Published portals & multi-client", "Read-only published portals for auditors/non-editors, and hard per-client isolation for MSPs."],
];
const SYNC_KEY = "kb-state";

let ks = null, me = null, entCache = {};
const B = () => window.LedgerBridge;

function client() { if (!ks) ks = createKeystoneClient(CFG); return ks; }

async function signIn() { await client().ensureSignedIn(); me = await client().whoami(); entCache = {}; rerenderTab(); refreshApp(); }
async function signOut() {
  try { const c = await client().loadClerk(); if (c && typeof c.signOut === "function") await c.signOut(); } catch (_) {}
  me = null; entCache = {}; rerenderTab(); refreshApp();
}
// Re-render the app shell so the first-class "Sign in"/account button reflects state.
function refreshApp() { try { B().rerender(); } catch (_) {} }
// Auth state for the app's first-class account button (synchronous, no network).
function status() {
  const email = me && me.user ? (me.user.email || me.user.primaryEmail || me.user.id) : null;
  return { signedIn: !!me, email: email };
}
async function checkEntitled(feature) {
  if (feature in entCache) return entCache[feature];
  let ok = false; try { ok = await client().entitled("ledger", feature); } catch (_) { ok = false; }
  entCache[feature] = ok; return ok;
}

/** Push the markdown KB to the per-tenant Keystone store. */
async function syncUp() {
  if (!(await checkEntitled("cloud_sync"))) { B().toast("Cloud sync is a Pro feature"); return; }
  await client().store.put("ledger", SYNC_KEY, B().kbState());
  B().toast("KB synced to cloud");
}
/** Pull the KB and merge it into local state. */
async function syncDown() {
  if (!(await checkEntitled("cloud_sync"))) { B().toast("Cloud sync is a Pro feature"); return; }
  const kb = await client().store.get("ledger", SYNC_KEY);
  if (!kb) { B().toast("Nothing in the cloud yet — sync up first"); return; }
  const n = B().applyKbState(kb);
  B().toast("Pulled " + n + " page(s) from cloud");
}
/** Emit "doc reviewed / exists" signals into the shared evidence graph. */
async function publishEvidence() {
  const out = await client().evidence.publish(B().evidencePayload());
  B().toast("Published documentation evidence (" + (out && out.id ? out.id : "ok") + ")");
}

// --- panel rendering --------------------------------------------------------
let mountEl = null;
function rerenderTab() { if (mountEl) render(mountEl); }
function row(parent, kids) { const r = document.createElement("div"); r.className = "row"; r.style.cssText = "gap:.5rem;flex-wrap:wrap;margin:.5rem 0"; kids.forEach((k) => r.appendChild(k)); parent.appendChild(r); return r; }
function btn(label, cls, fn) { const b = document.createElement("button"); b.className = "btn " + (cls || ""); b.textContent = label; b.onclick = () => { Promise.resolve().then(fn).catch((e) => B().toast(String((e && e.message) || e))); }; return b; }
function note(parent, cls, html) { const d = document.createElement("div"); d.className = cls; d.innerHTML = html; parent.appendChild(d); return d; }

function render(el) {
  mountEl = el; el.innerHTML = "";
  note(el, "callout",
    "<p><strong>Local-first stays the default.</strong> Everything in Ledger works offline with no account — import a vault, " +
    "govern docs, publish a read-only portal, all locally. Signing in adds the <strong>enterprise layer Obsidian lacks</strong>: " +
    "a shared org vault, SSO, org-wide roles &amp; permissions, review/approval + audit, and evidence emission. " +
    "<strong>Ledger stores no passwords or secrets</strong> — credential pages are vault links, so even the cloud sync " +
    "carries no secret material.</p>");

  if (!me) {
    const p = document.createElement("p"); p.className = "muted";
    p.textContent = "Sign in with your DosanjhLabs account (one login across the suite) for the shared org vault, org-wide roles & permissions, approval + audit, published portals, and evidence emission.";
    el.appendChild(p);
    row(el, [btn("Sign in with Clerk", "primary", signIn)]);
    return;
  }

  const who = document.createElement("p"); who.className = "muted";
  const email = (me.user && (me.user.email || me.user.primaryEmail || me.user.id)) || "signed in";
  const tenant = (me.tenant && (me.tenant.name || me.tenant.id)) || "your org";
  who.innerHTML = "Signed in as <strong>" + esc(email) + "</strong> · tenant <strong>" + esc(tenant) + "</strong>";
  el.appendChild(who);
  row(el, [btn("Sign out", "ghost", signOut)]);

  const gates = document.createElement("div"); gates.style.cssText = "margin:1rem 0"; el.appendChild(gates);
  PRO_FEATURES.forEach((f) => {
    const card = document.createElement("div"); card.className = "integr";
    card.innerHTML = '<div style="flex:1"><h3 style="margin:.1rem 0 .3rem">' + esc(f[1]) +
      ' <span class="badge" data-ent="' + f[0] + '">checking…</span></h3>' +
      '<p class="muted" style="margin:0">' + esc(f[2]) + "</p></div>";
    gates.appendChild(card);
    checkEntitled(f[0]).then((ok) => {
      const badge = card.querySelector('[data-ent="' + f[0] + '"]');
      if (!badge) return;
      badge.textContent = ok ? "Pro · unlocked" : "Locked";
      badge.className = "badge " + (ok ? "good" : "ox");
      if (f[0] === "cloud_sync") {
        const r = document.createElement("div"); r.className = "row"; r.style.cssText = "gap:.5rem;margin-top:.5rem";
        if (ok) { r.appendChild(btn("⬆ Sync KB up", "sm primary", syncUp)); r.appendChild(btn("⬇ Pull from cloud", "sm", syncDown)); }
        else { const u = document.createElement("a"); u.className = "btn sm"; u.href = "https://dosanjhlabs.com/ledger/pricing.html"; u.target = "_blank"; u.textContent = "Upgrade to unlock"; r.appendChild(u); }
        card.querySelector("div").appendChild(r);
      }
    });
  });

  note(el, "callout",
    "<p><strong>Evidence emission.</strong> Publish structural signals — which docs exist, their type, and " +
    "<code>reviewed_on</code> dates — as a canonical evidence object so Sightline can map \"documented asset inventory " +
    "exists &amp; reviewed in last 90 days\" to controls. Page bodies are never sent.</p>");
  row(el, [btn("Publish documentation evidence", "primary", publishEvidence)]);
}

function esc(s) { return String(s == null ? "" : s).replace(/[&<>"'`]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" }[c])); }

window.LedgerCloud = { render, status, signIn, syncUp, syncDown };
