// Whitelist management — explicit "always allow" lists for senders and domains.
// Storage keys:
//   bd_whitelist_senders_v1 — [{ email, addedAt }]
//   bd_whitelist_domains_v1 — [{ domain, addedAt }]

const SENDERS_KEY = 'bd_whitelist_senders_v1';
const DOMAINS_KEY = 'bd_whitelist_domains_v1';

export async function getWhitelist() {
  const store = await chrome.storage.local.get([SENDERS_KEY, DOMAINS_KEY]);
  return {
    senders: store[SENDERS_KEY] || [],
    domains: store[DOMAINS_KEY] || []
  };
}

// Given a `From` header value (e.g. "Nick <nick@backlinklog.com>"), returns:
//   { kind: 'sender' | 'domain', value: string } if whitelisted, else null.
export async function matchWhitelist(fromHeader) {
  const email = extractEmail(fromHeader);
  if (!email) return null;

  const { senders, domains } = await getWhitelist();
  if (senders.some((s) => s.email === email)) {
    return { kind: 'sender', value: email };
  }
  const domain = email.split('@')[1] || '';
  if (domain && domains.some((d) => d.domain === domain)) {
    return { kind: 'domain', value: domain };
  }
  return null;
}

export async function addSender(email) {
  email = String(email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return null;
  const { senders } = await getWhitelist();
  if (senders.some((s) => s.email === email)) return senders;
  const next = [...senders, { email, addedAt: Date.now() }];
  await chrome.storage.local.set({ [SENDERS_KEY]: next });
  return next;
}

export async function addDomain(domain) {
  domain = String(domain || '').trim().toLowerCase().replace(/^@/, '');
  if (!domain || !domain.includes('.')) return null;
  const { domains } = await getWhitelist();
  if (domains.some((d) => d.domain === domain)) return domains;
  const next = [...domains, { domain, addedAt: Date.now() }];
  await chrome.storage.local.set({ [DOMAINS_KEY]: next });
  return next;
}

export async function removeSender(email) {
  email = String(email || '').toLowerCase();
  const { senders } = await getWhitelist();
  const next = senders.filter((s) => s.email !== email);
  await chrome.storage.local.set({ [SENDERS_KEY]: next });
  return next;
}

export async function removeDomain(domain) {
  domain = String(domain || '').toLowerCase();
  const { domains } = await getWhitelist();
  const next = domains.filter((d) => d.domain !== domain);
  await chrome.storage.local.set({ [DOMAINS_KEY]: next });
  return next;
}

// Parse "Name <email@domain>" or "email@domain" → "email@domain" (lowercase).
export function extractEmail(fromHeader) {
  if (!fromHeader) return null;
  const angle = fromHeader.match(/<([^>]+)>/);
  if (angle) return angle[1].trim().toLowerCase();
  const bare = fromHeader.match(/([^\s,<>"]+@[^\s,<>"]+)/);
  return bare ? bare[1].trim().toLowerCase() : null;
}

export function extractDisplayName(fromHeader) {
  if (!fromHeader) return null;
  const m = fromHeader.match(/^\s*"?([^"<]+?)"?\s*<[^>]+>/);
  return m ? m[1].trim() : null;
}
