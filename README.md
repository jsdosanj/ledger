# Ledger Governance

An Obsidian community plugin that turns a personal vault into a **governed,
company-grade** one — without leaving your editor and **without an account**.

Ledger is **100% local**: no login, no tokens, no network, no servers. Governance
lives in standard frontmatter (`owner`, `status`, `reviewed_on`), so your notes
stay portable plain markdown. Free and open source (MIT).

## What you get

- **Governed-document template** — *New governed document* scaffolds a note with
  the governance frontmatter (owner, status, review cadence) already in place.
- **Status lifecycle** — *Set document status* moves a doc through
  `draft → in-review → approved → published`.
- **Ownership** — *Set document owner* assigns an owner (name or email).
- **Review tracking** — *Mark current note reviewed* stamps `reviewed_on`; docs
  past their cadence (default 90 days, or a per-note `review_cadence_days`) show
  as stale.
- **Governance dashboard** — *Governance dashboard* (also the ribbon icon) shows
  the status mix, review freshness (never / stale / fresh), and which docs are
  **ungoverned** (missing an owner or a status). Click any row to open it. The
  status bar keeps a live `N docs · X stale · Y ungoverned` summary.
- **In-vault audit log** — every governance action is appended to
  `_ledger/audit.md`, a plain-markdown audit trail you own. *Open governance
  audit log* jumps to it.

All commands are in the Command Palette (`Ctrl/Cmd-P`, type "Ledger").

## Install

Ledger Governance is live in the Obsidian **Community Plugins** directory:

1. Open Obsidian → **Settings → Community plugins** → **Browse**.
2. Search for **"Ledger"**, open **Ledger Governance**, and click **Install**.
3. Click **Enable**.

That's it — no build step, no setup, no sign-in.

<details>
<summary>Manual install (older Obsidian versions)</summary>

1. Copy this folder to your vault: `<vault>/.obsidian/plugins/ledger-governance/`
   (it must contain `manifest.json` and `main.js`).
2. Settings → Community plugins → enable **Ledger Governance**.

The plugin loads `main.js` directly — nothing to build.

</details>

## Privacy

Nothing leaves your machine. The plugin makes **no network calls** and stores no
account or token. Governance metadata is written into your own notes' frontmatter
and the audit log lives in your vault. Settings (review-stale threshold, whether
an owner/status is required) are stored in the vault's local plugin data.

## Verify

```sh
node verify.js
```

Static checks: manifest shape, `main.js` parses and exports a Plugin subclass,
all six commands present, the **local-only** guarantee (no fetch / requestUrl /
auth token / http URLs anywhere), and the governance layer (status lifecycle,
frontmatter writes, audit log).

## License

MIT — see [LICENSE](LICENSE).
