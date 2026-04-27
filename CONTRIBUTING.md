# Contributing to BulkSpot

Thanks for being interested. BulkSpot is a small, focused tool — contributions that match the [product principles](#product-principles) are very welcome. Drive-by refactors and "modernizations" generally aren't.

## Highest-leverage contributions

In rough order of value:

1. **False-positive / false-negative reports** with the offending email's full headers (Gmail → ⋮ → *Show original* → copy headers). Use the [false-positive issue template](.github/ISSUE_TEMPLATE/false_positive.yml). These directly improve classifier accuracy for everyone.
2. **New cold-outreach platform domains** — extend [extension/lib/coldRelays.data.js](extension/lib/coldRelays.data.js) when you spot Smartlead/Instantly/Apollo/etc. clones the classifier doesn't catch yet.
3. **Selector fixes** when Gmail rewrites its DOM and chips stop appearing. See `extractThreadId` and `findRows` in [extension/content/content.js](extension/content/content.js).
4. **Header-signal additions** with documented evidence (real email examples) in [bulk_email_signs.md](bulk_email_signs.md).

## Product principles

Please align changes with these — PRs that contradict them will be hard to merge:

1. **Header-only classification.** No body inspection. Faster, privacy-clean, and catches ~80% of bulk on its own.
2. **Read-only by design.** The extension never writes to Gmail. No labels, no archives, no read-state changes. The chip is a browser-tab overlay only.
3. **No backend, no telemetry.** Everything runs locally. No analytics, no remote config, no third-party scripts.
4. **Single OAuth scope: `gmail.metadata`.** Adding any other scope is a major decision — opens up consent-screen surface and CASA implications. Don't.

## Local development

### One-time setup

You need a Google Cloud OAuth client ID to authenticate with Gmail. Full walkthrough in [extension/README.md](extension/README.md). Summary:

1. Create a project at https://console.cloud.google.com
2. Enable the **Gmail API**
3. Create OAuth credentials → **Chrome Extension**
4. Load the unpacked extension first (`chrome://extensions` → Developer Mode → Load unpacked → `extension/`) — this generates an extension ID even if OAuth isn't configured yet
5. Paste that extension ID into the Google Cloud OAuth client setup
6. Paste the resulting OAuth client ID into [extension/manifest.json](extension/manifest.json) under `oauth2.client_id`
7. Reload the extension

> **Don't commit your client ID.** If you're hacking on a fork, copy `manifest.json` to `manifest.local.json` (gitignored), keep your client ID there, and swap before testing. Or just be careful before pushing.

### Iteration loop

- Edit files in `extension/`
- Click the reload icon on the BulkSpot card in `chrome://extensions`
- For content-script changes: refresh Gmail
- For background-worker changes: reload is enough; click "Inspect views: service worker" to see logs
- For popup changes: close and reopen the popup

### Testing your change

There's no automated test suite (yet). Smoke-test by:

1. Reload the extension
2. Open Gmail with a populated inbox
3. Confirm chips render correctly (orange for bulk, green for clean)
4. Click a chip → popover appears with whitelist/blocklist actions
5. Add a sender to the whitelist → chip changes accordingly
6. Open the popup → toggle off/on works, stats update

If you're modifying the classifier, paste the headers of your test email into a comment on the PR.

## PR guidelines

- One change per PR. Don't bundle unrelated cleanups.
- Update [bulk_email_signs.md](bulk_email_signs.md) if you add or change a header signal.
- Include a smoke-test note: what you tested, what Gmail layout you tested in.
- No new OAuth scopes without prior discussion in an issue.
- No new third-party dependencies without prior discussion. Vanilla JS is the norm here.
- Use the [PR template](.github/PULL_REQUEST_TEMPLATE.md) checklist.

## What's deliberately out of scope

- Body-content heuristics (header-only catches ~80%; defer until v2)
- Any Gmail write — no labeling, archiving, deleting, read-state changes
- Cross-device persistence (chip lives in the browser tab; gone on mobile, gone on another computer — by design)
- Cloud Functions, push notifications, server-side anything
- Telemetry, even anonymous usage stats

## Code style

- Vanilla JS, ES modules, no build step
- 2-space indent, single quotes, no semicolons-elision games
- No comments that just restate the code; comments explain *why*, not *what*

## Code of conduct

Be decent. This is a small project; we don't need a 500-line CoC document. Respect other contributors. Keep technical discussion technical.
