// Cost dashboard: an example Lazybox extension. It reads token use and cost
// (read:usage) and the conversations' titles (read:sessions), and shows
// totals and where the money went. One measure per chart, one hue, values in
// text beside each bar; hover a row for its tokens.
const $ = id => document.getElementById(id);
const dollars = value => value === null || value === undefined ? '–' : value < 0.01 && value > 0 ? '< $0.01' : '$' + value.toFixed(value < 10 ? 2 : 0);
const count = value => value >= 1e6 ? (value / 1e6).toFixed(1) + ' M' : value >= 1e3 ? (value / 1e3).toFixed(1) + ' k' : String(value);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function say(text) {
  $('notice').hidden = !text;
  $('notice').textContent = text || '';
}

/** Sums groups by key, most expensive first. */
function rollUp(groups, key, label) {
  const by = new Map();
  for (const g of groups) {
    const k = key(g);
    const row = by.get(k) || { label: label(g), usd: 0, input: 0, output: 0, records: 0 };
    row.usd += g.usd || 0; row.input += g.inputTokens + g.cacheReadTokens + g.cacheWriteTokens; row.output += g.outputTokens; row.records += g.records;
    by.set(k, row);
  }
  return [...by.values()].sort((a, b) => b.usd - a.usd || b.output - a.output);
}

function bars(list, rows, limit) {
  const shown = rows.slice(0, limit);
  const top = Math.max(...shown.map(r => r.usd), 0);
  if (!shown.length) { list.replaceChildren(el('li', 'empty muted', 'No usage yet')); return; }
  list.replaceChildren(...shown.map(row => {
    const li = el('li');
    li.title = `${row.label}: ${dollars(row.usd)} · ${count(row.input)} in · ${count(row.output)} out · ${row.records} ${row.records === 1 ? 'turn' : 'turns'}`;
    const track = el('span', 'track'), fill = el('span', 'fill');
    fill.style.width = (top > 0 ? Math.max(1, row.usd / top * 100) : 0) + '%';
    track.append(fill);
    li.append(el('span', 'label', row.label), el('span', 'value', dollars(row.usd)), track);
    return li;
  }));
}

async function refresh() {
  try {
    const [usage, sessions] = await Promise.all([lazybox.usage.read(), lazybox.sessions.list().catch(() => ({ conversations: [] }))]);
    const titles = new Map(sessions.conversations.map(c => [c.conversationId, c.title]));
    const groups = usage.groups;
    const input = groups.reduce((n, g) => n + g.inputTokens, 0), cached = groups.reduce((n, g) => n + g.cacheReadTokens + g.cacheWriteTokens, 0);
    const output = groups.reduce((n, g) => n + g.outputTokens, 0), turns = groups.reduce((n, g) => n + g.records, 0);
    $('total').textContent = dollars(usage.totalUsd);
    $('unpriced').textContent = usage.unpriced ? `${usage.unpriced} without a price` : 'every turn priced';
    $('input').textContent = count(input + cached);
    $('cached').textContent = cached ? `${count(cached)} from cache` : '';
    $('output').textContent = count(output);
    $('turns').textContent = `${turns} ${turns === 1 ? 'turn' : 'turns'}`;
    bars($('by-model'), rollUp(groups, g => g.model, g => g.model || 'Unknown model'), 6);
    bars($('by-workspace'), rollUp(groups, g => g.workspaceId, g => g.workspaceName || g.workspaceId), 6);
    bars($('by-conversation'), rollUp(groups.filter(g => g.conversationId), g => g.conversationId, g => titles.get(g.conversationId) || 'Conversation'), 8);
    $('updated').textContent = 'Updated ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    say('');
  } catch (error) {
    say(error.code === 'not-granted' ? 'This dashboard may not read usage; allow it in Settings → Extensions.' : error.message);
  }
}

lazybox.every(15000, refresh);
