function send(type, extra = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...extra }, resolve);
  });
}

async function refresh() {
  const [settingsRes, statsRes, wlRes, blRes, auth] = await Promise.all([
    send('GET_SETTINGS'),
    send('GET_STATS'),
    send('GET_WHITELIST'),
    send('GET_BLOCKLIST'),
    send('AUTH_STATUS')
  ]);

  const settings = settingsRes?.settings || { enabled: true };
  const stats = statsRes?.stats || {};
  const whitelist = wlRes?.whitelist;
  const blocklist = blRes?.blocklist;

  document.getElementById('enabled').checked = settings.enabled;
  const scannedEl = document.getElementById('scanned');
  const bulkEl = document.getElementById('bulk');
  const last7El = document.getElementById('last7');
  if (scannedEl) scannedEl.textContent = stats.totalScanned || 0;
  if (bulkEl) bulkEl.textContent = stats.totalBulk || 0;
  if (last7El) {
    const last7 = Object.values(stats.last7Days || {}).reduce((a, b) => a + b, 0);
    last7El.textContent = last7;
  }

  renderConnection(!!auth?.connected);
  renderWhitelist(whitelist);
  renderBlocklist(blocklist);
}

function renderConnection(connected) {
  const pill = document.getElementById('conn');
  const label = document.getElementById('conn-label');
  pill.classList.toggle('is-connected', connected);
  label.textContent = connected ? 'Connected' : 'Not connected';

  document.getElementById('connect').hidden = connected;
  document.getElementById('disconnect').hidden = !connected;
}

// Variant config — "white" and "block" render identically except for storage
// message types, empty-state copy, and the kind-badge color.
const LIST_VARIANTS = {
  white: {
    listId: 'wl-list',
    countId: 'wl-count',
    inputId: 'wl-input',
    addBtnId: 'wl-add-btn',
    kindClass: '',
    emptyHtml: 'Click any dot in Gmail to whitelist a sender or domain. Or add one below.',
    msgAddSender: 'ADD_WHITELIST_SENDER',
    msgAddDomain: 'ADD_WHITELIST_DOMAIN',
    msgRemoveSender: 'REMOVE_WHITELIST_SENDER',
    msgRemoveDomain: 'REMOVE_WHITELIST_DOMAIN',
    payloadKey: 'whitelist'
  },
  block: {
    listId: 'bl-list',
    countId: 'bl-count',
    inputId: 'bl-input',
    addBtnId: 'bl-add-btn',
    kindClass: 'is-block',
    emptyHtml: 'Always mark matching senders or domains as bulk.',
    msgAddSender: 'ADD_BLOCKLIST_SENDER',
    msgAddDomain: 'ADD_BLOCKLIST_DOMAIN',
    msgRemoveSender: 'REMOVE_BLOCKLIST_SENDER',
    msgRemoveDomain: 'REMOVE_BLOCKLIST_DOMAIN',
    payloadKey: 'blocklist'
  }
};

function renderList(variant, data) {
  const v = LIST_VARIANTS[variant];
  const { senders = [], domains = [] } = data || {};
  const total = senders.length + domains.length;

  document.getElementById(v.countId).textContent =
    total === 0 ? '' : `${total} ${total === 1 ? 'entry' : 'entries'}`;

  const list = document.getElementById(v.listId);
  const fragments = [];

  if (total === 0) {
    fragments.push(`<div class="wl-empty">${v.emptyHtml}</div>`);
  } else {
    const sortedSenders = [...senders].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    const sortedDomains = [...domains].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    const kindClass = v.kindClass ? ' ' + v.kindClass : '';

    for (const s of sortedSenders) {
      fragments.push(`
        <div class="wl-item">
          <span class="wl-item-kind${kindClass}">sender</span>
          <span class="wl-item-value" title="${escapeHtml(s.email)}">${escapeHtml(s.email)}</span>
          <button class="wl-item-remove" data-kind="sender" data-value="${escapeAttr(s.email)}" title="Remove">×</button>
        </div>`);
    }
    for (const d of sortedDomains) {
      fragments.push(`
        <div class="wl-item">
          <span class="wl-item-kind${kindClass}">domain</span>
          <span class="wl-item-value" title="${escapeHtml('@' + d.domain)}">@${escapeHtml(d.domain)}</span>
          <button class="wl-item-remove" data-kind="domain" data-value="${escapeAttr(d.domain)}" title="Remove">×</button>
        </div>`);
    }
  }

  fragments.push(`
    <div class="wl-add">
      <input type="text" id="${v.inputId}" placeholder="email@example.com or @domain.com" autocomplete="off" spellcheck="false" />
      <button id="${v.addBtnId}" type="button">Add</button>
    </div>`);

  const prevInput = document.getElementById(v.inputId);
  const prevValue = prevInput ? prevInput.value : '';
  const hadFocus = prevInput && document.activeElement === prevInput;
  list.innerHTML = fragments.join('');
  const newInput = document.getElementById(v.inputId);
  if (newInput) {
    newInput.value = prevValue;
    if (hadFocus) newInput.focus();
  }

  list.querySelectorAll('.wl-item-remove').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const kind = btn.dataset.kind;
      const value = btn.dataset.value;
      const type = kind === 'sender' ? v.msgRemoveSender : v.msgRemoveDomain;
      const payload = kind === 'sender' ? { type, email: value } : { type, domain: value };
      const res = await send(payload.type, payload);
      if (res?.ok) {
        renderList(variant, res[v.payloadKey]);
        status('Removed.');
      } else {
        status('Failed: ' + (res?.error || 'unknown'));
      }
    });
  });

  wireAddInput(variant);
}

function renderWhitelist(whitelist) { renderList('white', whitelist); }
function renderBlocklist(blocklist) { renderList('block', blocklist); }

// Parse a user-typed entry as either an email or a domain.
// Returns { kind: 'sender'|'domain', value } or null if unparseable.
function parseEntry(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (!v) return null;
  const emailMatch = v.match(/^([^\s@]+)@([^\s@]+\.[^\s@]+)$/);
  if (emailMatch) return { kind: 'sender', value: v };
  const domain = v.replace(/^@/, '');
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return { kind: 'domain', value: domain };
  return null;
}

function wireAddInput(variant) {
  const v = LIST_VARIANTS[variant];
  const input = document.getElementById(v.inputId);
  const btn = document.getElementById(v.addBtnId);
  if (!input || !btn) return;

  const submit = async () => {
    const parsed = parseEntry(input.value);
    if (!parsed) {
      status('Enter an email or a domain (e.g. @example.com).');
      return;
    }
    const type = parsed.kind === 'sender' ? v.msgAddSender : v.msgAddDomain;
    const payload = parsed.kind === 'sender'
      ? { type, email: parsed.value }
      : { type, domain: parsed.value };
    const res = await send(payload.type, payload);
    if (res?.ok) {
      input.value = '';
      renderList(variant, res[v.payloadKey]);
      status('Added.');
    } else {
      status('Failed: ' + (res?.error || 'unknown'));
    }
  };

  btn.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  });
}

document.getElementById('enabled').addEventListener('change', async (e) => {
  await send('SET_SETTINGS', { patch: { enabled: e.target.checked } });
  status(e.target.checked ? 'Enabled.' : 'Disabled.');
});

document.getElementById('connect').addEventListener('click', async () => {
  status('Requesting Gmail access…');
  const res = await send('CONNECT');
  if (res?.ok) {
    renderConnection(true);
    status('Connected.');
  } else {
    status(`Failed: ${res?.error || 'unknown'}`);
  }
});

document.getElementById('disconnect').addEventListener('click', async () => {
  if (!confirm('Disconnect Gmail? BulkSpot will stop classifying until you reconnect.')) return;
  status('Disconnecting…');
  const res = await send('DISCONNECT');
  if (res?.ok) {
    renderConnection(false);
    await refresh();
    status('Disconnected.');
  } else {
    status(`Failed: ${res?.error || 'unknown'}`);
  }
});

document.getElementById('clear').addEventListener('click', async () => {
  if (!confirm('Clear classification cache? Messages will be re-classified next time you view them.')) return;
  await send('CLEAR_CACHE');
  await refresh();
  status('Cache cleared.');
});

function status(msg) {
  const el = document.getElementById('status');
  el.textContent = msg;
  clearTimeout(status._t);
  status._t = setTimeout(() => (el.textContent = ''), 2500);
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function escapeAttr(s) {
  return escapeHtml(s);
}

refresh();
