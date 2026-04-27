// Cold-outreach platform matcher.
// The domain list is hardcoded in coldRelays.data.js. To update the list,
// edit that file and reload the extension.

import { COLD_RELAY_DOMAINS } from './coldRelays.data.js';

const RELAY_SET = new Set(COLD_RELAY_DOMAINS.map((d) => d.toLowerCase()));

export async function getRelaySet() {
  return RELAY_SET;
}

// Walk a hostname's parents and return the first match in the relay set, else null.
// e.g. "f3.back.inback1.com" matches "inback1.com".
export function matchHost(host, relaySet = RELAY_SET) {
  if (!host || !relaySet?.size) return null;
  let h = host.toLowerCase();
  while (h) {
    if (relaySet.has(h)) return h;
    const dot = h.indexOf('.');
    if (dot === -1) return null;
    h = h.substring(dot + 1);
  }
  return null;
}

// Extract hostnames from a Received header string (possibly concatenated with " | ").
export function extractReceivedHosts(receivedStr) {
  if (!receivedStr) return [];
  const hosts = new Set();
  const re = /\b(?:from|by)\s+([a-z0-9][a-z0-9.\-]*[a-z0-9])\b/gi;
  let m;
  while ((m = re.exec(receivedStr)) !== null) {
    const h = m[1].toLowerCase();
    if (h.includes('.')) hosts.add(h);
  }
  return [...hosts];
}

// Returns the matching relay domain (string) if any host in the chain matches,
// else null.
export function matchReceivedChain(receivedStr, relaySet = RELAY_SET) {
  for (const host of extractReceivedHosts(receivedStr)) {
    const hit = matchHost(host, relaySet);
    if (hit) return hit;
  }
  return null;
}
