/**
 * keystone-client.js — the shared PRODUCT -> KEYSTONE cloud SDK.
 *
 * A self-contained vanilla ES module that ANY static product (Ward, Charter, and
 * the other 6) imports to talk to the Keystone platform API. It owns the whole
 * client-side spine a product would otherwise re-implement:
 *
 *   - Clerk session auth: hotloads clerk-js from the frontend-API host decoded
 *     from the publishable key (same mechanism the storefront uses), signs the
 *     user in, and mints short-lived bearer tokens via Clerk.session.getToken().
 *   - authedFetch(): every call to api.dosanjhlabs.com carries a fresh bearer.
 *   - whoami(): the verified user + active tenant (derived server-side from the
 *     session — never asserted by the client).
 *   - store.*: the generic per-tenant document store (cloud data for the product).
 *   - evidence.publish(): push a canonical evidence object into the shared graph.
 *   - entitled(): Pro/feature gating off the entitlements mirror.
 *
 * SECURITY NOTE: the client NEVER sends a tenant id. Keystone derives the tenant
 * from the verified Clerk session on every request. There is no header a product
 * could set to act as another tenant.
 *
 * Usage:
 *   import { createKeystoneClient } from "./keystone-client.js";
 *   const ks = createKeystoneClient({
 *     publishableKey: "pk_live_...",
 *     apiBase: "https://api.dosanjhlabs.com",
 *   });
 *   await ks.ensureSignedIn();           // redirects to Clerk sign-in if needed
 *   const me = await ks.whoami();
 *   await ks.store.put("ward", "draft", { answers: {...} });
 *   const data = await ks.store.get("ward", "draft");
 *   if (await ks.entitled("ward", "multi_site")) { /* unlock Pro *\/ }
 */

/**
 * @typedef {Object} KeystoneConfig
 * @property {string} publishableKey  Clerk publishable key (pk_live_/pk_test_).
 * @property {string} apiBase         Keystone API origin, e.g. https://api.dosanjhlabs.com
 * @property {string} [clerkJsVersion] clerk-js major to load (default "5").
 */

/** Decode the Clerk frontend-API host from the publishable key. */
function clerkHost(pk) {
  const m = String(pk || "").match(/^pk_(test|live)_(.+)$/);
  if (!m) return null;
  try {
    return atob(m[2]).replace(/\$+$/, "") || null;
  } catch {
    return null;
  }
}

/**
 * Hotload clerk-js from the frontend-API host encoded in the publishable key and
 * resolve the global Clerk instance. Idempotent: a second call reuses the first
 * load. Mirrors the storefront bootstrap so there is ONE auth mechanism.
 */
function loadClerk(pk, version) {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("keystone-client: loadClerk requires a browser"));
  }
  if (window.Clerk) return Promise.resolve(window.Clerk);
  if (window.__keystoneClerkLoading) return window.__keystoneClerkLoading;

  const host = clerkHost(pk);
  if (!host) {
    return Promise.reject(new Error("keystone-client: invalid publishableKey"));
  }

  window.__keystoneClerkLoading = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.setAttribute("data-clerk-publishable-key", pk);
    s.async = true;
    s.crossOrigin = "anonymous";
    s.src = `https://${host}/npm/@clerk/clerk-js@${version || "5"}/dist/clerk.browser.js`;
    s.addEventListener("load", () => resolve(window.Clerk));
    s.addEventListener("error", () => reject(new Error("keystone-client: clerk-js failed to load")));
    document.head.appendChild(s);
  });
  return window.__keystoneClerkLoading;
}

/**
 * Create a Keystone client bound to a product's config.
 * @param {KeystoneConfig} config
 */
export function createKeystoneClient(config) {
  if (!config || !config.publishableKey || !config.apiBase) {
    throw new Error("keystone-client: { publishableKey, apiBase } are required");
  }
  const apiBase = String(config.apiBase).replace(/\/+$/, "");
  let clerk = null;

  /** Load + initialize clerk-js once; returns the ready Clerk instance. */
  async function clerkReady() {
    if (clerk && clerk.loaded) return clerk;
    clerk = await loadClerk(config.publishableKey, config.clerkJsVersion);
    if (!clerk.loaded) await clerk.load();
    return clerk;
  }

  /**
   * Ensure there is a signed-in user. If none, open Clerk's hosted sign-in
   * (redirect). Resolves with the Clerk user once signed in.
   */
  async function ensureSignedIn() {
    const c = await clerkReady();
    if (c.user) return c.user;
    // Redirect to the hosted sign-in, returning to the current page after.
    if (typeof c.redirectToSignIn === "function") {
      await c.redirectToSignIn({ redirectUrl: window.location.href });
    }
    // The redirect navigates away; this promise effectively never resolves.
    return new Promise(() => {});
  }

  /** Mint a fresh short-lived Clerk session token (bearer). Null if signed out. */
  async function getToken() {
    const c = await clerkReady();
    if (!c.session) return null;
    return c.session.getToken();
  }

  /**
   * fetch() against the Keystone API with a fresh bearer attached. `path` is
   * relative to apiBase (e.g. "/store/ward/draft"). Throws on a non-2xx with the
   * server's error body for easy product-side handling.
   */
  async function authedFetch(path, opts = {}) {
    const token = await getToken();
    if (!token) throw new Error("keystone-client: not signed in");
    const headers = new Headers(opts.headers || {});
    headers.set("Authorization", `Bearer ${token}`);
    if (opts.body !== undefined && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    const res = await fetch(`${apiBase}${path}`, {
      ...opts,
      headers,
      // The API is credentialed/CORS-allowlisted; bearer is the credential.
      credentials: "omit",
    });
    if (!res.ok) {
      let detail;
      try {
        detail = await res.json();
      } catch {
        detail = { error: `http_${res.status}` };
      }
      const err = new Error(`keystone-client: ${res.status} ${detail.error || ""}`.trim());
      err.status = res.status;
      err.detail = detail;
      throw err;
    }
    // 204/empty bodies -> null.
    if (res.status === 204) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  /**
   * The verified caller: { user, tenant }. Both are derived server-side from the
   * Clerk session — the client cannot assert a tenant. Backed by GET /whoami.
   */
  async function whoami() {
    return authedFetch("/whoami");
  }

  /**
   * Pro/feature gating off the entitlements mirror.
   * GET /billing/entitled/:tenant/:product/:feature -> { entitled, value }.
   * Returns a boolean. The tenant is resolved from whoami() (verified session).
   */
  async function entitled(product, feature) {
    const me = await whoami();
    const tenant = me && me.tenant && (me.tenant.id || me.tenant);
    if (!tenant) return false;
    const out = await authedFetch(
      `/billing/entitled/${encodeURIComponent(tenant)}/${encodeURIComponent(product)}/${encodeURIComponent(feature)}`,
    );
    return Boolean(out && out.entitled);
  }

  // --- generic per-tenant document store ------------------------------------
  // The product's cloud data: JSON values keyed by (product, key) in the caller's
  // OWN per-tenant DB. The tenant is never sent; Keystone derives it.
  const store = {
    /** Read one document's value (or null if it doesn't exist). */
    async get(product, key) {
      try {
        const out = await authedFetch(
          `/store/${encodeURIComponent(product)}/${encodeURIComponent(key)}`,
        );
        return out ? out.value : null;
      } catch (e) {
        if (e && e.status === 404) return null;
        throw e;
      }
    },
    /** Upsert a JSON value. */
    async put(product, key, value) {
      return authedFetch(
        `/store/${encodeURIComponent(product)}/${encodeURIComponent(key)}`,
        { method: "PUT", body: JSON.stringify(value) },
      );
    },
    /** Delete a document. */
    async del(product, key) {
      return authedFetch(
        `/store/${encodeURIComponent(product)}/${encodeURIComponent(key)}`,
        { method: "DELETE" },
      );
    },
    /** List the keys (+ updatedAt) stored for a product. */
    async list(product) {
      const out = await authedFetch(`/store/${encodeURIComponent(product)}`);
      return (out && out.keys) || [];
    },
  };

  // --- evidence graph --------------------------------------------------------
  const evidence = {
    /**
     * Publish a canonical evidence object (POST /evidence). `obj` is the
     * PublishInput per MASTER-PLAN §3.2 (type, sourceProduct, refs, metadata,
     * payload, ...). Returns the stored evidence + refs.
     */
    async publish(obj) {
      return authedFetch("/evidence", { method: "POST", body: JSON.stringify(obj) });
    },
  };

  return {
    loadClerk: () => clerkReady(),
    ensureSignedIn,
    getToken,
    authedFetch,
    whoami,
    entitled,
    store,
    evidence,
  };
}

export default createKeystoneClient;
