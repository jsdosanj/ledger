# Security Policy

Ledger is built around a **no-secrets posture**: docs are plain markdown, the
signed-out app makes zero network calls, credential pages link a password
manager item by URL only (they never store the secret), and the Obsidian plugin
keeps your access token in local plugin data — never in a note, never logged.
We still want to hear about anything that could weaken that.

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Report privately through one of:

1. **GitHub private vulnerability reporting** (preferred) — go to the
   [Security tab](https://github.com/jsdosanj/ledger/security/advisories) of the
   repository and click **Report a vulnerability**. This opens a private
   advisory only you and the maintainers can see.
2. **Email** — `singhsxdhi@gmail.com` with the subject line
   `[SECURITY] Ledger` if you cannot use GitHub advisories.

Please include:

- A description of the issue and its impact.
- Steps to reproduce (a proof of concept is ideal).
- Affected component (web app vs. `obsidian-plugin/`) and version/commit.

We will acknowledge your report within **5 business days**, keep you updated,
and credit you in the release notes unless you prefer to remain anonymous.

## Scope

In scope: any path that could leak a secret or note body, the BYO-key AI
client-direct calls, the opt-in cloud tier and bearer-token handling, the
Obsidian plugin's `requestUrl`/evidence/sync paths, and the path-traversal guard
on vault writes.

Out of scope: vulnerabilities in third parties Ledger integrates with (Obsidian,
Clerk/Keystone, the AI provider you point your own key at) — report those to the
respective vendor; and issues requiring a pre-existing local compromise of the
user's machine or vault.

## Supported versions

Security fixes land on the latest release. Please upgrade to the newest version
before reporting.
