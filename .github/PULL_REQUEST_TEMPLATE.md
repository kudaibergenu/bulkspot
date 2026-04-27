<!-- Thanks for the PR. Please fill in the sections below. -->

## What this changes

<!-- One or two sentences on what this PR does and why. -->

## Type

- [ ] Bug fix
- [ ] Classifier rule change (added or modified header signal)
- [ ] Cold-relay domain addition
- [ ] Gmail DOM selector fix
- [ ] Documentation
- [ ] Other (explain)

## Smoke test

<!-- What you tested locally. Be specific. -->

- [ ] Loaded the unpacked extension and reloaded after the change
- [ ] Confirmed chips render correctly in Gmail (orange = bulk, green = clean)
- [ ] Tested whitelist / blocklist actions if relevant
- [ ] Service-worker console is clean (no new errors)
- [ ] Gmail layout tested: <!-- e.g. classic / cozy / compact density, default theme -->

## Classifier change checklist (skip if not applicable)

- [ ] Updated [bulk_email_signs.md](../bulk_email_signs.md) to document the new/changed signal
- [ ] Pasted example redacted headers in this PR description that demonstrate the change
- [ ] Considered false-positive risk: <!-- one sentence -->

## Out-of-scope check

- [ ] No new OAuth scopes added
- [ ] No Gmail writes (labels, archive, delete, mark-read) introduced
- [ ] No telemetry, analytics, or third-party network calls added
- [ ] No new third-party dependencies added
