// BulkSpot service worker.
// Owns: OAuth, Gmail API calls, classification orchestration, settings, stats, whitelist.

import { classify, METADATA_HEADERS } from './lib/classifier.js';
import {
  getAccessToken,
  revokeAccessToken,
  getThreadMetadata,
  headersToDict
} from './lib/gmailApi.js';
import { matchReceivedChain } from './lib/coldRelays.js';
import {
  getWhitelist,
  matchWhitelist,
  addSender,
  addDomain,
  removeSender,
  removeDomain,
  extractEmail,
  extractDisplayName
} from './lib/whitelist.js';
import {
  getBlocklist,
  matchBlocklist,
  addBlockedSender,
  addBlockedDomain,
  removeBlockedSender,
  removeBlockedDomain
} from './lib/blocklist.js';

const CACHE_KEY = 'bd_cache_v1';
const SETTINGS_KEY = 'bd_settings_v1';
const STATS_KEY = 'bd_stats_v1';

const DEFAULT_SETTINGS = {
  enabled: true,
  threshold: 5
};

// ---------- storage helpers ----------

async function getSettings() {
  const { [SETTINGS_KEY]: s } = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(s || {}) };
}

async function setSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

async function getCache() {
  const { [CACHE_KEY]: c } = await chrome.storage.local.get(CACHE_KEY);
  return c || {};
}

async function cacheResult(threadId, result) {
  const cache = await getCache();
  cache[threadId] = { ...result, cachedAt: Date.now() };
  const keys = Object.keys(cache);
  if (keys.length > 5000) {
    keys.sort((a, b) => cache[a].cachedAt - cache[b].cachedAt);
    for (const k of keys.slice(0, keys.length - 5000)) delete cache[k];
  }
  await chrome.storage.local.set({ [CACHE_KEY]: cache });
}

async function getStats() {
  const { [STATS_KEY]: s } = await chrome.storage.local.get(STATS_KEY);
  return s || { totalScanned: 0, totalBulk: 0, last7Days: {} };
}

async function bumpStats(isBulk) {
  const stats = await getStats();
  stats.totalScanned += 1;
  if (isBulk) stats.totalBulk += 1;
  const today = new Date().toISOString().slice(0, 10);
  stats.last7Days[today] = (stats.last7Days[today] || 0) + (isBulk ? 1 : 0);
  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  for (const d of Object.keys(stats.last7Days)) {
    if (d < cutoff) delete stats.last7Days[d];
  }
  await chrome.storage.local.set({ [STATS_KEY]: stats });
}

// ---------- core classification ----------

async function classifyThread(threadId) {
  const cache = await getCache();
  if (cache[threadId]) return cache[threadId];

  const settings = await getSettings();
  if (!settings.enabled) return { isBulk: false, score: 0, reasons: ['disabled'] };

  const thread = await getThreadMetadata(threadId, METADATA_HEADERS);
  const firstMsg = thread.messages?.[0];
  if (!firstMsg) {
    const empty = { isBulk: false, score: 0, reasons: ['no messages'] };
    await cacheResult(threadId, empty);
    return empty;
  }

  const headers = headersToDict(firstMsg.payload?.headers || []);
  const coldRelayMatch = matchReceivedChain(headers['received'] || '');
  const whitelisted = await matchWhitelist(headers['from']);
  const blocklisted = await matchBlocklist(headers['from']);

  const result = classify(headers, {
    threshold: settings.threshold,
    coldRelayMatch,
    whitelisted,
    blocklisted
  });

  // Enrich result with sender info for the popover UI.
  const email = extractEmail(headers['from']);
  result.fromEmail = email;
  result.fromName = extractDisplayName(headers['from']);
  result.fromDomain = email ? email.split('@')[1] : null;

  await cacheResult(threadId, result);
  await bumpStats(result.isBulk);

  return result;
}

// ---------- Gmail-tab invalidation ----------
// After any whitelist or cache mutation, ask every open Gmail tab to re-scan.
async function broadcastInvalidate() {
  const tabs = await chrome.tabs.query({ url: 'https://mail.google.com/*' });
  for (const t of tabs) {
    try {
      await chrome.tabs.sendMessage(t.id, { type: 'BD_INVALIDATE' });
    } catch (_) {
      // Tab may not have content script loaded yet — ignore.
    }
  }
}

// ---------- message router ----------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {
        case 'CLASSIFY':
          sendResponse({ ok: true, result: await classifyThread(msg.threadId) });
          break;

        case 'GET_SETTINGS':
          sendResponse({ ok: true, settings: await getSettings() });
          break;
        case 'SET_SETTINGS':
          sendResponse({ ok: true, settings: await setSettings(msg.patch) });
          break;

        case 'GET_STATS':
          sendResponse({ ok: true, stats: await getStats() });
          break;

        case 'CONNECT':
          await getAccessToken({ interactive: true });
          sendResponse({ ok: true });
          break;

        case 'AUTH_STATUS': {
          let connected = false;
          try {
            await getAccessToken({ interactive: false });
            connected = true;
          } catch (_) {
            connected = false;
          }
          sendResponse({ ok: true, connected });
          break;
        }

        case 'DISCONNECT':
          await revokeAccessToken();
          await chrome.storage.local.remove(CACHE_KEY);
          await broadcastInvalidate();
          sendResponse({ ok: true });
          break;

        case 'CLEAR_CACHE':
          await chrome.storage.local.remove(CACHE_KEY);
          await broadcastInvalidate();
          sendResponse({ ok: true });
          break;

        // ---- whitelist ----
        case 'GET_WHITELIST':
          sendResponse({ ok: true, whitelist: await getWhitelist() });
          break;
        case 'ADD_WHITELIST_SENDER':
          await addSender(msg.email);
          await chrome.storage.local.remove(CACHE_KEY);
          await broadcastInvalidate();
          sendResponse({ ok: true, whitelist: await getWhitelist() });
          break;
        case 'ADD_WHITELIST_DOMAIN':
          await addDomain(msg.domain);
          await chrome.storage.local.remove(CACHE_KEY);
          await broadcastInvalidate();
          sendResponse({ ok: true, whitelist: await getWhitelist() });
          break;
        case 'REMOVE_WHITELIST_SENDER':
          await removeSender(msg.email);
          await chrome.storage.local.remove(CACHE_KEY);
          await broadcastInvalidate();
          sendResponse({ ok: true, whitelist: await getWhitelist() });
          break;
        case 'REMOVE_WHITELIST_DOMAIN':
          await removeDomain(msg.domain);
          await chrome.storage.local.remove(CACHE_KEY);
          await broadcastInvalidate();
          sendResponse({ ok: true, whitelist: await getWhitelist() });
          break;

        // ---- blocklist ----
        case 'GET_BLOCKLIST':
          sendResponse({ ok: true, blocklist: await getBlocklist() });
          break;
        case 'ADD_BLOCKLIST_SENDER':
          await addBlockedSender(msg.email);
          await chrome.storage.local.remove(CACHE_KEY);
          await broadcastInvalidate();
          sendResponse({ ok: true, blocklist: await getBlocklist() });
          break;
        case 'ADD_BLOCKLIST_DOMAIN':
          await addBlockedDomain(msg.domain);
          await chrome.storage.local.remove(CACHE_KEY);
          await broadcastInvalidate();
          sendResponse({ ok: true, blocklist: await getBlocklist() });
          break;
        case 'REMOVE_BLOCKLIST_SENDER':
          await removeBlockedSender(msg.email);
          await chrome.storage.local.remove(CACHE_KEY);
          await broadcastInvalidate();
          sendResponse({ ok: true, blocklist: await getBlocklist() });
          break;
        case 'REMOVE_BLOCKLIST_DOMAIN':
          await removeBlockedDomain(msg.domain);
          await chrome.storage.local.remove(CACHE_KEY);
          await broadcastInvalidate();
          sendResponse({ ok: true, blocklist: await getBlocklist() });
          break;

        default:
          sendResponse({ ok: false, error: 'unknown message type' });
      }
    } catch (e) {
      console.error('[BulkSpot] handler error', msg.type, e);
      sendResponse({ ok: false, error: e.message });
    }
  })();
  return true; // async response
});

console.info('[BulkSpot] background ready');
