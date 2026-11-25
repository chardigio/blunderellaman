// The blunderbot viewer (STA-3169). The backend feed carries the bot's activity (tool calls,
// their output, iMessage texts) and the web chat. These tests pin how the page turns that
// feed into chat bubbles: every value is escaped (the feed holds text that people and tools
// wrote), each item shows once across polls, a tool call and its output share one card, and
// the page never shows the same web message two times.
const test = require('node:test');
const assert = require('node:assert/strict');
const bot = require('../site/admin/bot.js');

const ev = (seq, kind, fields = {}) => ({seq, id: `u${seq}:0`, ts: '2026-11-25T22:00:00.000Z', kind, ...fields});
const msg = (id, direction, text, email = null, extra = {}) => ({
	id,
	direction,
	text,
	email,
	reply_to: null,
	created_at: '2026-11-25T22:00:00',
	...extra,
});
const feed = (events = [], messages = [], last = null) => ({events, messages, last_activity_at: last});

test('escapeHtml escapes every special character', () => {
	assert.equal(bot.escapeHtml(`<img src=x onerror="a('b')">&`), '&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;');
	assert.equal(bot.escapeHtml(null), '');
});

test('mergeFeed moves both cursors and keeps items in order', () => {
	let state = bot.emptyState();
	state = bot.mergeFeed(state, feed([ev(1, 'assistant', {text: 'a'}), ev(2, 'assistant', {text: 'b'})], [msg(7, 'in', 'hi', 'x@y.com')]));
	assert.equal(state.afterEvent, 2);
	assert.equal(state.afterMessage, 7);
	state = bot.mergeFeed(state, feed([ev(2, 'assistant', {text: 'b'}), ev(3, 'assistant', {text: 'c'})], []));
	assert.deepEqual(state.items.map(i => i.key), ['e1', 'e2', 'm7', 'e3']);
	assert.equal(state.afterMessage, 7);
});

test('mergeFeed returns the new items only, for the page to append', () => {
	let state = bot.mergeFeed(bot.emptyState(), feed([ev(1, 'assistant', {text: 'a'})]));
	state = bot.mergeFeed(state, feed([ev(1, 'assistant', {text: 'a'}), ev(2, 'assistant', {text: 'b'})]));
	assert.deepEqual(state.fresh.map(i => i.key), ['e2']);
});

test('a web message that this page sent is not shown again by the poll', () => {
	let state = bot.emptyState();
	state = bot.markSent(state, 9);
	state = bot.mergeFeed(state, feed([], [msg(9, 'in', 'mine', 'x@y.com'), msg(10, 'in', 'theirs', 'z@y.com')]));
	assert.deepEqual(state.fresh.map(i => i.key), ['m10']);
	assert.equal(state.afterMessage, 10);
});

test('items are ordered by the server time of each one', () => {
	const state = bot.mergeFeed(
		bot.emptyState(),
		feed([ev(1, 'assistant', {text: 'later', received_at: '2026-11-25T22:00:05'})], [msg(4, 'in', 'first', 'x@y.com', {created_at: '2026-11-25T22:00:01'})]),
	);
	assert.deepEqual(state.items.map(i => i.key), ['m4', 'e1']);
});

test('toolSummary gives one short line for each common tool', () => {
	assert.equal(bot.toolSummary({tool: 'Bash', input: {command: 'ls -la', description: 'List files'}}), 'List files');
	assert.equal(bot.toolSummary({tool: 'Bash', input: {command: 'ls -la'}}), 'ls -la');
	assert.equal(bot.toolSummary({tool: 'Read', input: {file_path: '/a/b/c.py'}}), 'c.py');
	assert.equal(bot.toolSummary({tool: 'Edit', input: {file_path: '/a/site/index.html'}}), 'index.html');
	assert.equal(bot.toolSummary({tool: 'mcp__plugin_imessage_imessage__reply', input: {text: 'Hey Nark'}}), 'Hey Nark');
	assert.equal(bot.toolSummary({tool: 'Skill', input: {skill: 'do-blunderellaman'}}), 'do-blunderellaman');
	assert.equal(bot.toolSummary({tool: 'WebSearch', input: {query: 'chess'}}), 'chess');
	assert.equal(bot.toolSummary({tool: 'Mystery', input: {}}), '');
	assert.ok(bot.toolSummary({tool: 'Bash', input: {command: 'x'.repeat(500)}}).length <= 121);
});

test('toolLabel names the tool in plain words', () => {
	assert.equal(bot.toolLabel('Bash'), 'Ran a command');
	assert.equal(bot.toolLabel('mcp__plugin_imessage_imessage__reply'), 'Sent an iMessage');
	assert.equal(bot.toolLabel('mcp__thing__do_it'), 'thing: do_it');
	assert.equal(bot.toolLabel('Frobnicate'), 'Frobnicate');
});

test('render: a web message from a person is a user bubble with the sender', () => {
	const [m] = bot.render([{key: 'm1', type: 'message', data: msg(1, 'in', '<b>hi</b>', 'nark@x.com')}], {});
	assert.equal(m.role, 'user');
	assert.match(m.html, /nark@x\.com/);
	assert.match(m.html, /&lt;b&gt;hi&lt;\/b&gt;/);
	assert.doesNotMatch(m.html, /<b>hi/);
});

test('render: a bot reply on the web is an ai bubble', () => {
	const [m] = bot.render([{key: 'm2', type: 'message', data: msg(2, 'out', 'on it')}], {});
	assert.equal(m.role, 'ai');
	assert.match(m.html, /on it/);
});

test('render: an iMessage text that reached the bot shows who sent it', () => {
	const [m] = bot.render([{key: 'e1', type: 'event', data: ev(1, 'channel', {source: 'imessage', user: '+15551234567', text: 'revenue'})}], {});
	assert.equal(m.role, 'activity');
	assert.match(m.html, /iMessage/);
	assert.match(m.html, /\+15551234567/);
	assert.match(m.html, /revenue/);
});

test('render: a tool call and its output share one card', () => {
	const items = [
		{key: 'e1', type: 'event', data: ev(1, 'tool_call', {tool: 'Bash', tool_use_id: 't1', input: {command: 'ls', description: 'List'}})},
		{key: 'e2', type: 'event', data: ev(2, 'tool_result', {tool_use_id: 't1', text: 'a\nb', truncated: true, is_error: false})},
	];
	const out = bot.render(items, {});
	assert.equal(out.length, 1);
	assert.match(out[0].html, /Ran a command/);
	assert.match(out[0].html, /<details/);
	assert.match(out[0].html, /a\nb/);
	assert.match(out[0].html, /more lines not shown/);
});

test('render: an output that comes in a later poll updates the open card', () => {
	const cards = {};
	const first = bot.render([{key: 'e1', type: 'event', data: ev(1, 'tool_call', {tool: 'Bash', tool_use_id: 't1', input: {command: 'ls'}})}], cards);
	assert.match(first[0].html, /running/);
	const second = bot.render([{key: 'e2', type: 'event', data: ev(2, 'tool_result', {tool_use_id: 't1', text: 'done', is_error: false})}], cards);
	assert.equal(second.length, 1);
	assert.equal(second[0].updates, 'e1');
	assert.match(second[0].html, /done/);
	assert.doesNotMatch(second[0].html, /running/);
});

test('render: an output with no known call is its own small card', () => {
	const [m] = bot.render([{key: 'e5', type: 'event', data: ev(5, 'tool_result', {tool_use_id: 'gone', text: 'x', is_error: false})}], {});
	assert.equal(m.role, 'activity');
	assert.equal(m.updates, undefined);
});

test('render: an error output is marked', () => {
	const items = [
		{key: 'e1', type: 'event', data: ev(1, 'tool_call', {tool: 'Bash', tool_use_id: 't1', input: {command: 'x'}})},
		{key: 'e2', type: 'event', data: ev(2, 'tool_result', {tool_use_id: 't1', text: 'boom', is_error: true})},
	];
	assert.match(bot.render(items, {})[0].html, /class="tool error"/);
});

test('render: the bot thinking aloud is an ai bubble, and escaped', () => {
	const [m] = bot.render([{key: 'e1', type: 'event', data: ev(1, 'assistant', {text: 'Scan <done>.'})}], {});
	assert.equal(m.role, 'ai');
	assert.match(m.html, /Scan &lt;done&gt;\./);
});

test('render: a prompt typed into the session and a notice are small notes', () => {
	const out = bot.render(
		[
			{key: 'e1', type: 'event', data: ev(1, 'prompt', {text: 'Check blunderellaman VODs now.'})},
			{key: 'e2', type: 'event', data: ev(2, 'notice', {text: 'The session context was compacted.'})},
		],
		{},
	);
	assert.deepEqual(out.map(m => m.role), ['activity', 'activity']);
	assert.match(out[0].html, /Check blunderellaman VODs now\./);
});

test('render: tool input values are escaped', () => {
	const [m] = bot.render([{key: 'e1', type: 'event', data: ev(1, 'tool_call', {tool: 'Write', tool_use_id: 't', input: {content: '<script>x</script>'}})}], {});
	assert.doesNotMatch(m.html, /<script>/);
});

test('statusText says how long ago the bot was active', () => {
	const now = Date.parse('2026-11-25T22:10:00Z');
	assert.equal(bot.statusText(null, now), 'No activity yet');
	assert.equal(bot.statusText('2026-11-25T22:09:50', now), 'Active now');
	assert.equal(bot.statusText('2026-11-25T22:05:00', now), 'Active 5 min ago');
	assert.equal(bot.statusText('2026-11-25T19:10:00', now), 'Active 3 h ago');
	assert.equal(bot.statusText('2026-11-23T22:10:00', now), 'Active 2 d ago');
});

test('messageText takes the text that Deep Chat submits', () => {
	assert.equal(bot.messageText({messages: [{role: 'user', text: '  clip 3  '}]}), 'clip 3');
	assert.equal(bot.messageText({messages: []}), '');
});

test('no user-facing string in the viewer uses the banned word', () => {
	const source = require('node:fs').readFileSync(require.resolve('../site/admin/bot.js'), 'utf8');
	assert.doesNotMatch(source.toLowerCase(), /\bband\b/);
});
