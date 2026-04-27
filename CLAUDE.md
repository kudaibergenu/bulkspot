# BulkSpot — Chrome extension for highlighting bulk email in Gmail

This file is the long-form architecture and design doc. For the user-facing pitch and install instructions, see [README.md](README.md). For contribution guidelines, see [CONTRIBUTING.md](CONTRIBUTING.md).

## What it does

Detects bulk/marketing email in Gmail using header signals (List-Unsubscribe, Feedback-ID, ESP DKIM, VERP envelope sender, etc.) and renders a visual chip next to each bulk row. Gmail is never mutated — no labels applied, no read state touched, nothing moved out of the inbox. The chip is drawn by the extension in the browser tab and disappears if the extension is uninstalled.

## Product principles

1. **Header-only classification.** No body inspection. Faster, privacy-clean, and catches ~80% of bulk on its own.
2. **Read-only by design.** The extension never writes to Gmail. The chip is a visual overlay in the browser tab, not a Gmail label. This keeps the OAuth scope surface minimal (`gmail.metadata` only) and the consent screen as narrow as possible.
3. **No backend.** The extension talks directly to the Gmail REST API via `chrome.identity`. There is no server, no Firebase, no telemetry, no third-party scripts. All state lives in `chrome.storage.local`.
4. **Open source, donate-funded.** Free forever. Donations go toward Chrome Web Store CASA fees so non-technical users can eventually one-click install. See [README.md](README.md).

## Architecture

```
Chrome extension (mail.google.com)
├── content/        MutationObserver on inbox rows
│                   sends thread IDs → background
│                   renders visual chip from classification result
│
├── background.js   chrome.identity → Gmail OAuth token
│                   Gmail API: threads.get format=metadata (headers only)
│                   classifier (header-only, pure JS)
│                   caches result in chrome.storage.local
│
└── popup/          on/off toggle, whitelist, blocklist, this-week stats
```

Everything runs in the extension. There is no Cloud Functions, no backend server, no Gmail writes.

## Required scopes

- `https://www.googleapis.com/auth/gmail.metadata` — read headers without body. The only scope requested.

The OAuth client ID is **not** committed to the repo. Each fork supplies its own (see [extension/README.md](extension/README.md) for setup).

## File structure

```
bulkspot/
├── README.md                   user-facing pitch + install
├── CLAUDE.md                   this file (architecture + design)
├── CONTRIBUTING.md             dev setup, PR rules
├── SECURITY.md                 vuln reporting
├── LICENSE                     Apache 2.0
├── bulk_email_signs.md         classifier reference: which headers signal bulk
├── .github/
│   ├── FUNDING.yml             donation handles
│   ├── ISSUE_TEMPLATE/         bug, false-positive, feature
│   └── PULL_REQUEST_TEMPLATE.md
└── extension/                  ← load this folder as unpacked extension
    ├── manifest.json           MV3 + oauth2 (placeholder client_id) + content scripts
    ├── background.js           service worker
    ├── content/
    │   ├── content.js          MutationObserver, thread-id extraction, chip rendering, popover
    │   └── chip.css            chip + popover styling
    ├── lib/
    │   ├── classifier.js       pure header-only classifier
    │   ├── gmailApi.js         metadata fetch (read-only)
    │   ├── whitelist.js        per-sender / per-domain allow rules
    │   ├── blocklist.js        per-sender / per-domain force-bulk rules
    │   ├── coldRelays.js       cold-outreach platform matcher
    │   └── coldRelays.data.js  hardcoded cold-outreach domain list
    ├── icons/
    └── popup/
        ├── popup.html          UI: on/off, whitelist, blocklist, stats
        └── popup.js
```

## How a single classification flows

1. Gmail loads. Content script's MutationObserver picks up each inbox row.
2. Content script extracts `threadId`, sends `{type: 'CLASSIFY', threadId}` to background.
3. Background checks `chrome.storage.local` cache → returns if hit.
4. Background calls `gmail.users.threads.get?id=...&format=metadata&metadataHeaders=...` (List-Unsubscribe, Feedback-ID, DKIM-Signature, etc.).
5. Headers run through `classifier.js` → `{isBulk, score, reasons}`.
6. Result cached in `chrome.storage.local` (capped at 5,000 threads).
7. Sent back to content script → renders visual chip next to the subject.

Gmail is never written to. No labels applied, no read state changed, no inbox mutations.

## Bulk classifier rules

Documented in [bulk_email_signs.md](bulk_email_signs.md). Header signals only:

- `List-Unsubscribe` / `List-Unsubscribe-Post` / `List-Id`
- `Precedence: bulk|list|junk`
- `Feedback-ID` (ESP-issued)
- DKIM `d=` matching known ESP domains (SendGrid, Mailgun, Mailchimp, etc.)
- Vendor `X-*` fingerprint headers
- `Return-Path` domain mismatch with `From`, VERP-style envelope local parts
- `From:` local-part suggesting automation (`noreply`, `notifications`, etc.)
- `Received: from api` (HTTP-API injection)
- Cold-outreach platform domains in the Received chain (Smartlead, Instantly, Apollo, etc.) — see [extension/lib/coldRelays.data.js](extension/lib/coldRelays.data.js)

Score threshold: `isBulk = score >= 5`. Tunable in `classifier.js`.

## Whitelist + blocklist

Both are simple per-sender / per-domain rule sets stored in `chrome.storage.local`:

- **Whitelist** forces a sender or domain to clean regardless of header signals.
- **Blocklist** forces a sender or domain to bulk regardless of header signals.

Both are managed via the chip popover and the popup UI.

## Build milestones

1. **OAuth + classifier** — `chrome.identity` Gmail token, fetch one message metadata, run classifier, console-log. ✅
2. **MutationObserver + chips** — observe rows, classify each, render visual chip. ✅
3. **Whitelist + popover** — click chip to whitelist sender/domain; local cache invalidation on change. ✅
4. **Blocklist** — force-bulk rules for senders/domains the classifier misses. ✅
5. **Open source release** — paywall + Firebase ripped out, public repo, donation funding. ✅
6. ~~**Real label writes**~~ — deliberately dropped. Applying labels requires `gmail.modify` (restricted scope, full read + write) which is disproportionate for a visual-chip product.

## What's deliberately out of scope

- **Body-content heuristics** (header-only catches ~80%; defer until v2)
- **Backfill of old inbox** (new mail only)
- **Any Gmail write** — no labeling, no archiving, no delete, no read-state changes. Pure-read by design.
- **Cross-device persistence** (chip lives in the browser tab; gone on mobile, gone on another computer — by design)
- **Cloud Functions / push notifications / any backend**
- **Telemetry**, even anonymous usage stats
- **Custom user rules UI** beyond whitelist + blocklist

## Risks to track

1. **Gmail DOM churn** — we parse `tr[data-legacy-thread-id]` etc. directly in [extension/content/content.js](extension/content/content.js). Gmail rewrites its inbox markup periodically; budget occasional selector fixes.
2. **Gmail API quota** — `threads.get` costs 5 quota units; throttle to 10/sec.
3. **Cold outreach blind spot** — Postal/Smartlead-style outreach that strips marketing headers won't be caught by metadata signals alone, only by the cold-relay domain match. Acceptable for v1.
4. **Chip is ephemeral** — lives in the browser tab only. Users who expect cross-device organization will be surprised; product copy must make this clear.
5. **OAuth client ID drift** — each fork supplies its own. The placeholder in `manifest.json` will fail loudly on first load if not replaced.
