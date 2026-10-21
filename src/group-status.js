const { generateWAMessageContent, generateMessageIDV2, proto, normalizeMessageContent, downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { isOwner, quotedMessage } = require('./utils');
const MAX_MEDIA = 20 * 1024 * 1024;

async function boundedDownload(media, type) {
  if (Number(media.fileLength || 0) > MAX_MEDIA) throw new Error('Status media must be 20 MB or smaller.');
  const stream = await downloadContentFromMessage(media, type, { options: { timeout: 30000 } });
  const chunks = []; let bytes = 0;
  try {
    for await (const chunk of stream) {
      bytes += chunk.length;
      if (bytes > MAX_MEDIA) throw new Error('Status media must be 20 MB or smaller.');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } finally { stream.destroy(); }
}

function createGroupStatus({ download = boundedDownload, generate = generateWAMessageContent, messageId = generateMessageIDV2, owner = isOwner } = {}) {
  const pending = new Set();
  return async function groupStatus(ctx) {
    const { sock, msg, query, sender, isGroup, isAdmin, isBotAdmin } = ctx;
    const jid = msg.key.remoteJid;
    const reply = text => sock.sendMessage(jid, { text }, { quoted: msg });
    if (!isGroup) return reply('Use Xgstatus inside the group whose status you want to post.');
    if (!isAdmin && !owner(sender)) return reply('Group admins or the bot owner only.');
    if (!isBotAdmin) return reply('Make the bot a group admin first.');
    if (pending.has(jid)) return reply('A status is already being prepared for this group.');
    const raw = quotedMessage(msg)?.message;
    // Do not automatically republish view-once wrappers.
    if (raw?.viewOnceMessage || raw?.viewOnceMessageV2 || raw?.viewOnceMessageV2Extension) return reply('Use a regular message or media file for group status.');
    const source = normalizeMessageContent(raw);
    if (!source && !query) return reply('Reply to text, a photo, a video/GIF or audio with Xgstatus. You can also use Xgstatus <text>.');
    pending.add(jid);
    try {
      let content;
      if (source?.imageMessage || source?.videoMessage || source?.audioMessage) {
        const type = source.imageMessage ? 'image' : source.videoMessage ? 'video' : 'audio';
        const media = source[`${type}Message`];
        const buffer = await download(media, type);
        content = { [type]: buffer, mimetype: media.mimetype };
        if (type !== 'audio') content.caption = query || media.caption || '';
        if (type === 'video' && media.gifPlayback) content.gifPlayback = true;
        if (type === 'audio') content.ptt = true;
      } else {
        const text = query || source?.conversation || source?.extendedTextMessage?.text;
        if (!text) return reply('Supported: text, photos, videos/GIFs and audio.');
        if (text.length > 2000) return reply('Text statuses must be 2,000 characters or less.');
        content = { text };
      }
      const inner = await generate(content, { upload: sock.waUploadToServer, backgroundColor: '#111827', font: 0 });
      const payload = proto.Message.create({ groupStatusMessageV2: { message: inner } });
      // A native group story goes directly to this group, with no personal-status broadcast.
      await sock.relayMessage(jid, payload, { messageId: messageId() });
      await reply('✅ Group status submitted. Check the group status to confirm it appears.');
    } catch (error) {
      await reply(error.message === 'Status media must be 20 MB or smaller.' ? error.message : '❌ Could not submit this group status. Check the bot’s admin role, media availability and group-status support, then try again.');
    } finally { pending.delete(jid); }
  };
}
module.exports = { createGroupStatus, boundedDownload };
