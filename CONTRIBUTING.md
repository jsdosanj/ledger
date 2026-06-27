# Contributing to Ledger

Thanks for helping turn Obsidian into a governed corporate documentation hub.
Ledger is free and open source under the **MIT** license, and contributions are
welcome — bug fixes, docs, the web app, and the Obsidian community plugin.

## Ground rules

- Be respectful. This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
- By contributing, you agree your work is licensed under the **MIT** license.
- Keep changes surgical and focused (see [CLAUDE.md](CLAUDE.md) for the house
  style: simplicity first, surgical changes, no speculative abstractions).

## Project layout

Ledger is a **local-first static app** — vanilla HTML/CSS/JS, **no build step**.

- `app/`, `assets/` — the web app (doc-hub engine, AI, cloud, vault sync).
- `obsidian-plugin/` — the Obsidian community plugin (vanilla CommonJS
  `main.js`, no build step; Obsidian loads it directly).
- `docs/`, `*.html` — marketing + user documentation.
- `scripts/verify.js`, `obsidian-plugin/verify.js` — the verification harnesses.

## Development setup

```sh
cd ledger
python3 -m http.server 8000
# Marketing home:  http://localhost:8000/index.html
# The app:         http://localhost:8000/app/index.html
```

Browsers block `fetch()` on `file://`, so serve over HTTP. No build, no deps.

## Verify before you open a PR

```sh
node scripts/verify.js            # web app: data packs + core signed-out flow
node obsidian-plugin/verify.js    # plugin: manifest, commands, security, interop
```

Both must pass. CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml))
runs `node --check` on every `.js` file plus these harnesses, so syntax-check
your changes locally:

```sh
find . -path ./node_modules -prune -o -name '*.js' -print | xargs -n1 node --check
```

## Working on the Obsidian plugin

See [`obsidian-plugin/README.md`](obsidian-plugin/README.md). Key invariants the
verifier enforces, and that you must preserve:

- `manifest.json` keeps all required fields and a semver `version`; bump
  `versions.json` in lockstep (never regress `minAppVersion`).
- Network only through Obsidian's `requestUrl` (no raw `fetch`, no CORS), with
  `Authorization: Bearer <token>`.
- Evidence payloads are **structural only** — never note bodies.
- The access token is never written to a note and never logged.

## Security

Never commit secrets. To report a vulnerability, see [SECURITY.md](SECURITY.md) —
please do **not** open a public issue for security problems.
