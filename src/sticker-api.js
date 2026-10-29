const crypto = require('node:crypto');
const axios = require('axios');
const express = require('express');

// This API has no dependency on the WhatsApp session. Telegram credentials never
// leave the server; opaque, expiring tickets authorize individual downloads.
function createStickerApi({ token = process.env.TELEGRAM_BOT_TOKEN, http = axios, now = Date.now } = {}) {
  const router = express.Router();
  const tickets = new Map();
  const clients = new Map();
  let active = 0;
  let health = { checked: 0, telegram: false };
  const ttl = 30 * 60 * 1000;
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
    res.json({ api: 1, status: health.telegram ? 'connected' : 'limited', telegram: health.telegram });
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
        tickets.set(ticket, { id: s.file_id, expires: now() + ttl });
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
      const file = await telegram('getFile', { file_id: ticket.id });
      if (file.file_size > 5 * 1024 * 1024 || !/^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(file.file_path || '')) throw new Error();
      const result = await http.get(`https://api.telegram.org/file/bot${token}/${file.file_path}`, { responseType: 'arraybuffer', timeout: 20000, maxContentLength: 5 * 1024 * 1024, maxRedirects: 0 });
      res.type('application/octet-stream').send(Buffer.from(result.data));
    } catch { res.status(502).json({ error: 'Sticker download failed or exceeds 5 MB.' }); }
    finally { active--; }
  });
  return router;
}
module.exports = { createStickerApi };
