require('dotenv').config();

const csv = value => String(value || '').split(',').map(v => v.replace(/\D/g, '')).filter(Boolean);

module.exports = {
  name: 'Xtreme MD',
  prefix: 'X',
  ownerName: process.env.OWNER_NAME || 'Toman',
  ownerNumbers: csv(process.env.OWNER_NUMBERS || process.env.OWNER_NUMBER),
  sudoNumbers: csv(process.env.SUDO_NUMBERS),
  botNumber: String(process.env.BOT_NUMBER || '').replace(/\D/g, ''),
  publicMode: String(process.env.MODE || 'public').toLowerCase() === 'public',
  timezone: process.env.TIME_ZONE || 'Africa/Lagos',
  databaseUrl: process.env.DATABASE_URL || '',
  welcomeImage: process.env.WELCOME_IMAGE || require('path').join(__dirname, 'assets', 'welcome.png'),
  stickerPack: process.env.STICKER_PACK || 'Xtreme MD',
  stickerAuthor: process.env.STICKER_AUTHOR || 'TomanGamez',
  musicApi: process.env.MUSIC_API || 'https://apis-keith.vercel.app/download/dlmp3?url=',
  musicMaxMinutes: Number(process.env.MUSIC_MAX_MINUTES || 10),
  musicMaxMb: Number(process.env.MUSIC_MAX_MB || 20),
  musicDailyLimit: Number(process.env.MUSIC_DAILY_LIMIT || 3),
  pairingCooldownMs: Number(process.env.PAIRING_COOLDOWN_MS || 60000),
  port: Number(process.env.PORT || 3000)
};
