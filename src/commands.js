const axios = require('axios');
const yts = require('yt-search');
const { downloadContentFromMessage, getContentType } = require('@whiskeysockets/baileys');
const sharp = require('sharp');
const config = require('../config');
const { isOwner, quotedMessage } = require('./utils');
const { getSetting, setSetting, consumeMusic } = require('./db');

const commands = new Map();
const register = (names, handler) => names.forEach(name => commands.set(name, handler));
const reply = (sock, msg, text, extra = {}) => sock.sendMessage(msg.key.remoteJid, { text, ...extra }, { quoted: msg });

const menu = `╭━━━〔 *XTREME MD* 〕━━━╮
┃ Prefix: capital *X*
┃ Example: *Xplay Funk La Peace*
╰━━━━━━━━━━━━━━━━━━╯

🎵 *MUSIC*
• Xplay <song or YouTube link>

🛡️ *GROUP*
• Xkick • Xpromote • Xdemote
• Xtagall • Xhidetag • Xlink • Xrevoke
• Xantilink on/delete/warn/off
• Xwelcome on/off • Xgoodbye on/off

🧰 *TOOLS*
• Xsticker • Xtoimg • Xshort <url>
• Xtts <text> • Xcalc <expression>
• Xgetpp • Xruntime

🎭 *FUN*
• Xfact • Xquote • Xtruth • Xdare
• Xwaifu • Xneko

⚙️ *SYSTEM*
• Xping • Xalive • Xowner • Xmenu
• .vv — reveal replied view-once media

_Clean. Fast. Xtreme._`;

register(['menu', 'help', 'commands'], async ({ sock, msg }) => reply(sock, msg, menu));
register(['ping'], async ({ sock, msg, started }) => reply(sock, msg, `⚡ *Xtreme MD*\nLatency: ${Date.now() - started}ms`));
register(['alive'], async ({ sock, msg }) => reply(sock, msg, `✅ *Xtreme MD is online*\nMode: ${config.publicMode ? 'Public' : 'Private'}\nPrefix: X`));
register(['runtime'], async ({ sock, msg }) => { const s = Math.floor(process.uptime()); reply(sock, msg, `⏱️ Runtime: ${Math.floor(s/3600)}h ${Math.floor(s%3600/60)}m ${s%60}s`); });
register(['owner'], async ({ sock, msg }) => {
  if (!config.ownerNumbers.length) return reply(sock, msg, `👑 Owner: *${config.ownerName}*`);
  await sock.sendMessage(msg.key.remoteJid, { contacts: { displayName: config.ownerName, contacts: config.ownerNumbers.map(n => ({ displayName: config.ownerName, vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:${config.ownerName}\nTEL;type=CELL;type=VOICE;waid=${n}:+${n}\nEND:VCARD` })) } }, { quoted: msg });
});

register(['play', 'song', 'music'], async ({ sock, msg, query, sender }) => {
  if (!query) return reply(sock, msg, '🎵 Usage: *Xplay Funk La Peace*');
  const usage = await consumeMusic(sender);
  if (!usage.allowed && !isOwner(sender)) return reply(sock, msg, `Daily music limit reached (${config.musicDailyLimit}). Try again tomorrow.`);
  await sock.sendMessage(msg.key.remoteJid, { react: { text: '🎧', key: msg.key } });
  const result = await yts(query);
  const video = result.videos?.[0];
  if (!video) return reply(sock, msg, 'No matching song found.');
  const seconds = Number(video.seconds || 0);
  if (seconds > config.musicMaxMinutes * 60 && !isOwner(sender)) return reply(sock, msg, `That track exceeds the ${config.musicMaxMinutes}-minute limit.`);
  const { data } = await axios.get(config.musicApi + encodeURIComponent(video.url), { timeout: 45000 });
  const media = data?.result?.data || data?.result || data?.data;
  const url = media?.downloadUrl || media?.url;
  if (!url) return reply(sock, msg, 'The music service could not prepare that track.');
  const head = await axios.head(url, { timeout: 15000 }).catch(() => null);
  const bytes = Number(head?.headers?.['content-length'] || 0);
  if (bytes && bytes > config.musicMaxMb * 1024 * 1024 && !isOwner(sender)) return reply(sock, msg, `That file exceeds the ${config.musicMaxMb}MB limit.`);
  await sock.sendMessage(msg.key.remoteJid, { audio: { url }, mimetype: 'audio/mpeg', fileName: `${video.title}.mp3`, contextInfo: { externalAdReply: { title: video.title, body: `Xtreme MD Music • ${video.timestamp}`, thumbnailUrl: video.thumbnail, mediaType: 1, sourceUrl: video.url } } }, { quoted: msg });
});

register(['sticker', 's'], async ({ sock, msg }) => {
  const q = quotedMessage(msg); const source = q?.message || msg.message;
  const type = getContentType(source);
  if (type !== 'imageMessage') return reply(sock, msg, 'Reply to an image with *Xsticker*.');
  const stream = await downloadContentFromMessage(source[type], 'image');
  const chunks = []; for await (const chunk of stream) chunks.push(chunk);
  const sticker = await sharp(Buffer.concat(chunks)).resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 78 }).toBuffer();
  await sock.sendMessage(msg.key.remoteJid, { sticker }, { quoted: msg });
});

register(['toimg'], async ({ sock, msg }) => {
  const q = quotedMessage(msg); const source = q?.message;
  const type = getContentType(source || {});
  if (type !== 'stickerMessage') return reply(sock, msg, 'Reply to a sticker with *Xtoimg*.');
  const stream = await downloadContentFromMessage(source.stickerMessage, 'sticker');
  const chunks = []; for await (const chunk of stream) chunks.push(chunk);
  await sock.sendMessage(msg.key.remoteJid, { image: Buffer.concat(chunks), caption: 'Converted by Xtreme MD' }, { quoted: msg });
});

register(['tts'], async ({ sock, msg, query }) => {
  if (!query) return reply(sock, msg, 'Usage: *Xtts your text here*');
  if (query.length > 200) return reply(sock, msg, 'TTS text must be 200 characters or less.');
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=en&q=${encodeURIComponent(query)}`;
  await sock.sendMessage(msg.key.remoteJid, { audio: { url }, mimetype: 'audio/mpeg', ptt: true }, { quoted: msg });
});

register(['getpp'], async ({ sock, msg, mentions }) => {
  const target = mentions[0] || quotedMessage(msg)?.participant || msg.key.participant || msg.key.remoteJid;
  const url = await sock.profilePictureUrl(target, 'image').catch(() => null);
  if (!url) return reply(sock, msg, 'That profile picture is unavailable.');
  await sock.sendMessage(msg.key.remoteJid, { image: { url }, caption: 'Profile picture • Xtreme MD' }, { quoted: msg });
});

register(['short'], async ({ sock, msg, query }) => {
  if (!/^https?:\/\//i.test(query)) return reply(sock, msg, 'Usage: *Xshort https://example.com*');
  const { data } = await axios.get('https://tinyurl.com/api-create.php?url=' + encodeURIComponent(query), { timeout: 15000 });
  reply(sock, msg, `🔗 ${data}`);
});
register(['calc'], async ({ sock, msg, query }) => {
  if (!/^[0-9+\-*/().%\s]+$/.test(query)) return reply(sock, msg, 'Usage: *Xcalc 15*(8+2)*');
  const answer = Function(`"use strict"; return (${query})`)();
  reply(sock, msg, `🧮 ${query} = *${answer}*`);
});
register(['fact'], async ({ sock, msg }) => { const { data } = await axios.get('https://uselessfacts.jsph.pl/api/v2/facts/random'); reply(sock, msg, `🧠 ${data.text}`); });
register(['quote'], async ({ sock, msg }) => { const { data } = await axios.get('https://dummyjson.com/quotes/random'); reply(sock, msg, `“${data.quote}”\n— ${data.author}`); });
register(['truth'], async ({ sock, msg }) => { const list = ['What is your biggest secret?', 'Who was your first crush?', 'What is your most embarrassing moment?', 'What lie did you tell recently?']; reply(sock,msg,'🎯 '+list[Math.floor(Math.random()*list.length)]); });
register(['dare'], async ({ sock, msg }) => { const list = ['Send your funniest selfie.', 'Use a cartoon DP for one hour.', 'Voice-note the last song you heard.', 'Text your crush “I had a strange dream about you.”']; reply(sock,msg,'🔥 '+list[Math.floor(Math.random()*list.length)]); });
register(['waifu', 'neko'], async ({ sock, msg, command }) => { const { data } = await axios.get(`https://api.waifu.pics/sfw/${command}`); sock.sendMessage(msg.key.remoteJid, { image: { url: data.url }, caption: `✨ ${command} • Xtreme MD` }, { quoted: msg }); });

register(['welcome', 'goodbye', 'antilink'], async ({ sock, msg, command, query, sender, isAdmin }) => {
  if (!isAdmin && !isOwner(sender)) return reply(sock, msg, 'Group admins only.');
  const allowed = command === 'antilink' ? ['on','warn','delete','off'] : ['on','off'];
  if (!allowed.includes(query.toLowerCase())) return reply(sock, msg, `Usage: *X${command} ${allowed.join('/')}*`);
  await setSetting(`${command}:${msg.key.remoteJid}`, query.toLowerCase());
  reply(sock, msg, `✅ ${command} set to *${query.toLowerCase()}*.`);
});

register(['kick','promote','demote'], async ({ sock, msg, command, mentions, sender, isAdmin, isBotAdmin }) => {
  if (!isAdmin && !isOwner(sender)) return reply(sock,msg,'Group admins only.');
  if (!isBotAdmin) return reply(sock,msg,'Make Xtreme MD an admin first.');
  const target = mentions[0] || quotedMessage(msg)?.participant;
  if (!target) return reply(sock,msg,`Tag or reply to someone with *X${command}*.`);
  const action = command === 'kick' ? 'remove' : command;
  await sock.groupParticipantsUpdate(msg.key.remoteJid, [target], action);
  reply(sock,msg,`✅ ${command} completed.`);
});
register(['tagall','hidetag'], async ({ sock, msg, command, query, participants, sender, isAdmin }) => {
  if (!isAdmin && !isOwner(sender)) return reply(sock,msg,'Group admins only.');
  const mentions = participants.map(p => p.id);
  const text = command === 'hidetag' ? (query || 'Attention everyone.') : `📢 *XTREME TAG*\n\n${mentions.map((j,i)=>`${i+1}. @${j.split('@')[0]}`).join('\n')}\n\n${query}`;
  sock.sendMessage(msg.key.remoteJid,{text,mentions},{quoted:msg});
});
register(['link'], async ({ sock,msg }) => reply(sock,msg,`🔗 https://chat.whatsapp.com/${await sock.groupInviteCode(msg.key.remoteJid)}`));
register(['revoke'], async ({ sock,msg,sender,isAdmin }) => { if(!isAdmin&&!isOwner(sender)) return reply(sock,msg,'Group admins only.'); await sock.groupRevokeInvite(msg.key.remoteJid); reply(sock,msg,'✅ Group link reset.'); });

async function runCommand(context) {
  const handler = commands.get(context.command);
  if (!handler) return false;
  await handler(context);
  return true;
}

module.exports = { runCommand, menu, reply };
