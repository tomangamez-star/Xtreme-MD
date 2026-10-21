const axios = require('axios');
const sharp = require('sharp');
const crypto = require('crypto');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { promisify } = require('util');
const execFile = promisify(require('child_process').execFile);
const config = require('../config');

const MAX_DOWNLOAD = 5 * 1024 * 1024;
const TTL = 30 * 60 * 1000;

function parseRequest(query) {
  const [link, pack, author, ...extra] = query.split('|').map(s => s.trim());
  let url;
  try { url = new URL(link); } catch { throw new Error('Use Xtgpack https://t.me/addstickers/PackName | Pack name | Author'); }
  const match = url.pathname.match(/^\/addstickers\/([a-zA-Z0-9_]{1,64})\/?$/);
  if (url.protocol !== 'https:' || !['t.me', 'telegram.me'].includes(url.hostname) || url.port || url.username || url.password || !match || extra.length) {
    throw new Error('Send a Telegram sticker-pack link: https://t.me/addstickers/PackName');
  }
  if ((pack || '').length > 64 || (author || '').length > 64) throw new Error('Pack name and author must each be 64 characters or less.');
  return { name: match[1], pack: pack || config.stickerPack, author: author || config.stickerAuthor };
}

// WhatsApp sticker labels live in a TIFF EXIF payload inside the WebP RIFF.
function labelWebp(input, pack, author) {
  if (input.toString('ascii', 0, 4) !== 'RIFF' || input.toString('ascii', 8, 12) !== 'WEBP') throw new Error('Invalid WebP output');
  const chunks = [];
  for (let offset = 12; offset + 8 <= input.length;) {
    const length = input.readUInt32LE(offset + 4);
    const end = offset + 8 + length + (length % 2);
    if (end > input.length) throw new Error('Invalid WebP chunk');
    const chunk = Buffer.from(input.subarray(offset, end));
    const tag = chunk.toString('ascii', 0, 4);
    if (tag !== 'EXIF') chunks.push(chunk);
    offset = end;
  }
  let extended = chunks.find(c => c.toString('ascii', 0, 4) === 'VP8X');
  if (!extended) {
    extended = Buffer.alloc(18);
    extended.write('VP8X'); extended.writeUInt32LE(10, 4);
    extended.writeUIntLE(511, 12, 3); extended.writeUIntLE(511, 15, 3);
    if (chunks.some(c => c.toString('ascii', 0, 4) === 'ALPH' || c.toString('ascii', 0, 4) === 'VP8L')) extended[8] |= 0x10;
    chunks.unshift(extended);
  }
  extended[8] |= 0x08;
  const json = Buffer.from(JSON.stringify({
    'sticker-pack-id': crypto.createHash('sha256').update(`${pack}\0${author}`).digest('hex'),
    'sticker-pack-name': pack, 'sticker-pack-publisher': author, emojis: []
  }));
  const tiff = Buffer.from('49492a00080000000100415707000000000016000000', 'hex');
  tiff.writeUInt32LE(json.length, 14);
  const data = Buffer.concat([tiff, json]);
  const exif = Buffer.alloc(8 + data.length + data.length % 2);
  exif.write('EXIF'); exif.writeUInt32LE(data.length, 4); data.copy(exif, 8);
  chunks.push(exif);
  const body = Buffer.concat([Buffer.from('WEBP'), ...chunks]);
  const header = Buffer.alloc(8); header.write('RIFF'); header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

async function telegram(method, params) {
  const token = config.telegramBotToken;
  if (!token) throw new Error('Set TELEGRAM_BOT_TOKEN in Render first. Create a Telegram bot with @BotFather and use its token; no Telegram login is needed.');
  try {
    const { data } = await axios.post(`https://api.telegram.org/bot${token}/${method}`, params, { timeout: 20000, maxContentLength: 2 * 1024 * 1024 });
    if (!data.ok) throw new Error('Telegram rejected the request');
    return data.result;
  } catch {
    // Never expose Axios errors: their URLs contain the bot token.
    throw new Error('Telegram could not fetch this pack/file. Check the public pack link and TELEGRAM_BOT_TOKEN, then try again.');
  }
}

async function fetchPack(name) {
  const pack = await telegram('getStickerSet', { name });
  if (!pack.stickers?.length) throw new Error('That sticker pack is empty.');
  return pack;
}

async function convertSticker(sticker, labels) {
  const file = await telegram('getFile', { file_id: sticker.file_id });
  if (file.file_size > MAX_DOWNLOAD || !/^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+$/.test(file.file_path || '')) throw new Error('Sticker file is unsupported or too large.');
  let source;
  try {
    const { data } = await axios.get(`https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`, {
      responseType: 'arraybuffer', timeout: 20000, maxContentLength: MAX_DOWNLOAD, maxRedirects: 0
    });
    source = Buffer.from(data);
  } catch { throw new Error('Sticker download failed.'); }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xtreme-sticker-'));
  try {
    let inputArgs;
    if (sticker.is_animated) {
      const input = path.join(dir, 'input.tgs');
      await fs.writeFile(input, source);
      await execFile('python3', [path.join(__dirname, '../scripts/render-tgs.py'), input, dir], { timeout: 90000, maxBuffer: 512 * 1024 });
      inputArgs = ['-framerate', '20', '-i', path.join(dir, 'frame-%04d.png')];
    } else if (sticker.is_video) {
      const input = path.join(dir, 'input.webm');
      await fs.writeFile(input, source);
      inputArgs = ['-c:v', 'libvpx-vp9', '-i', input];
    } else {
      for (const quality of [85, 65, 45, 25]) {
        const result = labelWebp(await sharp(source, { limitInputPixels: 1024 * 1024 }).resize(512, 512, { fit: 'contain', background: '#00000000' }).webp({ quality }).toBuffer(), labels.pack, labels.author);
        if (result.length <= 100 * 1024) return result;
      }
      throw new Error('Static sticker could not fit WhatsApp’s size limit.');
    }
    const output = path.join(dir, 'sticker.webp');
    for (const [fps, quality] of [[20, 75], [15, 55], [10, 35], [8, 20]]) {
      await execFile('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...inputArgs, '-t', '10',
        '-vf', `fps=${fps},scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,format=bgra`,
        '-an', '-c:v', 'libwebp_anim', '-loop', '0', '-quality', String(quality), '-threads', '1', output], { timeout: 60000, maxBuffer: 512 * 1024 });
      const result = labelWebp(await fs.readFile(output), labels.pack, labels.author);
      if (result.length <= 500 * 1024) return result;
    }
    throw new Error('Animation could not fit WhatsApp’s size limit.');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

function createImporter({ getPack = fetchPack, convert = convertSticker, now = Date.now, pause = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const sessions = new Map();
  const locks = new Set();
  let converting = false;
  const keyOf = ctx => JSON.stringify([ctx.msg.key.remoteJid, ctx.sender]);
  const say = (ctx, text) => ctx.sock.sendMessage(ctx.msg.key.remoteJid, { text }, { quoted: ctx.msg });
  const prune = () => { for (const [key, session] of sessions) if (now() - session.updated > TTL && !locks.has(key)) sessions.delete(key); };
  async function batch(ctx, key, session) {
    let sent = 0, skipped = 0;
    const end = Math.min(session.index + 5, session.stickers.length);
    while (session.index < end && !session.cancelled) {
      let sticker;
      try { sticker = await convert(session.stickers[session.index], session); }
      catch { if (session.cancelled) break; session.index++; skipped++; continue; }
      if (session.cancelled) break;
      // Advance only after WhatsApp accepts the send, so network failures can be retried.
      await ctx.sock.sendMessage(ctx.msg.key.remoteJid, { sticker }, { quoted: ctx.msg });
      session.index++; sent++; session.updated = now();
      if (session.index < end) await pause(1200);
    }
    if (session.cancelled) return;
    session.updated = now();
    const remaining = session.stickers.length - session.index;
    if (!remaining) sessions.delete(key);
    await say(ctx, `✅ Sent ${sent}; skipped ${skipped} unsupported/failed stickers.\n${session.index}/${session.stickers.length} processed.\n${remaining ? `${remaining} left. Xnext for the next 5 · Xcancel to stop.` : 'Pack finished.'}`);
  }
  async function handle(ctx) {
    prune();
    const key = keyOf(ctx);
    if (ctx.command === 'cancel') {
      const session = sessions.get(key);
      if (session) session.cancelled = true;
      sessions.delete(key);
      return say(ctx, session ? 'Sticker import cancelled. An already-sending sticker may still arrive.' : 'No active sticker import in this chat.');
    }
    if (locks.has(key)) return say(ctx, 'Your current sticker batch is still processing. Use Xcancel to stop.');
    if (converting) return say(ctx, 'Another sticker batch is processing. Try again shortly.');
    locks.add(key); converting = true;
    try {
      let session = sessions.get(key);
      if (ctx.command === 'tgpack') {
        const labels = parseRequest(ctx.query);
        if (session) return say(ctx, 'You already have a pack here. Use Xnext or Xcancel first.');
        if (sessions.size >= 50) return say(ctx, 'The sticker queue is full. Try again later.');
        session = { ...labels, index: 0, updated: now(), cancelled: false };
        sessions.set(key, session);
        try {
          const pack = await getPack(labels.name);
          if (session.cancelled) return;
          session.stickers = pack.stickers;
          await say(ctx, `🎨 ${pack.title || labels.name}: ${pack.stickers.length} stickers.\nLabels: ${labels.pack} · ${labels.author}\nPreparing the first 5; animated stickers can take longer.`);
        } catch (error) { sessions.delete(key); throw error; }
      }
      if (!session) return say(ctx, 'No active pack. Use Xtgpack <Telegram sticker-pack link>. Imports expire after 30 minutes of inactivity or a bot restart.');
      await batch(ctx, key, session);
    } catch (error) {
      await say(ctx, ctx.command === 'tgpack' && !sessions.has(key) ? error.message : 'This batch stopped. Use Xnext to retry from the unsent sticker, or Xcancel.');
    } finally { locks.delete(key); converting = false; }
  }
  return { handle };
}

module.exports = { parseRequest, labelWebp, convertSticker, createImporter };
