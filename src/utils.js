const { jidNormalizedUser, getContentType } = require('@whiskeysockets/baileys');
const config = require('../config');

const digits = jid => String(jid || '').split('@')[0].replace(/\D/g, '');
const isOwner = jid => [...config.ownerNumbers, ...config.sudoNumbers].includes(digits(jid));

function textOf(message) {
  const m = message?.message;
  if (!m) return '';
  const type = getContentType(m);
  return m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.videoMessage?.caption || m[type]?.text || '';
}

function parseCommand(text) {
  if (!text || text[0] !== 'X') return null;
  const match = text.match(/^X([a-z0-9]+)(?:\s+([\s\S]*))?$/i);
  if (!match || text[0] !== 'X') return null;
  return { command: match[1].toLowerCase(), query: (match[2] || '').trim() };
}

function quotedMessage(msg) {
  const ext = msg.message?.extendedTextMessage;
  const context = ext?.contextInfo || msg.message?.imageMessage?.contextInfo || msg.message?.videoMessage?.contextInfo;
  return context?.quotedMessage ? { message: context.quotedMessage, participant: context.participant } : null;
}

module.exports = { digits, isOwner, textOf, parseCommand, quotedMessage, jidNormalizedUser };
