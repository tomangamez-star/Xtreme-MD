const crypto = require('node:crypto');
const axios = require('axios');
const express = require('express');

// This API has no dependency on the WhatsApp session. Telegram credentials never
// leave the server; opaque, expiring tickets authorize individual downloads.
function createStickerApi({ token = process.env.TELEGRAM_BOT_TOKEN, http = axios, now = Date.now, videoConvert } = {}) {
  const router = express.Router();
  const tickets = new Map();
  const clients = new Map();
  let active = 0;
  let health = { checked: 0, telegram: false };
  const ttl = 30 * 60 * 1000;
  async function download(ticket) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const file = await telegram('getFile', { file_id: ticket.id });
        if (file.file_size > 5 * 1024 * 1024 || !/^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(file.file_path || '')) throw new Error('Unsupported file.');
        const result = await http.get(`https://api.telegram.org/file/bot${token}/${file.file_path}`, { responseType: 'arraybuffer', timeout: 20000, maxContentLength: 5 * 1024 * 1024, maxRedirects: 0 });
        return Buffer.from(result.data);
      } catch (error) {
        if (attempt === 2) throw new Error('Sticker source download failed.');
        await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)));
      }
    }
  }
  const batches = require('./sticker-video').createBatchConverter({ download, convert: videoConvert, now });
  async function telegram(method, body) {
    const { data } = await http.post(`https://api.telegram.org/bot${token}/${method}`, body, { timeout: 15000, maxContentLength: 2 * 1024 * 1024, maxRedirects: 0 });
    if (!data.ok) throw new Error('Telegram unavailable');
    return data.result;
  }
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    for (const [key, value] of tickets) if (value.expires < now()) tickets.delete(key);
    for (const [key, value] of clients) if (value.until < now()) clients.delete(key);
    const id = req.ip || 'unknown';
    if (!clients.has(id)) {
      if (clients.size >= 5000) return res.status(503).json({ error: 'Server busy. Try later.' });
      clients.set(id, { count: 0, until: now() + 60000 });
    }
    if (++clients.get(id).count > 90) return res.set('Retry-After', '60').status(429).json({ error: 'Please wait a minute before retrying.' });
    next();
  });
  router.get('/health', async (_req, res) => {
    if (now() - health.checked > 30000 || !health.checked) {
      try { if (!token) throw new Error(); await telegram('getMe', {}); health = { checked: now(), telegram: true }; }
      catch { health = { checked: now(), telegram: false }; }
    }
    const engine = await require('./sticker-video').videoEngineAvailable();
    res.json({ api: 1, status: health.telegram && engine ? 'connected' : 'limited', telegram: health.telegram, capabilities: engine ? ['video-batch-v1'] : [] });
  });
  router.get('/packs/:name', async (req, res) => {
    if (!/^[A-Za-z0-9_]{1,64}$/.test(req.params.name)) return res.status(400).json({ error: 'Invalid Telegram pack name.' });
    if (!token) return res.status(503).json({ error: 'Telegram is not configured on this server.' });
    if (active >= 4 || tickets.size >= 3000) return res.status(503).json({ error: 'Server busy. Try again later.' });
    active++;
    try {
      const pack = await telegram('getStickerSet', { name: req.params.name });
      if (!Array.isArray(pack.stickers) || !pack.stickers.length || pack.stickers.length > 200) return res.status(400).json({ error: 'Supported packs contain 1–200 stickers.' });
      const stickers = pack.stickers.map(s => {
        const ticket = crypto.randomBytes(24).toString('hex');
        tickets.set(ticket, { id: s.file_id, video: s.is_video === true, expires: now() + ttl });
        return { ticket, emoji: s.emoji || '', format: s.is_animated ? 'tgs' : s.is_video ? 'webm' : 'webp' };
      });
      res.json({ name: pack.name, title: pack.title, stickers });
    } catch { res.status(502).json({ error: 'Could not load Telegram pack. Check the link and server token.' }); }
    finally { active--; }
  });
  router.get('/files/:ticket', async (req, res) => {
    const ticket = tickets.get(req.params.ticket);
    if (!ticket) return res.status(410).json({ error: 'Download expired. Import the pack again.' });
    if (active >= 4) return res.status(503).json({ error: 'Server busy. Retry shortly.' });
    active++;
    try {
      res.type('application/octet-stream').send(await download(ticket));
    } catch { res.status(502).json({ error: 'Sticker download failed or exceeds 5 MB.' }); }
    finally { active--; }
  });
  router.post('/jobs', async (req, res) => {
    if (!await require('./sticker-video').videoEngineAvailable()) return res.status(503).json({ error: 'Video engine unavailable. Deploy using the repository Dockerfile, which installs FFmpeg.' });
    const values = req.body?.tickets;
    if (!Array.isArray(values) || !values.length || values.length > 200 || values.some(v => typeof v !== 'string' || !/^[a-f0-9]{48}$/.test(v))) return res.status(400).json({ error: 'Send 1–200 video tickets.' });
    const items = values.map(v => tickets.get(v));
    if (items.some(item => !item || item.expires < now())) return res.status(410).json({ error: 'Pack download expired. Fetch the pack again.' });
    if (items.some(item => !item.video)) return res.status(400).json({ error: 'Only WebM video stickers belong in this job.' });
    try {
      const job = batches.start(items, crypto.randomBytes(24).toString('hex'));
      res.status(202).json(batches.status(job));
    } catch (error) { res.status(503).json({ error: error.message }); }
  });
  router.get('/jobs/:id', (req, res) => {
    const job = batches.get(req.params.id);
    if (!job) return res.status(410).json({ error: 'Conversion job expired or server restarted. Your phone draft is unaffected.' });
    res.json(batches.status(job));
  });
  router.get('/jobs/:id/download', (req, res) => {
    const job = batches.get(req.params.id);
    if (!job) return res.status(410).json({ error: 'Conversion job expired.' });
    if (job.state !== 'ready') return res.status(409).json({ error: 'Pack is still converting.' });
    const entries = job.results.map((bytes, index) => ({ bytes, index })).filter(e => e.bytes);
    res.type('application/vnd.xtreme.sticker-batch');
    const header = Buffer.alloc(8); header.write('XSP2'); header.writeUInt32BE(entries.length, 4); res.write(header);
    for (const entry of entries) { const record = Buffer.alloc(8); record.writeUInt32BE(entry.index); record.writeUInt32BE(entry.bytes.length, 4); res.write(record); res.write(entry.bytes); }
    res.end();
  });
  return router;
}
module.exports = { createStickerApi };
