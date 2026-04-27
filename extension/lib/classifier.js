// Pure header-only bulk-email classifier.
// Input: header dict (lowercase keys recommended).
// Output: { isBulk, score, reasons }.
// Rules documented in /bulk_email_signs.md.

const ESP_DKIM_DOMAINS = [
  'sendgrid.net', 'sendgrid.info',
  'mailgun.org', 'mailgun.net',
  'amazonses.com',
  'mcsv.net', 'mailchimp.com', 'mailchimpapp.net',
  'mandrillapp.com',
  'sparkpostmail.com',
  'klaviyomail.com',
  'customeriomail.com',
  'sendinblue.com', 'sib.email', 'brevo.com',
  'hubspotemail.net', 'hubspotemail-eu1.net',
  'pardot.com',
  'marketo.com', 'mktomail.com',
  'eloqua.com', 'eloquaemail.com',
  'constantcontact.com', 'rsgsv.net',
  'cmail19.com', 'cmail20.com',
  'iterable.com',
  'braze.com',
  'convertkit-mail.com',
  'substack.com'
];

const ESP_HEADER_PREFIXES = [
  'x-mailgun-', 'x-sg-', 'x-mc-', 'x-mandrill-', 'x-campaign',
  'x-csa-complaints', 'x-postal-msgid', 'x-mailchimp-', 'x-mc-user',
  'x-feedback-id', 'x-job', 'x-ses-', 'x-amzn-', 'x-cm-message-id'
];

const NOREPLY_LOCALS = [
  'noreply', 'no-reply', 'donotreply', 'do-not-reply',
  'notifications', 'notification', 'mailer', 'newsletter'
];

const FUNCTIONAL_LOCALS = new Set([
  'info', 'hello', 'contact', 'team', 'support', 'help',
  'sales', 'marketing', 'billing', 'hr', 'admin', 'press',
  'startups', 'partners', 'events', 'community', 'updates',
  'news', 'announce', 'announcements', 'digest', 'alerts',
]);

const FREEMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com',
  'yahoo.com', 'yahoo.co.uk', 'yahoo.fr', 'yahoo.de',
  'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'icloud.com', 'me.com', 'mac.com',
  'proton.me', 'protonmail.com',
  'aol.com', 'gmx.com', 'gmx.de', 'mail.ru', 'yandex.com', 'yandex.ru',
  'zoho.com'
]);

// Subject-line phrases characteristic of B2B cold sales pitches.
// Tested together with FREEMAIL_DOMAINS — combination is very rarely legitimate.
const PITCH_SUBJECT_PATTERNS = [
  // Explicit sales/partnership pitches
  /\bnewsletter placement\b/i,
  /\bplacement slot\b/i,
  /\bplacement for\b/i,
  /\bmedia kit\b/i,
  /\bsponsorship\b/i,
  /\bcollaboration with\b/i,
  /\bfeature your\b/i,
  /\bfeaturing your\b/i,
  /\bgrowth partnership\b/i,
  /\bbacklink\b/i,
  /\bguest post\b/i,
  /\bgrowth hacking\b/i,
  /\bdirectory submission\b/i,
  /\bpromote your\b/i,
  /\blisting on\b/i,
  // Clickbait / disarming cold-email openers
  /\burgent question\b/i,
  /\bquick question\b/i,
  /\bquick favor\b/i,
  /\bquick chat\b/i,
  /\bquick ask\b/i,
  /\bjust wondering\b/i,
  /\bopportunity for\b/i,
  /\byou(?:['’]?re| are) missing\b/i,
  /\bmost brands (?:ignore|miss|overlook|skip)\b/i
];

export const DEFAULT_THRESHOLD = 5;

// Detect calendar invitations (Google Calendar, Outlook/Exchange, iCal).
// Returns a reason string if invitation, else null.
function detectInvitation(h) {
  const sender = (h['sender'] || '').toLowerCase();
  if (sender.includes('calendar-notification@google.com')) return 'Google Calendar invite (Sender)';

  const msgId = (h['message-id'] || '').toLowerCase();
  if (/^<calendar-/.test(msgId)) return 'Google Calendar invite (Message-ID)';

  const contentType = (h['content-type'] || '').toLowerCase();
  if (contentType.includes('text/calendar')) return 'iCal content-type';
  if (/method\s*=\s*(request|cancel|reply|counter)/i.test(contentType)) return 'iCal method in Content-Type';

  for (const k in h) {
    if (k.startsWith('x-microsoft-cdo-')) return 'Outlook calendar event (X-MICROSOFT-CDO)';
  }

  const subject = h['subject'] || '';
  if (/^(Invitation:|Updated invitation:|Accepted:|Declined:|Tentative:|Canceled event:)/i.test(subject)) {
    return `Calendar subject prefix: "${subject.split(':')[0]}:"`;
  }

  return null;
}

// classify(headers, options)
//   options.threshold — score cutoff for isBulk (default 5)
//   options.coldRelayMatch — string|null — pre-computed relay match from Received
//                            chain. Pass null/undefined to skip. When non-null, scores +4.
//   options.whitelisted — { kind: 'sender'|'domain', value: string } | null —
//                         if non-null, short-circuit as clean regardless of other signals.
//   options.blocklisted — { kind: 'sender'|'domain', value: string } | null —
//                         if non-null, short-circuit as bulk. Wins over whitelist.
//
// Returns { type: 'bulk' | 'clean', isBulk, score, reasons }
export function classify(headers, options = {}) {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const coldRelayMatch = options.coldRelayMatch || null;
  const whitelisted = options.whitelisted || null;
  const blocklisted = options.blocklisted || null;
  const reasons = [];
  let score = 0;

  const h = {};
  for (const k in headers) h[k.toLowerCase()] = headers[k];

  // Blocklist short-circuit — user explicitly said "always treat as bulk".
  // Wins over whitelist and every other rule so a conflicting double-add
  // can't accidentally let a blocked sender through.
  if (blocklisted) {
    return {
      type: 'bulk',
      isBulk: true,
      score: 999,
      reasons: [`Blocklisted ${blocklisted.kind}: ${blocklisted.value}`],
      blocklisted
    };
  }

  // Whitelist short-circuit — user explicitly said "always allow" for this
  // sender or domain. Takes precedence over every other rule.
  if (whitelisted) {
    return {
      type: 'clean',
      isBulk: false,
      score: 0,
      reasons: [`Whitelisted ${whitelisted.kind}: ${whitelisted.value}`],
      whitelisted
    };
  }

  // Invitations short-circuit as clean — they are NOT bulk and get the
  // same green chip as regular personal mail. We keep the detection so
  // marketing-ish signals in calendar invites don't trip bulk scoring.
  const inviteReason = detectInvitation(h);
  if (inviteReason) {
    return {
      type: 'clean',
      isBulk: false,
      score: 0,
      reasons: [inviteReason]
    };
  }

  if (h['list-unsubscribe']) {
    score += 5;
    reasons.push('List-Unsubscribe present');
  }
  if (h['list-unsubscribe-post']) {
    score += 2;
    reasons.push('List-Unsubscribe-Post (one-click)');
  }
  if (h['list-id']) {
    score += 3;
    reasons.push('List-Id present');
  }

  const prec = (h['precedence'] || '').toLowerCase();
  if (prec === 'bulk' || prec === 'list' || prec === 'junk') {
    score += 4;
    reasons.push(`Precedence: ${prec}`);
  }

  const autoSub = (h['auto-submitted'] || '').toLowerCase();
  if (autoSub && autoSub !== 'no') {
    score += 3;
    reasons.push(`Auto-Submitted: ${autoSub}`);
  }

  if (h['feedback-id']) {
    score += 4;
    reasons.push('Feedback-ID (ESP-issued)');
  }

  for (const key in h) {
    for (const prefix of ESP_HEADER_PREFIXES) {
      if (key.startsWith(prefix)) {
        score += 3;
        reasons.push(`ESP fingerprint: ${key}`);
        break;
      }
    }
  }

  const dkim = (h['dkim-signature'] || '').toLowerCase();
  const auth = (h['authentication-results'] || '').toLowerCase();
  const dkimText = dkim + ' ' + auth;
  for (const d of ESP_DKIM_DOMAINS) {
    if (
      dkimText.includes('d=' + d) ||
      dkimText.includes('header.d=' + d) ||
      dkimText.includes('header.i=@' + d)
    ) {
      score += 4;
      reasons.push(`DKIM signed by ESP: ${d}`);
      break;
    }
  }

  const returnPath = (h['return-path'] || '').toLowerCase();
  const from = (h['from'] || '').toLowerCase();
  if (returnPath && from) {
    const rpDomain = (returnPath.match(/@([^>]+)/) || [])[1] || '';
    const fromDomain = (from.match(/@([^> ]+)/) || [])[1] || '';
    if (rpDomain && fromDomain && !rpDomain.endsWith(fromDomain) && !fromDomain.endsWith(rpDomain)) {
      score += 2;
      reasons.push(`Return-Path (${rpDomain}) ≠ From (${fromDomain})`);
    }
    const rpLocal = (returnPath.match(/<?([^@<>]+)@/) || [])[1] || '';
    if (/(^|\.)(bounces?|psrp|mta|return|fwd)\./i.test(rpDomain) && /^[a-z0-9][a-z0-9_\-\.=+]{5,}$/i.test(rpLocal)) {
      score += 2;
      reasons.push(`VERP envelope: ${rpLocal}@${rpDomain}`);
    }
  }

  const fromLocal = (from.match(/<?([^@<>"]+)@/) || [])[1] || '';
  for (const n of NOREPLY_LOCALS) {
    if (fromLocal.toLowerCase().includes(n)) {
      score += 3;
      reasons.push(`From local-part: ${fromLocal}`);
      break;
    }
  }

  // Generic/functional department address (info@, team@, startups@, etc.).
  // Not a person's name — almost always automated when combined with other
  // signals like Gmail API injection. Worth +2 alone, not enough to trigger.
  if (FUNCTIONAL_LOCALS.has(fromLocal.toLowerCase())) {
    score += 2;
    reasons.push(`Functional From address: ${fromLocal}@`);
  }

  const received = (h['received'] || '').toLowerCase();
  if (/\bfrom\s+api\s+\(/i.test(received)) {
    score += 3;
    reasons.push('HTTP API injection (Received: from api)');
  }

  // Gmail API programmatic send (Google Workspace automation, Apps Script,
  // CRM integrations). Third-party mail clients can also use this path, so
  // keep the weight at +3 — not enough to trigger on its own.
  if (/\bby\s+gmailapi\.google\.com\s+with\s+httprest\b/i.test(received)) {
    score += 3;
    reasons.push('Gmail API injection (gmailapi.google.com HTTPREST)');
  }

  // UUID-shaped hostname (e.g. "from abcd1234-...-abcdef.local") — cold
  // outreach platforms spin up per-send sending identities with UUID tags.
  // Real mail clients never produce this pattern.
  if (/\bfrom\s+[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.local\b/i.test(received)) {
    score += 4;
    reasons.push('UUID hostname in Received chain (platform fingerprint)');
  }

  // Freemail sender + pitch-phrase subject = almost always cold outreach
  // from a human operator using a personal Gmail/Yahoo/etc. account.
  const senderDomain = (from.match(/@([^> ]+)/) || [])[1] || '';
  const subject = h['subject'] || '';
  if (FREEMAIL_DOMAINS.has(senderDomain)) {
    for (const pat of PITCH_SUBJECT_PATTERNS) {
      if (pat.test(subject)) {
        score += 4;
        reasons.push(`Freemail sender + pitch subject ("${pat.source.replace(/\\b/g, '')}")`);
        break;
      }
    }
  }

  // UUID v4 Message-ID local part (e.g. <a7ef28a9-4726-...-ef882c31@domain>).
  // Normal mail clients (Gmail, Outlook, Apple Mail) never produce this
  // pattern. Cold outreach platforms (Instantly, Smartlead, Woodpecker,
  // custom setups) almost always do.
  const msgId = (h['message-id'] || '').toLowerCase();
  if (/^<[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@/i.test(msgId)) {
    score += 3;
    reasons.push('UUID Message-ID (outreach platform fingerprint)');
  }

  if (coldRelayMatch) {
    score += 4;
    reasons.push(`Cold-outreach platform in Received chain: ${coldRelayMatch}`);
  }

  const isBulk = score >= threshold;
  return {
    type: isBulk ? 'bulk' : 'clean',
    isBulk,
    score,
    reasons
  };
}

// List of headers we ask Gmail API to return (format=metadata).
export const METADATA_HEADERS = [
  'List-Unsubscribe', 'List-Unsubscribe-Post', 'List-Id',
  'Precedence', 'Auto-Submitted', 'Feedback-ID',
  'DKIM-Signature', 'Authentication-Results',
  'Return-Path', 'From', 'Received',
  'X-Mailer', 'X-Mailgun-Tag', 'X-SG-EID', 'X-Mandrill-User',
  'X-Postal-MsgID', 'X-Feedback-ID', 'X-Campaign',
  // For invitation detection:
  'Sender', 'Subject', 'Message-ID', 'Content-Type',
  'X-Microsoft-CDO-Ownerapptid', 'X-Microsoft-CDO-Importance'
];
