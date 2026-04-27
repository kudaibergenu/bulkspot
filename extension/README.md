<p align="center">
  <img src="../logo.png" alt="BulkSpot logo" width="128">
</p>

# BulkSpot — Chrome extension

Header-based bulk email classifier for Gmail. Renders a visual chip next to each bulk row. No body inspection. Gmail is never mutated — no labels applied, no read state changed.

For project-level docs (why this exists, contributing, donations), see [../README.md](../README.md).

## One-time setup (required to make it actually run)

You need an **OAuth client ID** from Google Cloud Console. Without it, Chrome won't issue an auth token and the extension will fail at the first Gmail API call. You only need to do this once per fork.

### 1. Load the unpacked extension first (to get its ID)

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select this `extension/` folder
4. Copy the extension's ID from the card (long alphanumeric string)

The Connect button won't work yet — that's expected. You need the ID to create the OAuth client in the next step.

### 2. Create an OAuth client ID

1. Go to https://console.cloud.google.com/apis/credentials
2. Create or select a project of your own
3. Enable the **Gmail API** at https://console.cloud.google.com/apis/library/gmail.googleapis.com
4. Configure the OAuth consent screen if you haven't already:
   - User type: **External**
   - Add your own Google account as a **Test user** (otherwise OAuth will reject you with "access blocked")
   - Scopes: leave empty here, the extension declares them in the manifest
5. Back on the Credentials page → **Create Credentials → OAuth client ID**
   - Application type: **Chrome Extension**
   - Item ID: paste the extension ID from step 1.4
6. Copy the generated client ID (looks like `1234567890-abcdef.apps.googleusercontent.com`)

### 3. Wire the client ID into the manifest

Edit [manifest.json](manifest.json) and replace:

```
"client_id": "YOUR_OAUTH_CLIENT_ID.apps.googleusercontent.com"
```

with your actual client ID. Then go back to `chrome://extensions` and click the reload icon on the BulkSpot card.

> Tip: keep your client ID out of git. If you plan to push commits, copy `manifest.json` to `manifest.local.json` (it's in `.gitignore`), keep the real ID there, and swap it in before testing.

### 4. First-run consent

1. Open Gmail in a new tab.
2. Click the BulkSpot icon in the toolbar.
3. Click **Connect Gmail** in the popup.
4. Approve the consent screen — it asks for **one** scope:
   - Read email message metadata (headers only — no body, no send, no write)
5. Reload Gmail. You should see colored chips appearing on inbox rows.

## File map

```
extension/
├── manifest.json              MV3 + oauth2 + identity permission
├── background.js              service worker — OAuth, Gmail API, classification, settings, stats, whitelist, blocklist
├── content/
│   ├── content.js             MutationObserver, row → classify → chip + popover
│   └── chip.css               chip + popover styling
├── lib/
│   ├── classifier.js          pure header classifier (rules: ../bulk_email_signs.md)
│   ├── gmailApi.js            Gmail REST wrapper (read-only)
│   ├── whitelist.js           per-sender / per-domain allow rules
│   ├── blocklist.js           per-sender / per-domain force-bulk rules
│   ├── coldRelays.js          cold-outreach platform matcher
│   └── coldRelays.data.js     hardcoded cold-outreach domain list
├── icons/                     extension icons
└── popup/
    ├── popup.html             on/off toggle, whitelist, blocklist, stats
    └── popup.js
```

## How classification works

For each visible inbox row:

1. Content script extracts the thread ID from the DOM.
2. Background checks its in-memory cache — skip if already classified.
3. Background calls `gmail.users.threads.get?format=metadata&metadataHeaders=...` (cheap, headers only).
4. Headers run through `classifier.js` → `{isBulk, score, reasons}`.
5. Result sent back to content script → renders chip.

Gmail is never written to. The extension only ever reads headers.

## What's stored locally (`chrome.storage.local`)

- `bd_settings_v1` — `{enabled, threshold}`
- `bd_cache_v1` — `{threadId: {isBulk, score, reasons, cachedAt}}` — capped at 5,000 entries
- `bd_stats_v1` — counters `{totalScanned, totalBulk, last7Days}`
- `bd_whitelist_v1` — `{senders: [], domains: []}`
- `bd_blocklist_v1` — `{senders: [], domains: []}`

Nothing is sent to any third-party server. The only network calls are to `gmail.googleapis.com`.

## Limitations (known, accepted)

- **DOM selectors are brittle.** Gmail rewrites its inbox markup occasionally. When chips stop appearing, check `extractThreadId` and `findRows` in [content/content.js](content/content.js) — selectors may need updating.
- **Cold outreach.** Sales prospecting emails sent through Postal/Smartlead/Instantly that strip marketing headers won't be flagged. Header-only catches ~80% of bulk.
- **New mail only.** No backfill scan. Old inbox emails get classified as you scroll past them.
- **Single account.** The OAuth flow uses the user's currently-signed-in Chrome profile.

## Disconnecting

To revoke access:
1. Visit https://myaccount.google.com/permissions
2. Find your BulkSpot client → click → **Remove access**
3. Optionally remove the extension from `chrome://extensions`

Because the extension never writes to Gmail, there is nothing to clean up on Google's side — removing the extension removes all chips instantly, and there are no labels or filters left behind.
