# Changelog

All notable changes to Ledger Governance are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and versions match the plugin's
`manifest.json` / `versions.json`.

## [1.0.2] — 2026-07-03

### Security
- Hardened the in-vault audit log (`_ledger/audit.md`) against Markdown
  table-injection: governance actions written to the audit table now escape
  pipe and control characters so a crafted note title, owner, or status cannot
  break out of a table cell or forge audit rows.

### Changed
- De-indexed the retired cloud-SaaS marketing stubs so search engines only see
  the free, local-only plugin.

## [1.0.1] — 2026-06-29

### Fixed
- Corrected the release tagging: the stale `1.0.0` tag pointed at a pre-rename
  commit. Re-cut the release from the renamed **Ledger Governance** /
  `ledger-governance` tree and added an attested release workflow.

### Added
- Now live in the Obsidian **Community Plugins** directory
  ([ledger-governance](https://community.obsidian.md/plugins/ledger-governance)).

## [1.0.0] — 2026-06-27

Initial release — a **100% local** Obsidian document-governance plugin (MIT).
No account, no token, no network.

### Added
- **Governed-document template** — scaffolds a note with governance frontmatter
  (`owner`, `status`, `reviewed_on`, review cadence) already in place.
- **Status lifecycle** — move a doc through `draft → in-review → approved →
  published`.
- **Ownership** — assign an owner (name or email) to any note.
- **Review tracking** — stamp `reviewed_on`; docs past their cadence (default
  90 days, or a per-note `review_cadence_days`) are flagged stale.
- **Governance dashboard** — status mix, review freshness (never / stale /
  fresh), and which docs are ungoverned (missing an owner or status); plus a
  live `N docs · X stale · Y ungoverned` status-bar summary.
- **In-vault audit log** — every governance action is appended to
  `_ledger/audit.md`, a plain-Markdown trail you own.

[1.0.2]: https://github.com/jsdosanj/ledger/releases/tag/1.0.2
[1.0.1]: https://github.com/jsdosanj/ledger/releases/tag/1.0.1
[1.0.0]: https://github.com/jsdosanj/ledger/releases/tag/1.0.0
