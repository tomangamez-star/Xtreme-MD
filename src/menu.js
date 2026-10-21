const categories = {
  stickers: ['【01】STICKΞR_ENGINE',
    'Xtgpack <Telegram pack link> | Pack name | Author',
    'Xnext — next 5 stickers', 'Xcancel — stop sticker import',
    'Xsticker — reply to a photo', 'Xtoimg — reply to a sticker'],
  group: ['【02】GROUP_DOMAIN',
    'Xgstatus — reply to text/photo/video/audio', 'Xgstatus <text> — text status in this group',
    'Xspam 5 enjoy — owner-only, 5 messages/10s', 'Xspam 5 20s enjoy — owner-only custom timing',
    'Xstopspam — stop repeats', 'Xkick · Xpromote · Xdemote',
    'Xtagall · Xhidetag · Xlink · Xrevoke', 'Xantilink on/delete/warn/off', 'Xwelcome on/off · Xgoodbye on/off'],
  music: ['【03】AUDIO_SYSTEM', 'Xplay <song or YouTube link>'],
  tools: ['【04】UTILITY_CORE', 'Xtts <text> · Xcalc <expression>', 'Xshort <url> · Xgetpp', '.vv — reply to view-once media'],
  fun: ['【05】XTREME_ZONE', 'Xfact · Xquote · Xtruth · Xdare', 'Xwaifu · Xneko'],
  system: ['【06】SYSTEM_CONTROL', 'Xping · Xalive · Xruntime · Xowner', 'Xmenu <category> · Xmenu all']
};
const aliases = { sticker: 'stickers', tg: 'stickers', status: 'group', groups: 'group', admin: 'group', song: 'music' };
function renderMenu(query = '') {
  const key = query.toLowerCase().trim();
  const intro = '╭━━〔 ⚡ *XTRΞMΞ//MD* 〕━━╮\n┃ CORE STATUS  // `ONLINE`\n┃ ACCESS LEVEL // `ACTIVE`\n┃ PREFIX       // `X` • `/` • `.`\n╰━━━━━━━━━━━━━━━━━━━━╯\n';
  const section = name => { const [title, ...items] = categories[name]; return `*${title}*\n${items.map(i => `   ↳ ${i}`).join('\n')}`; };
  if (key === 'all') return intro + '\n' + Object.keys(categories).map(section).join('\n\n');
  const name = aliases[key] || key;
  if (categories[name]) return intro + '\n' + section(name) + '\n\nXmenu — categories';
  return intro + '\n' + (key ? '⚠ MODULE UNKNOWN // choose below.\n\n' : '') + Object.entries(categories).map(([k, [title]]) => `${title}\n   ↳ Xmenu ${k}`).join('\n\n') + '\n\n┌─ *SELECT A MODULE* ─┐\n│ System awaiting input…\n└───────────────────┘\n\n「 RUN THE CHAT 」\n\nXmenu all — every command\nGroup status: admins/owner · Repeat: owner only.';
}

function menuPayload(query = '') {
  return {
    text: renderMenu(query),
    footer: 'XTRΞMΞ CORE • Select a module',
    interactiveButtons: [{
      name: 'single_select',
      buttonParamsJson: JSON.stringify({
        title: '⚡ OPEN MODULES',
        sections: [{ title: 'XTREME MD', rows: Object.entries(categories).map(([id, [title]]) => ({ header: title, title: title.replace(/【\d+】/, ''), description: `Open ${id} commands`, id: `/menu ${id}` })) }]
      })
    }]
  };
}

async function sendMenu(sock, msg, query = '') {
  try { return await sock.sendMessage(msg.key.remoteJid, menuPayload(query), { quoted: msg }); }
  catch { return sock.sendMessage(msg.key.remoteJid, { text: renderMenu(query) }, { quoted: msg }); }
}

module.exports = { renderMenu, menuPayload, sendMenu };
