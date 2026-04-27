// Gmail REST API wrapper. Uses chrome.identity for auth.
// All calls go to gmail.googleapis.com — never to mail.google.com.

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export async function getAccessToken({ interactive = false } = {}) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!token) {
        reject(new Error('No token returned'));
        return;
      }
      resolve(token);
    });
  });
}

export async function clearAccessToken(token) {
  return new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, () => resolve());
  });
}

// Revoke at Google's OAuth endpoint so the grant is removed server-side,
// then clear the local token cache. After this the user will see the
// consent screen again on the next CONNECT.
export async function revokeAccessToken() {
  let token;
  try {
    token = await getAccessToken({ interactive: false });
  } catch (_) {
    return; // nothing to revoke
  }
  try {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
  } catch (_) {
    // Network failure is non-fatal — still clear local cache.
  }
  await clearAccessToken(token);
  // Belt-and-braces: drop any other cached tokens for this extension.
  await new Promise((resolve) => {
    chrome.identity.clearAllCachedAuthTokens(() => resolve());
  });
}

async function api(path, { method = 'GET', body, retried = false } = {}) {
  const token = await getAccessToken();
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (res.status === 401 && !retried) {
    // Token expired/revoked — clear cache and retry once
    await clearAccessToken(token);
    return api(path, { method, body, retried: true });
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail API ${res.status}: ${text}`);
  }
  return res.json();
}

// Fetch one message's metadata-only headers.
export async function getMessageMetadata(messageId, headerNames) {
  const params = new URLSearchParams({ format: 'metadata' });
  for (const h of headerNames) params.append('metadataHeaders', h);
  return api(`/messages/${messageId}?${params.toString()}`);
}

// Fetch a thread, returning all messages (metadata only).
export async function getThreadMetadata(threadId, headerNames) {
  const params = new URLSearchParams({ format: 'metadata' });
  for (const h of headerNames) params.append('metadataHeaders', h);
  return api(`/threads/${threadId}?${params.toString()}`);
}

// Convert Gmail's [{name, value}] header array to a flat lowercase dict.
// Multi-occurrence headers (e.g. Received) are joined with " | " so we can
// scan all hops in the chain.
export function headersToDict(payloadHeaders = []) {
  const out = {};
  for (const { name, value } of payloadHeaders) {
    const key = name.toLowerCase();
    out[key] = out[key] ? out[key] + ' | ' + value : value;
  }
  return out;
}

