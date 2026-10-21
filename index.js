const express = require('express');
const config = require('./config');
const { startBot, getStatus, requestWebPairingCode } = require('./src/bot');

const app = express();
app.use(express.json({ limit: '10kb' }));
app.get('/', (_req, res) => res.redirect('/pair'));
app.get('/health', (_req, res) => res.status(200).send('OK'));
app.get('/pair', (_req, res) => res.sendFile(require('path').join(__dirname, 'public', 'pair.html')));
app.post('/api/pair', async (_req, res) => {
  try {
    const result = await requestWebPairingCode(_req.body?.number);
    res.json({ ok: true, ...result });
  } catch (error) {
    const code = error.code === 'RATE_LIMITED' ? 429 : error.code === 'ALREADY_PAIRED' ? 409 : 400;
    res.status(code).json({ ok: false, error: error.message });
  }
});
app.listen(config.port, '0.0.0.0', () => console.log(`[WEB] Xtreme MD listening on ${config.port}`));

startBot().catch(error => {
  console.error('[STARTUP]', error);
  process.exitCode = 1;
});
