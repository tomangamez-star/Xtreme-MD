const axios = require('axios');
const sharp = require('sharp');
const { digits } = require('./utils');

const escapeXml = value => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
const shorten = (value, max) => String(value || '').length > max ? `${String(value).slice(0, max - 1)}…` : String(value || '');

async function fetchImage(url) {
  if (!url) return null;
  try {
    const { data } = await axios.get(url, { responseType: 'arraybuffer', timeout: 12000, maxContentLength: 5 * 1024 * 1024, maxRedirects: 3 });
    return Buffer.from(data);
  } catch { return null; }
}

async function avatar(buffer, size, fallbackText) {
  if (buffer) {
    try {
      const mask = Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="white"/></svg>`);
      return await sharp(buffer, { limitInputPixels: 20_000_000 }).rotate().resize(size, size, { fit: 'cover' }).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
    } catch {}
  }
  const safe = escapeXml(fallbackText || 'X');
  return sharp(Buffer.from(`<svg width="${size}" height="${size}"><defs><linearGradient id="g"><stop stop-color="#19e6ff"/><stop offset="1" stop-color="#8b5cf6"/></linearGradient></defs><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#111827"/><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 5}" fill="none" stroke="url(#g)" stroke-width="10"/><text x="50%" y="55%" text-anchor="middle" fill="#f8fafc" font-family="DejaVu Sans" font-size="${size * .34}" font-weight="700">${safe}</text></svg>`)).png().toBuffer();
}

async function buildWelcomeCard({ sock, participant, metadata }) {
  const number = digits(participant) || 'UNKNOWN';
  const memberLabel = `@${number}`;
  const [memberUrl, groupUrl] = await Promise.all([
    sock.profilePictureUrl(participant, 'image').catch(() => null),
    sock.profilePictureUrl(metadata.id, 'image').catch(() => null)
  ]);
  const [memberBuffer, groupBuffer] = await Promise.all([fetchImage(memberUrl), fetchImage(groupUrl)]);
  const [memberAvatar, groupAvatar] = await Promise.all([avatar(memberBuffer, 260, 'X'), avatar(groupBuffer, 92, 'G')]);
  const group = escapeXml(shorten(metadata.subject || 'XTREME DOMAIN', 30));
  const user = escapeXml(shorten(memberLabel, 25));
  const count = Array.isArray(metadata.participants) ? metadata.participants.length : '?';
  const background = Buffer.from(`<svg width="1200" height="675" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x2="1" y2="1"><stop stop-color="#030712"/><stop offset=".54" stop-color="#0b1223"/><stop offset="1" stop-color="#190d2e"/></linearGradient>
      <linearGradient id="line"><stop stop-color="#19e6ff"/><stop offset=".55" stop-color="#94a3b8"/><stop offset="1" stop-color="#8b5cf6"/></linearGradient>
      <filter id="glow"><feGaussianBlur stdDeviation="7" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <rect width="1200" height="675" fill="url(#bg)"/><path d="M0 78H390L430 38H1200M0 600H790L840 642H1200" fill="none" stroke="#19e6ff" stroke-opacity=".35" stroke-width="2"/>
    <rect x="34" y="30" width="1132" height="615" rx="24" fill="none" stroke="url(#line)" stroke-width="3"/>
    <text x="72" y="86" fill="#19e6ff" font-family="DejaVu Sans Mono" font-size="22" font-weight="700">XTRΞMΞ//MD · CORE ONLINE</text>
    <text x="600" y="139" text-anchor="middle" fill="#f8fafc" font-family="DejaVu Sans" font-size="39" font-weight="700">NEW ENTITY DETECTED</text>
    <circle cx="600" cy="318" r="151" fill="none" stroke="#19e6ff" stroke-width="3" stroke-dasharray="18 9" filter="url(#glow)"/>
    <circle cx="600" cy="318" r="139" fill="#0f172a" stroke="#8b5cf6" stroke-width="4"/>
    <circle cx="600" cy="318" r="130" fill="#070b14"/>
    <text x="600" y="487" text-anchor="middle" fill="#f8fafc" font-family="DejaVu Sans" font-size="30" font-weight="700">${user}</text>
    <text x="600" y="523" text-anchor="middle" fill="#94a3b8" font-family="DejaVu Sans Mono" font-size="18">SYNCING  ██████████  100%</text>
    <text x="600" y="564" text-anchor="middle" fill="#19e6ff" font-family="DejaVu Sans" font-size="25" font-weight="700">ACCESS APPROVED</text>
    <circle cx="1020" cy="104" r="53" fill="#0f172a" stroke="#8b5cf6" stroke-width="3"/>
    <text x="78" y="575" fill="#94a3b8" font-family="DejaVu Sans Mono" font-size="17">DOMAIN //</text>
    <text x="78" y="608" fill="#f8fafc" font-family="DejaVu Sans" font-size="25" font-weight="700">${group}</text>
    <text x="930" y="591" text-anchor="end" fill="#94a3b8" font-family="DejaVu Sans Mono" font-size="17">MEMBER //</text>
    <text x="1094" y="591" text-anchor="end" fill="#f8fafc" font-family="DejaVu Sans" font-size="27" font-weight="700">#${count}</text>
    <text x="600" y="625" text-anchor="middle" fill="#a78bfa" font-family="DejaVu Sans" font-size="15">「 YOUR STORY BEGINS HERE 」</text>
  </svg>`);
  return sharp(background).composite([
    { input: memberAvatar, left: 470, top: 188 },
    { input: groupAvatar, left: 974, top: 58 }
  ]).jpeg({ quality: 88, chromaSubsampling: '4:4:4' }).toBuffer();
}

module.exports = { buildWelcomeCard, fetchImage };
