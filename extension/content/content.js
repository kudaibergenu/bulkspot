// BulkSpot content script.
// Watches Gmail's inbox for new rows, extracts thread IDs, asks the
// background service worker to classify, and renders a colored dot.
// Clicking the dot opens an Apple-style popover with whitelist actions.

const QUEUE = [];
const QUEUED = new Set();
const MAX_INFLIGHT = 3;
let inflight = 0;

// In-memory mirror of background's bd_cache_v1. Populated once at start and
// kept in sync via chrome.storage.onChanged. Lets us render chips synchronously
// on cache hit, avoiding the service-worker round-trip flicker on refresh.
const CACHE_KEY = 'bd_cache_v1';
let CACHE = {};

// ---------- thread-id extraction ----------

function extractThreadId(row) {
  const directLegacy = row.getAttribute('data-legacy-thread-id');
  if (directLegacy) return normalizeThreadId(directLegacy);

  const nestedLegacy = row.querySelector('[data-legacy-thread-id]');
  if (nestedLegacy) {
    const v = nestedLegacy.getAttribute('data-legacy-thread-id');
    if (v) return normalizeThreadId(v);
  }

  const directThread = row.getAttribute('data-thread-id');
  if (directThread) return normalizeThreadId(directThread);
  const nestedThread = row.querySelector('[data-thread-id]');
  if (nestedThread) {
    const v = nestedThread.getAttribute('data-thread-id');
    if (v) return normalizeThreadId(v);
  }

  const anchor = row.querySelector('a[href*="#"]');
  if (anchor) {
    const m = anchor.getAttribute('href').match(/#[^/]+\/([0-9a-f]{10,})/i);
    if (m) return m[1];
  }
  return null;
}

function normalizeThreadId(id) {
  if (!id) return null;
  return id.replace(/^#/, '').replace(/^thread-f:/, '').replace(/^msg-f:/, '');
}

function findRows(root) {
  if (!root.querySelectorAll) return [];
  const sels = [
    'tr[data-legacy-thread-id]',
    'tr[data-thread-id]',
    'div[role="main"] tr[role][jsmodel]',
    'div[role="main"] tr.zA'
  ];
  for (const s of sels) {
    const found = root.querySelectorAll(s);
    if (found.length) return Array.from(found);
  }
  return [];
}

// ---------- chip rendering ----------

const CHIP_CLASS = {
  bulk: 'bd-bulk',
  clean: 'bd-clean'
};

function renderChip(row, result) {
  const existing = row.querySelector('.bd-chip');
  if (existing) existing.remove();

  const type = result.type || (result.isBulk ? 'bulk' : 'clean');
  const cls = CHIP_CLASS[type] || CHIP_CLASS.clean;

  const chip = document.createElement('span');
  chip.className = 'bd-chip ' + cls;
  if (result.whitelisted) chip.classList.add('bd-whitelisted');
  chip.setAttribute('role', 'button');
  chip.setAttribute(
    'aria-label',
    type === 'bulk' ? 'Classified as bulk' : 'Classified as clean'
  );
  chip.title = (result.reasons || []).join(' · ');

  // Stash the classification on the element so the popover can read it.
  chip.__bdResult = result;

  chip.addEventListener('click', onChipClick);
  chip.addEventListener('mousedown', (e) => e.stopPropagation()); // don't open the thread

  const subjectSpan = row.querySelector('.bog');
  if (subjectSpan && subjectSpan.parentElement) {
    subjectSpan.parentElement.insertBefore(chip, subjectSpan);
    return;
  }
  const snippetCell = row.querySelector('td.a4W');
  if (snippetCell) {
    snippetCell.insertBefore(chip, snippetCell.firstChild);
    return;
  }
  row.insertBefore(chip, row.firstChild);
}

// ---------- classification orchestration ----------

function needsProcessing(row, threadId) {
  if (row.dataset.bdThread !== threadId) return true;
  if (!row.querySelector('.bd-chip')) return true;
  return false;
}

async function processRow(row) {
  const threadId = extractThreadId(row);
  if (!threadId) return;
  if (!needsProcessing(row, threadId)) return;

  // Fast path: synchronous render from in-memory cache.
  const cached = CACHE[threadId];
  if (cached) {
    renderChip(row, cached);
    row.dataset.bdThread = threadId;
    row.dataset.bdType = cached.type || (cached.isBulk ? 'bulk' : 'clean');
    return;
  }

  try {
    const res = await chrome.runtime.sendMessage({ type: 'CLASSIFY', threadId });
    if (!res?.ok) return;
    renderChip(row, res.result);
    row.dataset.bdThread = threadId;
    row.dataset.bdType = res.result.type || (res.result.isBulk ? 'bulk' : 'clean');
    CACHE[threadId] = res.result;
  } catch (e) {
    // background reloading — silently skip
  }
}

function pump() {
  while (inflight < MAX_INFLIGHT && QUEUE.length) {
    const row = QUEUE.shift();
    QUEUED.delete(row);
    inflight++;
    processRow(row).finally(() => inflight--);
  }
}

function enqueue(rows) {
  for (const r of rows) {
    if (QUEUED.has(r)) continue;
    QUEUED.add(r);
    QUEUE.push(r);
  }
}

function scanAll() {
  enqueue(findRows(document));
}

// Clear all chip state on this page (used when background broadcasts
// BD_INVALIDATE after whitelist/cache changes).
function invalidateAll() {
  document.querySelectorAll('.bd-chip').forEach((c) => c.remove());
  document.querySelectorAll('[data-bd-thread]').forEach((r) => {
    delete r.dataset.bdThread;
    delete r.dataset.bdType;
  });
  closePopover();
  scanAll();
}

// ---------- popover ----------

let openPopoverEl = null;

function closePopover() {
  if (openPopoverEl) {
    openPopoverEl.classList.add('bd-pop-leaving');
    const el = openPopoverEl;
    openPopoverEl = null;
    setTimeout(() => el.remove(), 120);
  }
  document.removeEventListener('keydown', onPopoverKey, true);
  document.removeEventListener('mousedown', onPopoverOutside, true);
}

function onPopoverKey(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    closePopover();
  }
}

function onPopoverOutside(e) {
  if (openPopoverEl && !openPopoverEl.contains(e.target)) closePopover();
}

function onChipClick(e) {
  e.preventDefault();
  e.stopPropagation();
  const chip = e.currentTarget;
  const result = chip.__bdResult;
  if (!result) return;
  openPopover(chip, result);
}

function buildPopover(result) {
  const type = result.type || (result.isBulk ? 'bulk' : 'clean');
  const isWhitelisted = !!result.whitelisted;
  const fromName = result.fromName || result.fromEmail || 'this sender';
  const fromEmail = result.fromEmail || '';
  const fromDomain = result.fromDomain || '';

  const reasons = (result.reasons || [])
    .map((r) => `<li class="bd-pop-reason">${escapeHtml(r)}</li>`)
    .join('');

  const isBlocklisted = !!result.blocklisted;
  const headerLabel = isBlocklisted
    ? 'Blocklisted'
    : isWhitelisted
    ? 'Whitelisted'
    : type === 'bulk'
    ? 'Bulk'
    : 'Clean';

  const statusClass = isBlocklisted
    ? 'bd-pop-status-bulk'
    : isWhitelisted
    ? 'bd-pop-status-whitelisted'
    : type === 'bulk'
    ? 'bd-pop-status-bulk'
    : 'bd-pop-status-clean';

  // Actions depend on current state. Bulk → whitelist (allow); clean → blocklist (force bulk).
  let actionsHtml = '';
  if (isBlocklisted) {
    const kind = result.blocklisted.kind;
    const value = result.blocklisted.value;
    actionsHtml = `
      <button class="bd-pop-btn bd-pop-btn-secondary" data-action="unblock-${kind}" data-value="${escapeAttr(value)}">
        Remove from blocklist
      </button>`;
  } else if (isWhitelisted) {
    const kind = result.whitelisted.kind;
    const value = result.whitelisted.value;
    actionsHtml = `
      <button class="bd-pop-btn bd-pop-btn-secondary" data-action="remove-${kind}" data-value="${escapeAttr(value)}">
        Remove from whitelist
      </button>`;
  } else if (type === 'bulk') {
    const senderBtn = fromEmail
      ? `<button class="bd-pop-btn bd-pop-btn-primary" data-action="add-sender" data-value="${escapeAttr(fromEmail)}">
           Always allow ${escapeHtml(truncate(fromName, 28))}
         </button>`
      : '';
    const domainBtn = fromDomain
      ? `<button class="bd-pop-btn bd-pop-btn-secondary" data-action="add-domain" data-value="${escapeAttr(fromDomain)}">
           Always allow anyone at @${escapeHtml(fromDomain)}
         </button>`
      : '';
    actionsHtml = senderBtn + domainBtn;
  } else {
    const senderBtn = fromEmail
      ? `<button class="bd-pop-btn bd-pop-btn-primary" data-action="block-sender" data-value="${escapeAttr(fromEmail)}">
           Always mark ${escapeHtml(truncate(fromName, 28))} as bulk
         </button>`
      : '';
    const domainBtn = fromDomain
      ? `<button class="bd-pop-btn bd-pop-btn-secondary" data-action="block-domain" data-value="${escapeAttr(fromDomain)}">
           Always mark @${escapeHtml(fromDomain)} as bulk
         </button>`
      : '';
    actionsHtml = senderBtn + domainBtn;
  }

  return `
    <div class="bd-pop-header">
      <span class="bd-pop-status ${statusClass}">${headerLabel}</span>
      ${fromEmail ? `<span class="bd-pop-from">${escapeHtml(fromEmail)}</span>` : ''}
    </div>
    ${reasons ? `<ul class="bd-pop-reasons">${reasons}</ul>` : ''}
    ${actionsHtml ? `<div class="bd-pop-actions">${actionsHtml}</div>` : ''}
  `;
}

function openPopover(anchorEl, result) {
  closePopover();

  const pop = document.createElement('div');
  pop.className = 'bd-popover';
  pop.innerHTML = buildPopover(result);

  // Hook up action buttons.
  pop.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const action = btn.dataset.action;
      const value = btn.dataset.value;

      btn.disabled = true;
      btn.textContent = 'Saving…';
      let type = null;
      if (action === 'add-sender') type = 'ADD_WHITELIST_SENDER';
      else if (action === 'add-domain') type = 'ADD_WHITELIST_DOMAIN';
      else if (action === 'remove-sender') type = 'REMOVE_WHITELIST_SENDER';
      else if (action === 'remove-domain') type = 'REMOVE_WHITELIST_DOMAIN';
      else if (action === 'block-sender') type = 'ADD_BLOCKLIST_SENDER';
      else if (action === 'block-domain') type = 'ADD_BLOCKLIST_DOMAIN';
      else if (action === 'unblock-sender') type = 'REMOVE_BLOCKLIST_SENDER';
      else if (action === 'unblock-domain') type = 'REMOVE_BLOCKLIST_DOMAIN';
      if (!type) return;
      const payload = { type };
      if (type.endsWith('SENDER')) payload.email = value;
      if (type.endsWith('DOMAIN')) payload.domain = value;
      const res = await chrome.runtime.sendMessage(payload);
      if (res?.ok) {
        closePopover();
        // The background broadcasts BD_INVALIDATE to all Gmail tabs → chips re-render.
      } else {
        btn.textContent = 'Failed — try again';
        setTimeout(() => (btn.disabled = false), 900);
      }
    });
  });

  document.body.appendChild(pop);
  positionPopover(pop, anchorEl);

  openPopoverEl = pop;
  // Defer listeners so the click that opened the popover doesn't immediately close it.
  setTimeout(() => {
    document.addEventListener('mousedown', onPopoverOutside, true);
    document.addEventListener('keydown', onPopoverKey, true);
  }, 0);
}

function positionPopover(pop, anchorEl) {
  const r = anchorEl.getBoundingClientRect();
  const popRect = pop.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const gap = 10;

  let top = r.bottom + gap;
  let left = r.left + r.width / 2 - popRect.width / 2;

  // Flip above if no room below.
  if (top + popRect.height > vh - 8) {
    top = r.top - popRect.height - gap;
  }
  // Clamp horizontal bounds.
  left = Math.max(8, Math.min(left, vw - popRect.width - 8));

  pop.style.top = `${Math.round(top)}px`;
  pop.style.left = `${Math.round(left)}px`;
}

// ---------- utilities ----------

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
function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// ---------- bootstrap ----------

async function loadCache() {
  try {
    const { [CACHE_KEY]: c } = await chrome.storage.local.get(CACHE_KEY);
    CACHE = c || {};
  } catch (_) {
    CACHE = {};
  }
}

async function start() {
  await loadCache();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[CACHE_KEY]) return;
    CACHE = changes[CACHE_KEY].newValue || {};
  });

  scanAll();
  setInterval(pump, 400);
  setInterval(scanAll, 2000);

  const obs = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.matches?.('tr')) enqueue([node]);
        else enqueue(findRows(node));
      }
      if (m.type === 'childList' && m.target?.nodeType === 1) {
        const tr = m.target.closest?.('tr');
        if (tr) enqueue([tr]);
      }
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'BD_INVALIDATE') invalidateAll();
  });

  console.info('[BulkSpot] content script started');
}

function waitForGmail() {
  if (document.querySelector('div[role="main"]')) {
    start();
    return;
  }
  const obs = new MutationObserver(() => {
    if (document.querySelector('div[role="main"]')) {
      obs.disconnect();
      start();
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
}

waitForGmail();
