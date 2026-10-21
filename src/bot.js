const fs = require('fs');
const path = require('path');
const P = require('pino');
const qrcode = require('qrcode-terminal');
const {
  default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion,
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
const getStatus = () => status;

async function requestWebPairingCode() {
  if (!config.botNumber) throw new Error('BOT_NUMBER is not configured on the server.');
  if (!activeSocket || !activeState) throw new Error('WhatsApp connection is still starting. Try again shortly.');
  if (activeState.creds.registered) {
    const error = new Error('Xtreme MD is already paired.'); error.code = 'ALREADY_PAIRED'; throw error;
  }
  const now = Date.now();
  if (now - lastPairRequest < config.pairingCooldownMs) {
    const wait = Math.ceil((config.pairingCooldownMs - (now - lastPairRequest)) / 1000);
    const error = new Error(`Please wait ${wait} seconds before requesting another code.`); error.code = 'RATE_LIMITED'; throw error;
  }
  lastPairRequest = now;
  const raw = await activeSocket.requestPairingCode(config.botNumber);
  const code = String(raw).replace(/\s|-/g, '').match(/.{1,4}/g)?.join('-') || raw;
  return { code, number: config.botNumber.replace(/^(\d{3})\d+(\d{4})$/, '$1••••••$2') };
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
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({ version, auth: state, logger: P({ level: 'silent' }), browser: Browsers.ubuntu('Xtreme MD'), markOnlineOnConnect: false, syncFullHistory: false, generateHighQualityLinkPreview: true });
  activeSocket = sock;
  activeState = state;

  sock.ev.on('creds.update', async () => { await saveCreds(); await backupAuth(); });
  sock.ev.on('connection.update', async update => {
    if (update.qr) qrcode.generate(update.qr, { small: true });
    if (update.connection === 'open') { status = 'online'; reconnecting = false; console.log('[WHATSAPP] Xtreme MD online'); await backupAuth(); }
    if (update.connection === 'close') {
      status = 'offline';
      const code = update.lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) return console.error('[WHATSAPP] Logged out. Clear the stored session and pair again.');
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
      const text = textOf(msg); const sender = msg.key.participant || msg.key.remoteJid;
      if (await handleVV(sock, msg, text)) continue;
      const isGroup = msg.key.remoteJid.endsWith('@g.us');
      let metadata = null, participants = [], admins = [];
      if (isGroup) { metadata = await sock.groupMetadata(msg.key.remoteJid); participants = metadata.participants; admins = participants.filter(p => p.admin).map(p => digits(p.id)); if (await handleGroupProtections(sock,msg,text,metadata,sender)) continue; }
      const parsed = parseCommand(text); if (!parsed) continue;
      if (!config.publicMode && !isOwner(sender)) continue;
      const botJid = sock.user.id;
      const context = { sock, msg, ...parsed, sender, started, isGroup, participants, mentions: msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [], isAdmin: admins.includes(digits(sender)), isBotAdmin: admins.includes(digits(botJid)) };
      try { await runCommand(context); } catch (error) { console.error(`[COMMAND ${parsed.command}]`, error.message); await reply(sock,msg,'❌ That command failed. Try again shortly.'); }
    }
  });
  return sock;
}

module.exports = { startBot, getStatus, requestWebPairingCode };
