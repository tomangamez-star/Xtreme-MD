const fs = require('fs');
const path = require('path');
const P = require('pino');
const qrcode = require('qrcode-terminal');
const {
  default: makeWASocket, useMultiFileAuthState, fetchLatestWaWebVersion,
  DisconnectReason, Browsers, downloadContentFromMessage, getContentType
} = require('@whiskeysockets/baileys');
const config = require('../config');
const { initDb, restoreAuth, backupAuth, getSetting } = require('./db');
const { textOf, parseCommand, digits, isOwner, quotedMessage } = require('./utils');
const { runCommand, reply } = require('./commands');

let status = 'starting';
let reconnecting = false;
let activeSocket = null;
let activeState = null;
let lastPairRequest = 0;
let suppressReconnectUntil = 0;
const getStatus = () => status;

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

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
  await wait(3000);
  return socket;
}

async function requestWebPairingCode(requestedNumber) {
  const number = String(requestedNumber || config.botNumber || '').replace(/\D/g, '');
  if (!/^\d{8,15}$/.test(number)) throw new Error('Enter a valid WhatsApp number with country code, without + or spaces.');
  if (activeState?.creds.registered) {
    const error = new Error('Xtreme MD is already paired.'); error.code = 'ALREADY_PAIRED'; throw error;
  }
  const now = Date.now();
  if (now - lastPairRequest < config.pairingCooldownMs) {
    const wait = Math.ceil((config.pairingCooldownMs - (now - lastPairRequest)) / 1000);
    const error = new Error(`Please wait ${wait} seconds before requesting another code.`); error.code = 'RATE_LIMITED'; throw error;
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

async function handleVV(sock, msg, text) {
  if (text.trim().toLowerCase() !== '.vv') return false;
  const q = quotedMessage(msg);
  if (!q) return reply(sock, msg, 'Reply to view-once media with *.vv*.'), true;
  let content = q.message.viewOnceMessageV2?.message || q.message.viewOnceMessage?.message || q.message;
  const type = getContentType(content);
  if (!['imageMessage','videoMessage','audioMessage'].includes(type)) return reply(sock,msg,'That message has no supported view-once media.'), true;
  const mediaType = type.replace('Message','');
  const stream = await downloadContentFromMessage(content[type], mediaType);
  const chunks=[]; for await(const chunk of stream) chunks.push(chunk);
  await sock.sendMessage(msg.key.remoteJid, { [mediaType]: Buffer.concat(chunks), caption: content[type].caption || 'Revealed by Xtreme MD' }, { quoted: msg });
  return true;
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
  await restoreAuth();
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

  sock.ev.on('creds.update', async () => { await saveCreds(); await backupAuth(); });
  sock.ev.on('connection.update', async update => {
    if (update.qr) qrcode.generate(update.qr, { small: true });
    if (update.connection === 'open') { status = 'online'; reconnecting = false; console.log('[WHATSAPP] Xtreme MD online'); await backupAuth(); }
    if (update.connection === 'close') {
      status = 'offline';
      const code = update.lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.restartRequired) {
        suppressReconnectUntil = 0;
        if (!reconnecting) { reconnecting = true; setTimeout(() => startBot().catch(console.error), 1000); }
        return;
      }
      if (code === DisconnectReason.loggedOut) return console.error('[WHATSAPP] Logged out. Clear the stored session and pair again.');
      if (Date.now() < suppressReconnectUntil) return;
      if (!reconnecting) { reconnecting = true; setTimeout(() => startBot().catch(console.error), 4000); }
    }
  });

  sock.ev.on('group-participants.update', async event => {
    const metadata = await sock.groupMetadata(event.id).catch(() => null); if (!metadata) return;
    for (const participant of event.participants) {
      const command = event.action === 'add' ? 'welcome' : event.action === 'remove' ? 'goodbye' : null;
      if (!command || await getSetting(`${command}:${event.id}`, 'off') !== 'on') continue;
      const text = command === 'welcome' ? `⚡ Welcome @${digits(participant)} to *${metadata.subject}*!\nYou just entered the Xtreme side.` : `👋 @${digits(participant)} left *${metadata.subject}*.`;
      const payload = { text, mentions: [participant] };
      if (config.welcomeImage && command === 'welcome') {
        payload.image = /^https?:/i.test(config.welcomeImage) ? { url: config.welcomeImage } : fs.readFileSync(config.welcomeImage);
        payload.caption = text; delete payload.text;
      }
      await sock.sendMessage(event.id, payload);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (!msg.message || msg.key.remoteJid === 'status@broadcast') continue;
      const started = Date.now();
      const text = textOf(msg); const sender = msg.key.participantAlt || msg.key.participant || msg.key.remoteJid;
      if (await handleVV(sock, msg, text)) continue;
      const isGroup = msg.key.remoteJid.endsWith('@g.us');
      let metadata = null, participants = [], admins = [];
      if (isGroup) { metadata = await sock.groupMetadata(msg.key.remoteJid); participants = metadata.participants; admins = participants.filter(p => p.admin).map(p => digits(p.id)); if (await handleGroupProtections(sock,msg,text,metadata,sender)) continue; }
      const parsed = parseCommand(text); if (!parsed) continue;
      if (!config.publicMode && !isOwner(sender)) continue;
      const botJid = sock.user.id;
      const context = { sock, msg, ...parsed, sender: msg.key.participantAlt || sender, started, isGroup, participants, mentions: msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [], isAdmin: participants.some(p => p.admin && [p.id, p.phoneNumber, p.lid].filter(Boolean).some(j => [sender, msg.key.participant].filter(Boolean).some(s => digits(j) === digits(s)))), isBotAdmin: participants.some(p => p.admin && [p.id, p.phoneNumber, p.lid].filter(Boolean).some(j => [botJid, sock.user.lid].filter(Boolean).some(b => digits(j) === digits(b)))) };
      try { await runCommand(context); } catch (error) { console.error(`[COMMAND ${parsed.command}]`, error.message); await reply(sock,msg,'❌ That command failed. Try again shortly.'); }
    }
  });
  return sock;
}

module.exports = { startBot, getStatus, requestWebPairingCode };
