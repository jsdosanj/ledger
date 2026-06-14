# Ledger — Status (Wave 1 MVP)

**Thesis:** turn **Obsidian** into a proper, governed **corporate documentation hub**. Obsidian is perfect for one person; the moment a company depends on those notes you need governance Obsidian was never built to give. Ledger keeps your docs **Obsidian-native** (portable Markdown with `[[wikilinks]]`, YAML frontmatter, folders/tags, backlinks — import a vault, keep editing in Obsidian, never locked in) and adds the **enterprise layer Obsidian lacks**: a shared org vault, roles & permissions, review/approval + ownership/"last reviewed" governance, org-wide search, read-only published portals, audit trail, and SSO.

*"Obsidian for one person → Ledger for your whole company."*

Local-first static app (vanilla HTML/CSS/JS, no build, deployable as a subpath at `https://dosanjhlabs.com/ledger/`). Docs are **plain markdown** in `localStorage`; nothing leaves the browser until the opt-in cloud tier is used. Not pushed/deployed/published to the hub (founder-gated until the full feature set; the storefront is redeployed centrally). **No secret storage** — credential pages link to a password manager.

## Works end-to-end NOW

A team that already uses Obsidian can do the governed-documentation job today:

1. **Open the app** (`app/index.html`) — no signup. A sample KB (Northwind Clinic, **9 pages across Assets / Network / Runbooks / Policies**) is seeded on first run so the tree, search, wikilinks, backlinks, **governance, roles, and portals** are explorable immediately.
2. **Import an Obsidian vault** — the **Import vault** flow accepts a Ledger export bundle (path-headed `FILE:` markers) or a single `.md` note. Frontmatter, folders, tags, and `[[wikilinks]]` all carry over. Symmetric with Export — round-trips back into Obsidian.
3. **Browse spaces** — the left-rail "spine" groups pages by folder (= space) with a tag cloud; **org-wide search-as-you-type** across titles, paths, tags, frontmatter values, and body, ranked with highlighted snippets.
4. **Read a page** — frontmatter renders as a table; the dependency-free markdown renderer handles headings, tables, fenced code (incl. Mermaid, not executed), task lists, blockquotes, links, and `[[wikilinks]]`. Meta bar shows tags and **backlinks**.
5. **Links / graph view** — a per-page **Links** tab lists outgoing wikilinks + backlinks ("what depends on this?") as navigable nodes, with a vault connectivity summary — the connection map Obsidian draws, made clickable.
6. **Governance per doc (the Obsidian gap)** — a governance bar surfaces **owner** and **last-reviewed** from frontmatter, computes a **review status** (fresh ≤90d / needs-review / never-reviewed), shows **approval state**, offers **Mark reviewed today** (stamps `reviewed_on` into frontmatter) and **Approve this version** (records sign-off). An edit re-opens approval automatically.
7. **Roles & permissions** — a **role picker** (Admin / Editor / Reviewer / Viewer / Portal) simulates the cloud-tier RBAC locally: the Edit tab, Delete, Mark-reviewed, Approve, and Publish actions appear only for roles that have the scope. Viewer/Portal are read-only.
8. **Read-only published portal** — Admin can **Publish** a space to a self-contained read-only HTML file (per-page nav, frontmatter review stamps, sanitized render) an auditor/non-editor opens with **no app, no account, no editing**. Carries no secret material.
9. **Edit** — split markdown editor with **live preview**; `Ctrl/Cmd+S` saves and **snapshots the prior version**; inline tag editing. (Gated by role.)
10. **Version history + diff** — list prior versions, view a line-level diff, restore any version.
11. **Templates** — 6 real IT-doc starters (server/VM, network, runbook/SOP, credential reference, SaaS app, onboarding/offboarding).
12. **No-secrets posture** — credential pages link a vault item (`vault://provider/item-id`) by URL only; a save-time scanner warns when a page looks like it holds a pasted password/key/seed. **Ledger stores zero secret material.**
13. **Export** — a single page as `.md`, or the whole vault as one portable path-headed markdown bundle — `git clone` / Obsidian-ready, and re-importable.

### Opt-in cloud / Pro tier — the enterprise layer (local-first unchanged)
- **Vendored SDK** `app/js/keystone-client.js`; loaded via a separate ES module (`app/js/cloud.js`) with best-effort `import()`. If it fails (offline/blocked/not deployed), `app.js` does not depend on it and the app keeps working.
- **Clerk SSO** (`pk_live_…`, apiBase `https://api.dosanjhlabs.com`), hotloaded only on explicit click — signed-out render makes zero network calls.
- **Entitlement-gated enterprise features**, reframed around the Obsidian-corporate thesis: **Shared org vault** (cross-team markdown sync), **Roles, approval & audit** (per-space scopes + append-only audit trail + SSO), **Published portals & multi-client** (read-only portals + hard per-client isolation). Each shows a live Locked / Pro·unlocked badge.
- **Shared org vault sync** via `store.put/get('ledger', 'kb-state')` — the markdown KB (no secrets, by construction).
- **Evidence emission** via `evidence.publish` — a canonical `it_documentation` object carrying **structural signals only** (paths, titles, type, `reviewed_on`, counts; `secrets: none-stored`) — never page bodies — so Sightline maps "documented inventory exists & reviewed in last 90 days" to controls.

### BYO-key AI (client-direct)
- **`app/js/ai.js`** — plain global, not wired to Keystone. The user pastes their OWN key; the **browser calls the provider directly** (OpenAI / Anthropic `claude-opus-4-8` / OpenRouter). Key lives only in `localStorage`.
- **Three flows:** draft a doc; summarize the open page; ask-your-docs (retrieval with page-path citations).
- **Secret safety:** a scrubber redacts secret/PII patterns and hard-blocks the draft path on a likely secret before any request leaves the browser.

## Verification (actual results, this iteration)
- `node --check` on `assets/app.js`, `app/js/ai.js`, `app/js/cloud.js`, the vendored `app/js/keystone-client.js`, and `scripts/verify.js` → all **OK**.
- `node scripts/verify.js` → **33/33 checks pass**. Existing 16 (templates + seed parse; no pasted password; vault `vault://` links; bridge ready; AI off by default; cloud not loaded signed-out; seed loaded; create doc; search hit/miss; evidence canonical + body-free + `secrets:none-stored`; docIndex; zero network; AI scrubber). **New Obsidian-corporate 14:** vault import adds pages keeping folder paths + frontmatter tags; `[[wikilink]]` resolves both directions (link-out + backlinks); governance reads owner + review status from frontmatter; never-reviewed page flagged; **Mark-reviewed stamps `reviewed_on`** (now fresh); Admin can edit/approve/publish; **Reviewer/Admin approve** (sign-off recorded); Viewer + Portal read-only (no edit/approve/publish); edit invalidates approval; **publish read-only portal** = self-contained HTML with no editing + **no secret material**; and **ZERO non-local network** through the entire extended flow.
- Served over HTTP + curled all **18 routes** (home, pricing, obsidian-workflow, vs-it-glue, vs-hudu, self-host, docs, app, style.css, app.js, ai.js, cloud.js, keystone-client.js, both JSON packs, robots.txt, sitemap.xml) → all **200**.
- **Relative paths:** no leading-slash absolute asset refs — deployable as a `/ledger/` subpath. Canonicals all under `https://dosanjhlabs.com/ledger/`.
- **Real-DOM drive-through** (vm + localStorage shim): seeded **Access Control Policy** = owner `Security Lead`, status **fresh**; **Staff Offboarding Policy** = status **stale** (286d); `publishPortal("Policies")` produces well-formed `<!DOCTYPE html>…</html>` (3.2 KB) containing both pages + the READ-ONLY banner; spaces enumerate `Assets, Network, Policies, Runbooks`.

## Marketing + SEO (reframed to LEAD with the Obsidian-corporate thesis)
Distinct brand (§6.2 "bound ledger book / archive"): ink navy + parchment + brass + oxblood, Fraunces display, JetBrains Mono. Home now leads **"Your team already loves Obsidian. Ledger makes it a company-grade documentation hub"** with sections on the **enterprise layer Obsidian lacks** (shared org vault + roles, review/approval governance, published portals, org-wide search + links graph, audit + SSO, still no secret storage) and **Obsidian-compatible by design** (import a vault, portable Markdown, free version history). `obsidian-workflow.html` is the centerpiece — **"Obsidian for one person → Ledger for your whole company"** with a "what Ledger adds that Obsidian can't" grid and an import→govern→publish flow. Pricing leads with **Obsidian-portable governance, cheaper than the incumbents** and adds a **vs IT Glue / Hudu / Confluence** angle (portable Markdown + Obsidian-native + cheaper). Schema.org `SoftwareApplication` + `FAQPage`; canonical `https://dosanjhlabs.com/ledger/`; robots + sitemap.

## Stubbed / designed but not built — TODO(wave1-next)
- **Hosted git substrate** (R2 bare repos + git runner) + **server FTS fallback** — local history/diff + the in-app vault importer stand in today; full git history + PR-review merge UI is hosted-mode.
- **Cloud-tier RBAC with folder inheritance** (plan §7) — the local role picker demonstrates the model single-user; the per-resource scope engine + SSO-derived principals + append-only audit trail are cloud-tier.
- **Companies/clients model + custom asset schemas + force-directed graph view** — frontmatter + wikilink backlinks + the navigable Links view ship now; admin-defined schemas and a visual graph are fast-follow.
- **Two-way conflict-aware Obsidian sync helper** (CLI) — today the loop is plain git + the in-app importer/exporter.
- **Suite integration (M7):** Cairn asset sync, Lookout health badges + discovery, Bastion/Sightline compliance docs. The evidence-emission half (Ledger → Sightline) is wired; inbound producer feeds are later.
- **Live integrations wave 1** (Entra/M365, Google, Okta, JumpCloud, Jamf/Intune, EDRs; Slack/Teams/email expiration alerts) — designed, not built.

## Hub listing
Not yet added to the storefront `products.ts`. Per plan §15-M10, add as `status:'wip'` after the marketing soak, flip to `'live'` after GA — founder-gated; the storefront is redeployed centrally.
