const { jidNormalizedUser, getContentType } = require('@whiskeysockets/baileys');
const config = require('../config');

const digits = jid => String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
// A LID JID is `user@lid` or `user:device@lid` (also `@hosted.lid`). The device
// suffix must be stripped before testing the domain, or a device-suffixed LID is
// wrongly treated as a phone number.
const isLidJid = jid => /@(?:hosted\.)?lid$/i.test(String(jid || '').split(':').pop());
const isOwner = jid => [...config.ownerNumbers, ...config.sudoNumbers].includes(digits(jid));

// Every JID-ish field a Baileys message key can carry the sender in. `participantAlt`
// and `remoteJidAlt` hold the *alternate* addressing form, so in a PN-addressed group
// message participantAlt carries the LID (and vice versa) — checking only one field
// misses the owner whenever the message arrives in the other addressing mode.
function senderJids(msg) {
  const key = msg?.key || {};
  const context = msg?.message?.extendedTextMessage?.contextInfo || {};
  return [
    key.participant, key.participantAlt, key.participantPn, key.participantLid,
    key.senderPn, key.senderLid,
    key.remoteJid, key.remoteJidAlt,
    context.participant, context.participantPn, context.participantLid
  ].filter(Boolean);
}

// True when any of the message's sender fields resolves to a configured owner number.
function isOwnerSender(msg) {
  const owners = config.ownerNumbers;
  if (!owners.length) return false;
  return senderJids(msg).some(jid => owners.includes(digits(jid)));
}

function textOf(message) {
  const m = message?.message;
  if (!m) return '';
  const type = getContentType(m);
  const nativeParams = m.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;
  let nativeCommand = '';
  if (nativeParams) {
    try {
      const parsed = JSON.parse(nativeParams);
      nativeCommand = parsed.id || parsed.row_id || parsed.selected_id || '';
    } catch {}
  }
  return m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.videoMessage?.caption ||
    m.buttonsResponseMessage?.selectedButtonId || m.listResponseMessage?.singleSelectReply?.selectedRowId ||
    nativeCommand || m[type]?.text || '';
}

function parseCommand(text) {
  if (!text || !['X', '/', '.'].includes(text[0])) return null;
  const match = text.match(/^[X/.]([a-z0-9]+)(?:\s+([\s\S]*))?$/i);
  if (!match) return null;
  return { command: match[1].toLowerCase(), query: (match[2] || '').trim() };
}

function quotedMessage(msg) {
  const ext = msg.message?.extendedTextMessage;
  const context = ext?.contextInfo || msg.message?.imageMessage?.contextInfo || msg.message?.videoMessage?.contextInfo;
  return context?.quotedMessage ? { message: context.quotedMessage, participant: context.participant } : null;
}

module.exports = { digits, isLidJid, isOwner, isOwnerSender, senderJids, textOf, parseCommand, quotedMessage, jidNormalizedUser };
