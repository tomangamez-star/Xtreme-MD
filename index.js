const express = require('express');
const config = require('./config');
const { startBot, getStatus, getConnectionInfo, requestWebPairingCode, unpairWebSession } = require('./src/bot');

const app = express();
app.use(express.json({ limit: '32kb' }));
app.use('/api/stickers', require('./src/sticker-api').createStickerApi());
app.get('/', (_req, res) => res.redirect('/pair'));
app.get('/health', (_req, res) => res.status(200).send('OK'));
app.get('/pair', (_req, res) => res.sendFile(require('path').join(__dirname, 'public', 'pair.html')));
app.get('/api/status', (_req, res) => res.json(getConnectionInfo()));

function requireDashboardToken(req, res, next) {
  const expected = process.env.DASHBOARD_TOKEN;
  if (!expected) return res.status(503).json({ ok: false, error: 'Unpair is disabled until DASHBOARD_TOKEN is set in Render environment variables.' });
  const supplied = req.get('x-dashboard-token') || req.body?.token || '';
  if (supplied !== expected) return res.status(401).json({ ok: false, error: 'Invalid dashboard security token.' });
  next();
}

app.post('/api/pair', async (req, res) => {
  try {
    const result = await requestWebPairingCode(req.body?.number);
    res.json({ ok: true, ...result });
  } catch (error) {
    const code = error.code === 'RATE_LIMITED' ? 429 : error.code === 'ALREADY_PAIRED' ? 409 : 400;
    res.status(code).json({ ok: false, error: error.message });
  }
});
app.post('/api/unpair', requireDashboardToken, async (_req, res) => {
  try {
    const result = await unpairWebSession();
    res.json(result);
  } catch (error) {
    console.error('[UNPAIR]', error);
    res.status(500).json({ ok: false, error: error.message || 'Could not unpair this session.' });
  }
});

app.listen(config.port, '0.0.0.0', () => console.log(`[WEB] Xtreme MD listening on ${config.port}`));

startBot().catch(error => {
  console.error('[STARTUP]', error);
  process.exitCode = 1;
});
