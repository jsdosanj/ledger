# Ledger — IT documentation & knowledge hub

> Your IT documentation, as plain markdown files in git — readable in any editor, version-controlled by default, and free forever to self-host. The single pane of glass for everything you know about every client.

Ledger is the DosanjhLabs product for **MSPs and internal IT teams** — the IT Glue / Hudu alternative built on a **plain-markdown-on-git substrate** so your docs are free, portable, and editor-agnostic, with a beautiful web UI on top.

It is a **local-first static browser app** (vanilla HTML/CSS/JS, no build step, deployable as a subpath). All docs live in the browser's `localStorage` as plain markdown; nothing leaves the machine until you opt into the cloud tier.

> **Free and open source, forever.** Ledger is MIT-licensed (see [LICENSE](LICENSE)) and self-hostable with zero dependencies. The cloud tier is optional; signed out, the app makes no network calls.

## Obsidian, governed for the enterprise

Ledger's thesis: **turn Obsidian into a proper, governed corporate documentation hub.** Obsidian is perfect for one person; the moment a company depends on those notes you need governance Obsidian was never built to give. Ledger keeps docs Obsidian-native — portable markdown with `[[wikilinks]]`, YAML frontmatter, folders/tags, backlinks — and adds the enterprise layer: a shared org vault, review/approval + ownership/"last reviewed" governance, org-wide search, read-only published portals, and compliance evidence.

*"Obsidian for one person → Ledger for your whole company."*

The cross-platform desktop experience ships as an **Obsidian community plugin** in [`obsidian-plugin/`](obsidian-plugin/) — enable it, paste a DosanjhLabs access token, and get the enterprise layer **inside Obsidian** (shared org-vault sync, doc-review governance, compliance evidence). See [`obsidian-plugin/README.md`](obsidian-plugin/README.md) for install instructions.

## What it does (Wave 1 MVP)

- **Markdown doc hub** — create/edit/organize asset pages, runbooks, network/config notes, and procedures. Obsidian-compatible YAML frontmatter.
- **Doc tree + full-text search** — folder-grouped left rail (the "spine"), tag cloud, and search-as-you-type across titles, paths, tags, frontmatter, and body.
- **Markdown editor + live preview** — split-pane, dependency-free renderer (headings, tables, code, Mermaid, task lists, blockquotes, `[[wiki-links]]`, backlinks).
- **Local version history + diff** — every save snapshots the prior version; line-level diff and restore.
- **Templates** — real IT-doc starters: server/VM, network, runbook/SOP, credential reference, SaaS app, onboarding/offboarding.
- **No passwords stored** — credential pages link to your password manager by item URL only; a save-time scanner warns on pasted secrets.
- **Export** — single page or the whole KB as portable markdown. Bring your own git / Obsidian.
- **Opt-in cloud tier** — Clerk sign-in via the vendored Keystone SDK, entitlement-gated Pro features (cross-device KB sync, PR review, MSP), and "doc reviewed / exists" evidence emission to Sightline. Signed out = zero network.
- **BYO-key AI (client-direct)** — draft a doc from notes, summarize a page, or ask your docs. Your key, your browser, called directly to the provider.

## Run it locally

```sh
cd ledger
python3 -m http.server 8000
# Marketing home:  http://localhost:8000/index.html
# The app:         http://localhost:8000/app/index.html
```

Browsers block `fetch()` on `file://`, so serve over HTTP. No build, no dependencies.

## Verify

```sh
node scripts/verify.js
```

Parses the content packs and boots `app.js` under a DOM shim with a fetch that blocks non-local URLs, then exercises the core flow (seed → create → search → evidence) and asserts the signed-out path makes zero network calls.

## Structure

```
index.html              Marketing home
pricing.html            Free / hosted Free / Pro / Teams
vs-it-glue.html         Comparison page (SEO)
vs-hudu.html            Comparison page (SEO)
obsidian-workflow.html  "Bring your own editor" page (SEO)
self-host.html          Free OSS self-host quickstart (SEO)
docs/index.html         User documentation
app/index.html          The app shell
app/js/ai.js            BYO-key AI (client-direct, plain global)
app/js/cloud.js         Opt-in cloud tier (ES module, vendored Keystone SDK)
app/js/keystone-client.js  Vendored shared cloud SDK
assets/style.css        Brand: ink navy + parchment + brass + oxblood, Fraunces
assets/app.js           The doc-hub engine (vanilla JS)
assets/data/*.json      templates.json, seed-kb.json
scripts/verify.js       Data + core-flow verifier
```

## Brand

"The bound ledger book / archive." Ink navy `#13233A` + aged parchment `#F4EEE2` + brass/gold-leaf `#C9A227` + oxblood `#7A2E2E`, Fraunces display, JetBrains Mono for the git/markdown story, a recurring left-rail "spine" and pages-turn motif. See `STATUS.md` for what's built vs. roadmap.

A documentation aid — not a substitute for your own backups or compliance program. Ledger stores **no passwords or secrets** by design.

## Contributing & security

- [CONTRIBUTING.md](CONTRIBUTING.md) — how to set up, the no-build verify loop, and PR flow.
- [SECURITY.md](SECURITY.md) — how to report a vulnerability privately.
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) — Contributor Covenant.

## License

**MIT** — see [LICENSE](LICENSE). Copyright (c) 2026 Jasvant Dosanjh. Free and open source forever; self-host without restriction.
