const categories = {
  stickers: ['🎨 STICKERS',
    'Xtgpack <Telegram pack link> | Pack name | Author',
    'Xnext — next 5 stickers', 'Xcancel — stop sticker import',
    'Xsticker — reply to a photo', 'Xtoimg — reply to a sticker'],
  group: ['🛡️ GROUP & STATUS',
    'Xgstatus — reply to text/photo/video/audio', 'Xgstatus <text> — text status in this group',
    'Xspam 5 enjoy — 5 messages over 10 seconds', 'Xspam 5 20s enjoy — custom timing',
    'Xstopspam — stop repeats', 'Xkick · Xpromote · Xdemote',
    'Xtagall · Xhidetag · Xlink · Xrevoke', 'Xantilink on/delete/warn/off', 'Xwelcome on/off · Xgoodbye on/off'],
  music: ['🎵 MUSIC', 'Xplay <song or YouTube link>'],
  tools: ['🧰 TOOLS', 'Xtts <text> · Xcalc <expression>', 'Xshort <url> · Xgetpp', '.vv — reply to view-once media'],
  fun: ['🎭 FUN', 'Xfact · Xquote · Xtruth · Xdare', 'Xwaifu · Xneko'],
  system: ['⚙️ SYSTEM', 'Xping · Xalive · Xruntime · Xowner', 'Xmenu <category> · Xmenu all']
};
const aliases = { sticker: 'stickers', tg: 'stickers', status: 'group', groups: 'group', admin: 'group', song: 'music' };
function renderMenu(query = '') {
  const key = query.toLowerCase().trim();
  const intro = '*XTREME MD*\nPrefixes: X · / · .\nExamples: Xtgpack · /gstatus · .spam\n';
  const section = name => { const [title, ...items] = categories[name]; return `*${title}*\n${items.map(i => '• ' + i).join('\n')}`; };
  if (key === 'all') return intro + '\n' + Object.keys(categories).map(section).join('\n\n');
  const name = aliases[key] || key;
  if (categories[name]) return intro + '\n' + section(name) + '\n\nXmenu — categories';
  return intro + '\n' + (key ? 'Unknown category. Choose one below.\n\n' : '') + Object.entries(categories).map(([k, [title]]) => `${title}\nXmenu ${k}`).join('\n\n') + '\n\nXmenu all — every command\nStatus and repeat commands: group admins / bot owner.';
}
module.exports = { renderMenu };
