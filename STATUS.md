# Ledger Governance — Status

**Thesis:** Ledger Governance is a **100% local** Obsidian community plugin that
adds the governance layer a growing vault needs — without an account, a token, a
server, or ever taking a note out of your vault. Obsidian is excellent for one
person; the moment a team depends on those notes you need to know **who owns
each one, where it sits in its lifecycle, and whether it's still current**.
Ledger adds exactly that, and nothing that leaves your machine.

*"Obsidian is perfect for one person. Ledger makes a vault governable."*

Governance lives in **standard YAML frontmatter** (`owner`, `status`,
`reviewed_on`, `review_cadence_days`), so notes stay portable plain Markdown —
disable or remove the plugin and your notes are exactly as you left them. Free
and open source (MIT).

## Shipped & live

**Live in the Obsidian Community Plugins directory** as id `ledger-governance`
(author DosanjhLabs): <https://community.obsidian.md/plugins/ledger-governance>.
Install is one click — Settings → Community plugins → Browse → search "Ledger" →
Install → Enable. No build step (Obsidian loads `main.js` directly), no setup,
no sign-in.

The plugin (`main.js` + `manifest.json` at the repo root) does the whole job today:

1. **Governed-document template** — *New governed document* scaffolds a note with
   the governance frontmatter (`owner`, `status`, `reviewed_on`, review cadence)
   already in place, so a doc starts governed instead of being patched later.
2. **Status lifecycle** — *Set document status* moves a doc through
   `draft → in-review → approved → published`; anyone reading the note sees
   exactly where it stands.
3. **Ownership** — *Set document owner* assigns an owner (name or email).
4. **Review tracking** — *Mark current note reviewed* stamps `reviewed_on` with
   today's date; docs past their cadence (default 90 days, or a per-note
   `review_cadence_days`) are flagged stale.
5. **Governance dashboard** — *Governance dashboard* (also the ribbon icon) shows
   the status mix, review freshness (never / stale / fresh), and which docs are
   **ungoverned** (missing an owner or a status). Click any row to open it. The
   status bar keeps a live `N docs · X stale · Y ungoverned` summary.
6. **In-vault audit log** — every governance action is appended to
   `_ledger/audit.md`, a plain-Markdown audit trail you own; *Open governance
   audit log* jumps to it. The audit table escapes note-supplied values so a
   crafted title/owner/status cannot inject or forge rows (1.0.2 hardening).

All commands are in the Command Palette (`Ctrl/Cmd-P`, type "Ledger"). Works on
desktop and mobile (`isDesktopOnly: false`).

## Local-only guarantee

Nothing leaves the machine. The plugin makes **no network calls** and stores **no
account or token** — no `fetch`, no `requestUrl`, no XHR/WebSocket/beacon, no
`Authorization`/`Bearer`, no `http(s)` URLs anywhere in `main.js`. Governance
metadata is written into your own notes' frontmatter; the audit log lives in your
vault; settings (review-stale threshold, whether an owner/status is required)
live in the vault's local plugin data. A breach of some server can't touch your
notes, because there is no server.

## Verification

`node verify.js` → **27/27 checks pass** (static checks; the plugin runs inside
Obsidian, not Node):

- **Manifest** — required fields present, `versions.json` maps the version,
  `isDesktopOnly: false`, description makes no account/login claim.
- **main.js** — parses (`node --check`) and exports a `Plugin` subclass.
- **Commands** — all six governance commands registered (`ledger-new-doc`,
  `ledger-set-status`, `ledger-set-owner`, `ledger-mark-reviewed`,
  `ledger-governance`, `ledger-audit`).
- **Local-only** — no fetch / requestUrl / XHR / auth token / http URLs.
- **Governance layer** — status lifecycle, frontmatter writes, in-vault audit
  log path, `logAudit()`, owner + `reviewed_on` + ungoverned tracking, and the
  audit log excluded from the governed-docs scan.

CI (`.github/workflows/ci.yml`) runs `node verify.js` on every push and PR, plus
`node --check` on all shipped JS.

## Retired & removed

The earlier **cloud SaaS** direction (a hosted, sign-in-gated documentation hub
with Clerk SSO, a Keystone-backed org vault, opt-in AI, and a browser app) has
been **retired and removed** in favor of the free, local-only plugin above.
Deleted from the repo/deploy: the browser app (`app/` — `index.html`,
`app/js/{ai,cloud,keystone-client,vault-sync}.js`), the SaaS engine
(`assets/app.js`), the SaaS-era verifier (`scripts/verify.js`), and the Clerk /
Turnstile allowances in the `_headers` CSP. The remaining marketing pages
(`pricing.html`, `self-host.html`, `vs-*.html`) are kept but `noindex`; the site
now leads with the plugin (`index.html`, `obsidian-workflow.html`, `docs/`).

## Marketing site

Static site on Cloudflare Pages (`ledger.dosanjhlabs.com`). Distinct brand — ink
navy + parchment + brass + oxblood, Fraunces display, JetBrains Mono. Home leads
**"Govern your vault without leaving Obsidian"**; `obsidian-workflow.html` walks
the install → govern → dashboard → audit flow; `docs/` is the Help Center.
Schema.org `SoftwareApplication` + `FAQPage`, `_headers` security headers
(CSP is Report-Only for now), sitemap + robots.

## Hub listing

Live in the Obsidian directory. The DosanjhLabs storefront `products.ts` entry is
redeployed centrally (founder-gated).
