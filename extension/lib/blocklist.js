// Blocklist management — explicit "always treat as bulk" lists for senders and domains.
// Mirror of whitelist.js. Storage keys:
//   bd_blocklist_senders_v1 — [{ email, addedAt }]
//   bd_blocklist_domains_v1 — [{ domain, addedAt }]

import { extractEmail } from './whitelist.js';

const SENDERS_KEY = 'bd_blocklist_senders_v1';
const DOMAINS_KEY = 'bd_blocklist_domains_v1';

export async function getBlocklist() {
  const store = await chrome.storage.local.get([SENDERS_KEY, DOMAINS_KEY]);
  return {
    senders: store[SENDERS_KEY] || [],
    domains: store[DOMAINS_KEY] || []
  };
}

// Given a `From` header, returns { kind, value } if blocklisted, else null.
export async function matchBlocklist(fromHeader) {
  const email = extractEmail(fromHeader);
  if (!email) return null;

  const { senders, domains } = await getBlocklist();
  if (senders.some((s) => s.email === email)) {
    return { kind: 'sender', value: email };
  }
  const domain = email.split('@')[1] || '';
  if (domain && domains.some((d) => d.domain === domain)) {
    return { kind: 'domain', value: domain };
  }
  return null;
}

export async function addBlockedSender(email) {
  email = String(email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return null;
  const { senders } = await getBlocklist();
  if (senders.some((s) => s.email === email)) return senders;
  const next = [...senders, { email, addedAt: Date.now() }];
  await chrome.storage.local.set({ [SENDERS_KEY]: next });
  return next;
}

export async function addBlockedDomain(domain) {
  domain = String(domain || '').trim().toLowerCase().replace(/^@/, '');
  if (!domain || !domain.includes('.')) return null;
  const { domains } = await getBlocklist();
  if (domains.some((d) => d.domain === domain)) return domains;
  const next = [...domains, { domain, addedAt: Date.now() }];
  await chrome.storage.local.set({ [DOMAINS_KEY]: next });
  return next;
}

export async function removeBlockedSender(email) {
  email = String(email || '').toLowerCase();
  const { senders } = await getBlocklist();
  const next = senders.filter((s) => s.email !== email);
  await chrome.storage.local.set({ [SENDERS_KEY]: next });
  return next;
}

export async function removeBlockedDomain(domain) {
  domain = String(domain || '').toLowerCase();
  const { domains } = await getBlocklist();
  const next = domains.filter((d) => d.domain !== domain);
  await chrome.storage.local.set({ [DOMAINS_KEY]: next });
  return next;
}
