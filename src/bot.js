const fs = require('fs');
const path = require('path');
const P = require('pino');
const qrcode = require('qrcode-terminal');
const {
  default: makeWASocket, useMultiFileAuthState, fetchLatestWaWebVersion,
  DisconnectReason, Browsers, downloadContentFromMessage, getContentType
} = require('@whiskeysockets/baileys');
const config = require('../config');
const { initDb, restoreAuth, backupAuth, getSetting, clearAuth } = require('./db');
const { textOf, parseCommand, digits, isOwner, isLidJid, senderJids, isOwnerSender, quotedMessage } = require('./utils');
const { runCommand } = require('./commands');
const { buildWelcomeCard } = require('./welcome-card');

let status = 'starting';
let reconnecting = false;
let activeSocket = null;
let activeState = null;
let lastPairRequest = 0;
let suppressReconnectUntil = 0;
let sessionRestored = false;
let reconnectTimer = null;
const getStatus = () => status;
const getConnectionInfo = () => ({
  status,
  number: activeSocket?.user?.id ? digits(activeSocket.user.id) : null
});

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// --- Transient-error detection & throttle backoff ---------------------------
// WhatsApp throttling ("rate-overlimit", HTTP 429, a stream error carrying 429) is
// not a real failure: it is the server asking us to slow down. These must never be
// reported to the owner, and repeated hits must not cause a tight retry loop.
const THROTTLE_BASE_MS = 1000;
const THROTTLE_MAX_MS = 30000;
let throttleUntil = 0;
let throttleStreak = 0;

// True for throttling / rate-limit errors from Baileys, the socket layer or fetch.
// Checks the numeric status fields first, then the message text, so it catches both
// `{ output: { statusCode: 429 } }` and a bare `Error('rate-overlimit')`.
function isTransientError(error) {
  if (!error) return false;
  const codes = [
    error.status, error.statusCode, error.code,
    error.output?.statusCode, error.data?.status, error.attrs?.code
  ];
  if (codes.some(code => Number(code) === 429)) return true;
  const text = [
    error.message, error.name, error.type,
    error.output?.payload?.message, error.data?.message
  ].filter(Boolean).join(' ').toLowerCase();
  return /rate[-_ ]?overlimit|rate[-_ ]?limit|too many requests|\b429\b/.test(text);
}

// Record a throttle hit and return the backoff delay. The delay doubles per
// consecutive hit (1s, 2s, 4s ... capped at 30s) and resets on the next success.
function noteThrottle() {
  throttleStreak = Math.min(throttleStreak + 1, 6);
  const delay = Math.min(THROTTLE_MAX_MS, THROTTLE_BASE_MS * 2 ** (throttleStreak - 1));
  throttleUntil = Date.now() + delay;
  return delay;
}

function resetThrottle() {
  throttleStreak = 0;
  throttleUntil = 0;
}

// True while we are backing off after throttling; messages are dropped meanwhile.
const isThrottled = () => Date.now() < throttleUntil;

async function createFreshPairingSocket() {
  suppressReconnectUntil = Date.now() + 120000;
  reconnecting = false;
  const previous = activeSocket;
  activeSocket = null;
  activeState = null;
  if (previous) {
    try { previous.end(new Error('Refreshing pairing connection')); } catch {}
  }
  await wait(350);
  const socket = await startBot();
  await wait(1000);
  return socket;
}

async function requestWebPairingCode(requestedNumber) {
  const number = String(requestedNumber || config.botNumber || '').replace(/\D/g, '');
  if (!/^\d{8,15}$/.test(number)) throw new Error('Enter a valid WhatsApp number with country code, without + or spaces.');
  if (activeState?.creds.registered) {
    const error = new Error('Xtreme MD is already paired. Unpair the current number first.'); error.code = 'ALREADY_PAIRED'; throw error;
  }
  const now = Date.now();
  if (now - lastPairRequest < config.pairingCooldownMs) {
    const waitSeconds = Math.ceil((config.pairingCooldownMs - (now - lastPairRequest)) / 1000);
    const error = new Error(`Please wait ${waitSeconds} seconds before requesting another code.`); error.code = 'RATE_LIMITED'; throw error;
  }
  lastPairRequest = now;
  let socket = await createFreshPairingSocket();
  let raw;
  try {
    raw = await socket.requestPairingCode(number);
  } catch (firstError) {
    console.warn(`[PAIRING] First connection failed, retrying: ${firstError.message}`);
    await wait(1000);
    socket = await createFreshPairingSocket();
    raw = await socket.requestPairingCode(number);
  }
  const code = String(raw).replace(/[^a-z0-9]/gi, '').toUpperCase();
  suppressReconnectUntil = Date.now() + 120000;
  return { code, number: number.replace(/^(\d{3})\d+(\d{4})$/, '$1••••••$2') };
}

async function unpairWebSession() {
  const previous = activeSocket;
  status = 'unpairing';
  suppressReconnectUntil = Date.now() + 120000;
  reconnecting = false;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  activeSocket = null;
  activeState = null;

  // Ask WhatsApp to revoke the linked device before removing local credentials.
  if (previous) {
    try { await previous.logout(); }
    catch (error) { console.warn(`[UNPAIR] Remote logout returned: ${error.message}`); }
    try { previous.end(new Error('WhatsApp session unpaired by dashboard')); } catch {}
  }

  await clearAuth();
  const sessionDir = path.join(process.cwd(), 'session');
  fs.rmSync(sessionDir, { recursive: true, force: true });
  fs.mkdirSync(sessionDir, { recursive: true });
  status = 'offline';

  // Start a clean, unregistered socket so the next number can request a code.
  await wait(500);
  await startBot();
  return { ok: true, status: 'offline' };
}

async function unwrapMessage(message) {
  let current = message;
  for (let i = 0; i < 5 && current; i++) {
    const next = current.ephemeralMessage?.message ||
      current.viewOnceMessageV2?.message ||
      current.viewOnceMessageV2Extension?.message ||
      current.viewOnceMessage?.message;
    if (!next) break;
    current = next;
  }
  return current;
}

// Resolve the owner's personal-chat JID. Prefers the configured owner number and
// falls back to the bot's own account when no owner is set.
function ownerJidFor(sock) {
  if (config.ownerNumbers.length) return `${config.ownerNumbers[0]}@s.whatsapp.net`;
  const selfJid = sock.user?.id;
  if (!selfJid) return null;
  return selfJid.includes('@') ? selfJid : `${digits(selfJid)}@s.whatsapp.net`;
}

// Every diagnostic for `cute` goes to the owner's DM and nowhere else. The chat
// where the command was used must stay completely silent, so this never throws.
async function notifyOwner(sock, ownerJid, text) {
  if (!ownerJid) return;
  try {
    await sock.sendMessage(ownerJid, { text });
  } catch (error) {
    console.warn(`[CUTE] Owner notice failed: ${error.message}`);
  }
}

// Resolve a LID to its phone number through the socket's LID<->PN store. Returns
// null when the mapping is unknown so callers can fall back safely.
async function pnForLid(sock, jid) {
  if (!isLidJid(jid)) return null;
  try {
    const pn = await sock?.signalRepository?.lidMapping?.getPNForLID?.(jid);
    return pn ? digits(pn) : null;
  } catch {
    return null;
  }
}

// True when the message was sent by a configured owner. Baileys puts the sender in
// different key fields depending on how the message was addressed: in a PN-addressed
// group message `participant` is the phone number and `participantAlt` is the LID,
// while a LID-addressed message is the other way round. Checking a single field
// therefore misses the owner half the time, so we test every plausible field and fall
// back to the LID<->PN store for senders that only carry a LID.
async function isOwnerRequest(sock, msg) {
  const owners = config.ownerNumbers;
  if (!owners.length) return false;
  if (isOwnerSender(msg)) return true;
  for (const jid of senderJids(msg)) {
    if (!isLidJid(jid)) continue;
    const pn = await pnForLid(sock, jid);
    if (pn && owners.includes(pn)) return true;
  }
  return false;
}

async function handleVV(sock, msg, text, deps = {}) {
  const download = deps.download || downloadContentFromMessage;
  if (text.trim().toLowerCase() !== 'cute') return false;

  // Owner-only, and silent for everyone else: a non-owner gets no reply, no
  // usage hint, no warning, no reaction and no read-receipt change. We return
  // before any send to the originating chat, and swallow every error so nothing
  // can surface in that chat or as an unhandled rejection.
  const ownerJid = ownerJidFor(sock);
  let owner = false;
  try {
    owner = await isOwnerRequest(sock, msg);
  } catch (error) {
    // A failed owner check must never leak into the triggering chat, so we treat it
    // as a non-owner and report the failure to the owner's DM instead.
    console.warn(`[CUTE] Owner check failed: ${error.message}`);
    await notifyOwner(sock, ownerJid, `\u274c *cute* owner check failed: ${error.message}`);
    return true;
  }
  if (!owner) {
    // Silent in the triggering chat: no reply, no usage hint, no warning, no
    // reaction, no read-receipt change. The owner still gets the diagnostic in
    // their DM, and notifyOwner never throws, so nothing can surface here.
    const seen = senderJids(msg).map(digits).filter(Boolean).join(', ') || 'unknown';
    console.log(`[CUTE] Ignored non-owner request from ${seen}`);
    await notifyOwner(sock, ownerJid, `\u26a0\ufe0f Ignored *cute* from non-owner ${seen} in ${msg.key.remoteJid}.`);
    return true;
  }

  try {
    const q = quotedMessage(msg);
    if (!q) {
      await notifyOwner(sock, ownerJid, 'Reply to a view-once image, video or audio with *cute*.');
      return true;
    }
    const content = await unwrapMessage(q.message);
    const type = getContentType(content);
    if (!['imageMessage', 'videoMessage', 'audioMessage'].includes(type)) {
      await notifyOwner(sock, ownerJid, 'That message has no supported view-once media.');
      return true;
    }

    const media = content[type];
    const mediaType = type.replace('Message', '');
    const stream = await download(media, mediaType);
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);
    if (!sock.user?.id) {
      await notifyOwner(sock, ownerJid, 'The bot account is not ready yet. Try again shortly.');
      return true;
    }

    // Build the media payload once, then send it twice in two different forms.
    const buildPayload = () => {
      if (mediaType === 'audio') {
        return { audio: buffer, mimetype: media.mimetype || 'audio/mpeg', ptt: Boolean(media.ptt) };
      }
      const payload = { [mediaType]: buffer };
      if (media.caption) payload.caption = media.caption;
      else if (mediaType === 'image' || mediaType === 'video') payload.caption = 'Recovered with Xtreme MD';
      return payload;
    };

    // 1) View-once copy in the chat where the command was used.
    //    Baileys wraps any payload carrying `viewOnce: true` in a viewOnceMessage
    //    envelope, so the recipient can open it exactly once and it then disappears.
    const chatJid = msg.key.remoteJid;
    await sock.sendMessage(chatJid, { ...buildPayload(), viewOnce: true }, { quoted: msg });

    // 2) Normal, permanently viewable copy in the owner's personal chat.
    //    A failure here must never break the command that already succeeded above.
    try {
      await sock.sendMessage(ownerJid, buildPayload());
    } catch (error) {
      console.warn(`[CUTE] Personal-chat copy failed: ${error.message}`);
      await notifyOwner(sock, ownerJid, '\u26a0\ufe0f Sent as view-once here, but the copy to your personal chat failed.');
    }
  } catch (error) {
    // Throttling is transient, not a failure: back off and stay silent.
    if (isTransientError(error)) {
      noteThrottle();
      console.warn('[CUTE] Throttled, backing off');
      return true;
    }
    console.warn(`[CUTE] Failed: ${error.message}`);
    await notifyOwner(sock, ownerJid, `\u274c *cute* failed: ${error.message}`);
  }
  return true;
}

// Build the context object every command handler receives. Kept separate from the
// dispatch path so the owner gate can run before any of this work happens.
function buildContext(sock, msg, parsed, metadata, started) {
  const isGroup = msg.key.remoteJid.endsWith('@g.us');
  const participants = metadata?.participants || [];
  const sender = msg.key.participantAlt || msg.key.participant || msg.key.remoteJid;
  const botJid = sock.user?.id;
  const same = (a, b) => Boolean(a) && Boolean(b) && digits(a) === digits(b);
  return {
    sock, msg, ...parsed, sender, started, isGroup, participants,
    mentions: msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [],
    isAdmin: participants.some(p => p.admin && [p.id, p.phoneNumber, p.lid].filter(Boolean).some(j => same(j, sender) || same(j, msg.key.participant))),
    isBotAdmin: participants.some(p => p.admin && [p.id, p.phoneNumber, p.lid].filter(Boolean).some(j => same(j, botJid) || same(j, sock.user?.lid)))
  };
}

// The single owner gate every command passes through. It runs before dispatch, so a
// new command is covered automatically without touching its handler.
//
// Non-owner: absolutely nothing is sent to the originating chat — no error, no usage
// hint, no "owner only" notice, no reaction, no read-receipt change. We return before
// any send to that chat; the only output is a diagnostic to the owner's DM.
// Owner: the command runs exactly as before, and any failure is reported to the owner
// DM instead of the chat where the command was used.
//
// Returns true when the message was consumed (blocked, run, or failed) and false when
// it is not a command at all. Never throws: notifyOwner swallows its own errors.
async function handleCommand(sock, msg, text, deps = {}) {
  const parsed = parseCommand(text);
  if (!parsed) return false;

  const run = deps.runCommand || runCommand;
  const ownerJid = ownerJidFor(sock);

  let owner = false;
  try {
    owner = await isOwnerRequest(sock, msg);
  } catch (error) {
    // A failed owner check must never leak into the triggering chat.
    console.warn(`[GUARD] Owner check failed: ${error.message}`);
    await notifyOwner(sock, ownerJid, `\u274c Owner check failed for *${parsed.command}*: ${error.message}`);
    return true;
  }

  if (!owner) {
    const seen = senderJids(msg).map(digits).filter(Boolean).join(', ') || 'unknown';
    console.log(`[GUARD] Ignored non-owner *${parsed.command}* from ${seen}`);
    await notifyOwner(sock, ownerJid, `\u26a0\ufe0f Ignored *${parsed.command}* from non-owner ${seen} in ${msg.key.remoteJid}.`);
    return true;
  }

  try {
    const started = deps.started || Date.now();
    const metadata = deps.metadata || (msg.key.remoteJid.endsWith('@g.us') ? await sock.groupMetadata(msg.key.remoteJid) : null);
    await run(buildContext(sock, msg, parsed, metadata, started));
  } catch (error) {
    // Only the `cute` handler may report to the owner DM. Every other command's
    // failure is swallowed: one local log line, nothing user-visible anywhere.
    if (isTransientError(error)) {
      noteThrottle();
      console.warn(`[COMMAND] ${parsed.command} throttled, backing off`);
      return true;
    }
    console.warn(`[COMMAND] ${parsed.command}: ${error.message}`);
    if (parsed.command === 'cute') {
      await notifyOwner(sock, ownerJid, `\u274c *cute* failed: ${error.message}`);
    }
  }
  return true;
}

// Process one incoming message. This is the single top-level error boundary for the
// whole message path, so it decides what may ever become user-visible.
//
// Rule: only errors from the `cute` handler may reach the owner's DM (and handleVV
// reports those itself). Everything else — other commands, message handling, the
// socket layer, Baileys — is swallowed: one local log line, no DM, no chat message.
// Throttling errors are dropped entirely and trigger a backoff instead.
// Never throws, so nothing can surface as an unhandled rejection.
async function handleMessage(sock, msg, deps = {}) {
  if (!msg?.message || msg.key?.remoteJid === 'status@broadcast') return false;

  // Backoff window: drop messages while throttled so we do not retry in a tight loop.
  if (isThrottled()) return false;

  try {
    const text = textOf(msg);
    if (await handleVV(sock, msg, text, deps)) { resetThrottle(); return true; }

    const sender = msg.key.participantAlt || msg.key.participant || msg.key.remoteJid;
    const isGroup = msg.key.remoteJid.endsWith('@g.us');
    let metadata = deps.metadata || null;
    if (isGroup) {
      metadata = metadata || await sock.groupMetadata(msg.key.remoteJid);
      if (await handleGroupProtections(sock, msg, text, metadata, sender)) { resetThrottle(); return true; }
    }
    // Every command goes through the central owner gate. A non-owner is ignored
    // completely, and any failure is reported to the owner DM only.
    await handleCommand(sock, msg, text, { ...deps, metadata });
    resetThrottle();
    return true;
  } catch (error) {
    if (isTransientError(error)) {
      noteThrottle();
      console.warn('[MESSAGE] Throttled, backing off');
      return false;
    }
    // Swallowed: a single local log line, never a DM and never a chat message.
    console.warn(`[MESSAGE] ${error.message}`);
    return false;
  }
}

async function handleGroupProtections(sock, msg, text, metadata, sender) {
  const jid = msg.key.remoteJid;
  const mode = await getSetting(`antilink:${jid}`, 'off');
  if (mode === 'off' || !/(chat\.whatsapp\.com|https?:\/\/)/i.test(text)) return false;
  const admins = metadata.participants.filter(p => p.admin).map(p => digits(p.id));
  if (admins.includes(digits(sender)) || isOwner(sender)) return false;
  await sock.sendMessage(jid, { delete: msg.key });
  if (mode === 'on') await sock.groupParticipantsUpdate(jid, [sender], 'remove');
  else await sock.sendMessage(jid, { text: mode === 'warn' ? `⚠️ @${digits(sender)}, links are not allowed.` : '🚫 Link deleted.', mentions: [sender] });
  return true;
}

async function startBot() {
  await initDb();
  if (!sessionRestored) {
    const restored = await restoreAuth();
    sessionRestored = true;
    if (!restored.persistent) console.warn('[AUTH] DATABASE_URL is unavailable. Pairing will not survive a fresh Render deploy.');
  }
  const { state, saveCreds } = await useMultiFileAuthState(path.join(process.cwd(), 'session'));
  const { version } = await fetchLatestWaWebVersion();
  console.log(`[WHATSAPP] Using live web version ${version.join('.')}`);
  const sock = makeWASocket({
    version,
    auth: state,
    logger: P({ level: 'silent' }),
    browser: Browsers.macOS('Chrome'),
    printQRInTerminal: false,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: undefined,
    keepAliveIntervalMs: 30000,
    qrTimeout: 180000,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: true
  });
  activeSocket = sock;
  activeState = state;

  sock.ev.on('creds.update', async () => {
    if (sock !== activeSocket) return;
    try { await saveCreds(); await backupAuth(); }
    catch (error) { console.warn(`[AUTH] Credential save failed: ${error.message}`); }
  });
  sock.ev.on('connection.update', async update => {
    if (sock !== activeSocket) return;
    if (update.qr) qrcode.generate(update.qr, { small: true });
    if (update.connection === 'open') { status = 'online'; reconnecting = false; console.log('[WHATSAPP] Xtreme MD online'); await backupAuth(); }
    if (update.connection === 'close') {
      status = 'offline';
      const code = update.lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.restartRequired) {
        suppressReconnectUntil = 0;
        scheduleReconnect(1000);
        return;
      }
      if (code === DisconnectReason.loggedOut) return console.error('[WHATSAPP] Logged out. Clear the stored session and pair again.');
      if (Date.now() < suppressReconnectUntil) return;
      scheduleReconnect(4000);
    }
  });

  sock.ev.on('group-participants.update', async event => {
    const metadata = await sock.groupMetadata(event.id).catch(() => null); if (!metadata) return;
    for (const participant of event.participants) {
      const command = event.action === 'add' ? 'welcome' : event.action === 'remove' ? 'goodbye' : null;
      if (!command || await getSetting(`${command}:${event.id}`, 'off') !== 'on') continue;
      const text = command === 'welcome' ? `⚡ *@${digits(participant)} synchronized successfully.*\n\nWelcome to *${metadata.subject}*.\nYou are member *#${metadata.participants.length}*.\n\n> Read the rules.\n> Respect the circle.\n> Run the chat.` : `👋 @${digits(participant)} left *${metadata.subject}*.`;
      const payload = { text, mentions: [participant] };
      if (command === 'welcome') {
        try {
          payload.image = await buildWelcomeCard({ sock, participant, metadata });
          payload.caption = text; delete payload.text;
        } catch (error) {
          console.warn(`[WELCOME] Dynamic card failed, sending text: ${error.message}`);
        }
      }
      await sock.sendMessage(event.id, payload);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      // handleMessage owns the error boundary: it never throws and never reports
      // anything to the owner except errors from the `cute` handler.
      await handleMessage(sock, msg);
    }
  });
  return sock;
}

function scheduleReconnect(delayMs) {
  if (reconnecting || reconnectTimer) return;
  reconnecting = true;
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    try { await startBot(); }
    catch (error) {
      reconnecting = false;
      console.error('[RECONNECT]', error.message);
      scheduleReconnect(10000);
    }
  }, delayMs);
}

module.exports = {
  startBot, getStatus, getConnectionInfo, requestWebPairingCode, unpairWebSession,
  handleVV, handleCommand, handleMessage, buildContext,
  isTransientError, noteThrottle, resetThrottle, isThrottled
};
