# Security Policy

## Reporting a vulnerability

**Please do not file public GitHub issues for security vulnerabilities.**

If you believe you've found a security issue in BulkSpot, report it privately via:

- **GitHub Security Advisories** — preferred. Open a [private vulnerability report](../../security/advisories/new) on this repo.
- **Email** — `YOUR_SECURITY_EMAIL@example.com` (replace before publishing).

Include:

- Affected file(s) and line numbers if you have them
- Steps to reproduce or a proof-of-concept
- Your assessment of impact (data exposure? privilege escalation? supply-chain risk?)

You'll get an initial acknowledgement within 7 days. For confirmed issues, we'll coordinate a fix and a disclosure timeline before any public discussion.

## Scope

In scope:

- Anything that breaks the read-only contract (i.e. causes the extension to write to Gmail)
- Anything that exfiltrates email headers, message contents, OAuth tokens, or user data outside the user's own browser
- Privilege escalation via `chrome.identity` token misuse
- Supply-chain risk in any in-tree code

Out of scope (not security issues):

- Classifier false positives or false negatives — file a regular issue with headers attached
- Gmail UI breakage from DOM-selector drift — file a regular issue
- Feature requests

## Threat model assumptions

- The extension only requests `https://www.googleapis.com/auth/gmail.metadata` — no body access, no write scopes.
- All state is in `chrome.storage.local`. There is no remote backend.
- Bundled dependencies should be zero. If you find one that wasn't there before, that's a supply-chain regression and worth reporting.
