const { jidNormalizedUser, getContentType } = require('@whiskeysockets/baileys');
const config = require('../config');

// Normalise any JID-ish value to bare digits: strips a leading `+`, the `@server`
// domain (`@s.whatsapp.net`, `@lid`, `@hosted.lid`, `@g.us`, `@hosted`) and any
// `:device` suffix. `+2349110799878@s.whatsapp.net:12` -> `2349110799878`.
const digits = jid => String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
// A LID JID is `user@lid` or `user:device@lid` (also `@hosted.lid`). The device
// suffix must be stripped before testing the domain, or a device-suffixed LID is
// wrongly treated as a phone number.
const isLidJid = jid => /@(?:hosted\.)?lid$/i.test(String(jid || '').split(':').pop());

// A LID is an opaque identifier in a *different number space* from a phone number:
// `89147029114941@lid` is not the phone number 89147029114941. Comparing a LID's
// digits against a phone number can therefore never match, which is exactly why the
// owner was misclassified. LIDs are matched only against the configured owner LIDs.
const ownerNumbers = () => config.ownerNumbers || [];
const ownerLids = () => config.ownerLids || [];

// True when a single JID-ish value is the owner: either its digits are a configured
// owner/sudo phone number, or it is a LID whose digits are a configured owner LID.
function isOwnerJid(jid) {
  if (!jid) return false;
  const value = digits(jid);
  if (!value) return false;
  if (isLidJid(jid)) return ownerLids().includes(value);
  return [...ownerNumbers(), ...(config.sudoNumbers || [])].includes(value);
}

const isOwner = jid => isOwnerJid(jid);

// Every JID-ish field a Baileys message key can carry the sender in. `participantAlt`
// and `remoteJidAlt` hold the *alternate* addressing form, so in a PN-addressed group
// message participantAlt carries the LID (and vice versa) — checking only one field
// misses the owner whenever the message arrives in the other addressing mode.
// `senderPn` / `senderLid` are set by newer Baileys builds; `participantPn` /
// `participantLid` by some wrappers. All are collected so no addressing mode is missed.
function senderJids(msg) {
  const key = msg?.key || {};
  const context = msg?.message?.extendedTextMessage?.contextInfo ||
    msg?.message?.imageMessage?.contextInfo ||
    msg?.message?.videoMessage?.contextInfo || {};
  return [
    key.participant, key.participantAlt, key.participantPn, key.participantLid,
    key.senderPn, key.senderLid,
    key.remoteJid, key.remoteJidAlt,
    context.participant, context.participantPn, context.participantLid
  ].filter(Boolean);
}

// True when any of the message's sender fields is the owner. Synchronous: covers every
// format that carries the owner's number or their pinned LID directly. A LID that is
// not pinned needs the async store lookup in bot.js.
function isOwnerSender(msg) {
  if (!ownerNumbers().length && !ownerLids().length) return false;
  return senderJids(msg).some(isOwnerJid);
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

module.exports = { digits, isLidJid, isOwner, isOwnerJid, isOwnerSender, senderJids, textOf, parseCommand, quotedMessage, jidNormalizedUser };
