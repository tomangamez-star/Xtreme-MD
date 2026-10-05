const express = require('express');
const config = require('./config');
const { startBot, getStatus } = require('./src/bot');

const app = express();
app.get('/', (_req, res) => res.json({ name: config.name, status: getStatus(), version: '1.0.0' }));
app.get('/health', (_req, res) => res.status(200).send('OK'));
app.listen(config.port, '0.0.0.0', () => console.log(`[WEB] Xtreme MD listening on ${config.port}`));

startBot().catch(error => {
  console.error('[STARTUP]', error);
  process.exitCode = 1;
});
