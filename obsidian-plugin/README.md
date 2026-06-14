# Ledger — enterprise governance for Obsidian

An Obsidian community plugin that turns a personal vault into a **governed,
company-grade** one — without leaving Obsidian. Obsidian is already the
cross-platform desktop host; this plugin adds the enterprise layer Obsidian
lacks, against the same DosanjhLabs / Keystone platform the [Ledger web
app](../) uses.

## What you get

- **Sign in** with a DosanjhLabs access token (Settings → Ledger → *Access
  token* → *Verify*). The status bar shows your org once verified.
- **Shared org vault sync** — *Push vault to org cloud* / *Pull vault from org
  cloud*. It interoperates with the Ledger web app (same `kb-state` store), and
  pull never deletes local notes.
- **Doc-review governance** — *Mark current note reviewed* stamps `reviewed_on`
  into frontmatter; *Show governance report* lists never-reviewed and stale
  notes (owner + age), click to open.
- **Compliance evidence** — *Publish documentation evidence* sends **structural
  signals only** (paths, titles, type, `reviewed_on`, counts — never note
  bodies) into the shared evidence graph so Sightline can map "docs exist &
  reviewed in the last 90 days" to controls.

All commands are in the Command Palette (`Ctrl/Cmd-P`, type "Ledger"). There's a
ribbon icon for one-click push.

## Install (manual, until listed in Community Plugins)

1. Copy this folder to your vault: `<vault>/.obsidian/plugins/ledger-enterprise/`
   (it must contain `manifest.json` and `main.js`).
2. Obsidian → Settings → Community plugins → enable **Ledger — enterprise
   governance**.
3. Open the plugin settings, paste your access token, click **Verify**.

No build step — Obsidian loads `main.js` directly.

## Security & privacy

- **No secrets in notes.** Credential notes should *link* a password manager
  item; never paste a secret. The org sync carries no secret material by design.
- Your **access token** is stored only in this vault's local plugin data
  (`.obsidian/plugins/ledger-enterprise/data.json`) — never in a note, never
  logged. Treat the vault folder accordingly.
- Network goes through Obsidian's `requestUrl` (no CORS) to
  `api.dosanjhlabs.com` with a bearer token; the **tenant is always derived
  server-side** — the client can't act as another org.

## Auth model (and the one Keystone dependency)

Plugins can't run Clerk's hosted redirect sign-in cleanly inside Obsidian, so
this uses the standard **pasted access token** pattern. That requires Keystone
to issue personal/plugin access tokens accepted as `Authorization: Bearer` on
the existing `/whoami`, `/store`, `/evidence`, and `/billing/entitled`
endpoints. Everything else here is complete and verified.

## Verify

```sh
node verify.js
```

Static checks: manifest shape, `main.js` parses, all six commands present,
bearer auth + `requestUrl` used, evidence payload is body-free, and the sync key
matches the web app for interop.
