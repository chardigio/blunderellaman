// The blunderbot viewer at /admin/bot/ (STA-3169).
//
// blunderbot is a Claude Code session on Charlie's Mac. The Mac never accepts a connection,
// so it posts the session's activity to the blunderellaman backend, and this page polls the
// backend after the email-code login. Deep Chat (MIT, vendored in ./vendor/) draws the
// bubbles; this file decides what goes in them.
//
// Every value in the feed was written by a person or a tool (a tweet, a file, a chess game
// title), so every value goes through escapeHtml before it reaches a bubble. Deep Chat puts
// `html` into the page as it is.
//
// Shipped as a file, not an inline <script>, so the Node tests load exactly what the page runs.
(function (global) {
	'use strict';

	const POLL_MS = 3000;
	const SUMMARY_MAX = 120;

	function escapeHtml(value) {
		return String(value == null ? '' : value)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}

	// The backend writes naive UTC times (no zone). Date.parse would read those as local time.
	function parseTime(value) {
		if (!value) return NaN;
		const s = String(value);
		return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + 'Z');
	}

	// --- the feed -------------------------------------------------------------------------

	function emptyState() {
		return {afterEvent: null, afterMessage: null, items: [], fresh: [], seen: {}, sent: {}};
	}

	function itemTime(item) {
		const d = item.data;
		return parseTime(item.type === 'event' ? d.received_at || d.ts : d.created_at);
	}

	// Each poll returns what came after the two cursors, but a slow poll can overlap the
	// next one, so an item that the page already has is skipped by its key. `fresh` is what
	// this poll added, in the order to append it.
	function mergeFeed(state, feed) {
		const next = {...state, items: state.items.slice(), seen: {...state.seen}, fresh: []};
		const add = item => {
			if (next.seen[item.key]) return;
			next.seen[item.key] = true;
			next.items.push(item);
			next.fresh.push(item);
		};
		for (const e of feed.events || []) {
			next.afterEvent = Math.max(next.afterEvent || 0, e.seq);
			add({key: 'e' + e.seq, type: 'event', data: e});
		}
		for (const m of feed.messages || []) {
			next.afterMessage = Math.max(next.afterMessage || 0, m.id);
			// The page drew its own message when it was sent; the poll would draw it again.
			if (state.sent[m.id]) {
				next.seen['m' + m.id] = true;
				continue;
			}
			add({key: 'm' + m.id, type: 'message', data: m});
		}
		// Array sort is stable, so items with the same time keep the order they came in.
		const order = (a, b) => itemTime(a) - itemTime(b) || 0;
		next.fresh.sort(order);
		next.items.sort(order);
		return next;
	}

	function markSent(state, id) {
		return {...state, sent: {...state.sent, [id]: true}};
	}

	// --- tool cards -------------------------------------------------------------------------

	const TOOL_LABELS = {
		Bash: 'Ran a command',
		Read: 'Read a file',
		Edit: 'Changed a file',
		Write: 'Wrote a file',
		Grep: 'Searched the code',
		Glob: 'Looked for files',
		WebSearch: 'Searched the web',
		WebFetch: 'Read a web page',
		Agent: 'Started a helper',
		Skill: 'Used a skill',
		ToolSearch: 'Loaded tools',
		Monitor: 'Watched a job',
		mcp__plugin_imessage_imessage__reply: 'Sent an iMessage',
		mcp__plugin_imessage_imessage__chat_messages: 'Read iMessage history',
	};

	function toolLabel(name) {
		if (TOOL_LABELS[name]) return TOOL_LABELS[name];
		const mcp = /^mcp__(.+?)__(.+)$/.exec(name || '');
		return mcp ? `${mcp[1]}: ${mcp[2]}` : String(name || 'Tool');
	}

	function basename(path) {
		return String(path).split('/').filter(Boolean).pop() || String(path);
	}

	function cut(text) {
		const one = String(text).replace(/\s+/g, ' ').trim();
		return one.length > SUMMARY_MAX ? one.slice(0, SUMMARY_MAX) + '…' : one;
	}

	function toolSummary(call) {
		const input = call.input || {};
		if (input.description) return cut(input.description);
		if (input.file_path) return basename(input.file_path);
		for (const key of ['command', 'text', 'skill', 'query', 'url', 'pattern', 'prompt']) {
			if (input[key]) return cut(input[key]);
		}
		return '';
	}

	function inputBlock(input) {
		const lines = Object.entries(input || {}).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
		return lines.length ? `<pre class="input">${escapeHtml(lines.join('\n'))}</pre>` : '';
	}

	function toolCard(call, result) {
		const cls = result && result.is_error ? 'tool error' : 'tool';
		const summary = toolSummary(call);
		let output = '<p class="running">running…</p>';
		if (result) {
			output = `<pre class="output">${escapeHtml(result.text || '(no output)')}</pre>`;
			if (result.truncated) output += '<p class="more">more lines not shown</p>';
		}
		return (
			`<details class="${cls}"><summary><span class="label">${escapeHtml(toolLabel(call.tool))}</span>` +
			(summary ? ` <span class="summary">${escapeHtml(summary)}</span>` : '') +
			`</summary>${inputBlock(call.input)}${output}</details>`
		);
	}

	function note(text, cls = 'note') {
		return `<p class="${cls}">${text}</p>`;
	}

	// `cards` lives across polls: it maps a tool_use_id to its call, so an output that comes
	// in a later poll can update the card that is already on screen (`updates`).
	function render(items, cards) {
		const out = [];
		const byKey = {};
		for (const item of items) {
			const d = item.data;
			if (item.type === 'message') {
				if (d.direction === 'in') {
					out.push({key: item.key, role: 'user', html: `<p class="from">${escapeHtml(d.email)}</p><p>${escapeHtml(d.text)}</p>`});
				} else {
					out.push({key: item.key, role: 'ai', html: `<p>${escapeHtml(d.text)}</p>`});
				}
				continue;
			}
			if (d.kind === 'assistant') {
				out.push({key: item.key, role: 'ai', html: `<p>${escapeHtml(d.text)}</p>`});
			} else if (d.kind === 'channel') {
				const where = d.source === 'imessage' ? 'iMessage' : escapeHtml(d.source);
				out.push({key: item.key, role: 'activity', html: note(`${where} from ${escapeHtml(d.user)}`, 'from') + `<p>${escapeHtml(d.text)}</p>`});
			} else if (d.kind === 'prompt' || d.kind === 'notice') {
				out.push({key: item.key, role: 'activity', html: note(escapeHtml(d.text))});
			} else if (d.kind === 'tool_call') {
				cards[d.tool_use_id] = {key: item.key, call: d};
				const message = {key: item.key, role: 'activity', html: toolCard(d, null)};
				byKey[item.key] = message;
				out.push(message);
			} else if (d.kind === 'tool_result') {
				const card = cards[d.tool_use_id];
				if (!card) {
					out.push({key: item.key, role: 'activity', html: toolCard({tool: 'Output', input: {}}, d)});
				} else if (byKey[card.key]) {
					byKey[card.key].html = toolCard(card.call, d);
				} else {
					out.push({key: item.key, role: 'activity', html: toolCard(card.call, d), updates: card.key});
				}
				delete cards[d.tool_use_id];
			}
		}
		return out;
	}

	function statusText(lastActivity, now) {
		const t = parseTime(lastActivity);
		if (Number.isNaN(t)) return 'No activity yet';
		const s = Math.max(0, (now - t) / 1000);
		if (s < 60) return 'Active now';
		if (s < 3600) return `Active ${Math.floor(s / 60)} min ago`;
		if (s < 86400) return `Active ${Math.floor(s / 3600)} h ago`;
		return `Active ${Math.floor(s / 86400)} d ago`;
	}

	function messageText(body) {
		const messages = (body && body.messages) || [];
		const last = messages[messages.length - 1];
		return last && last.text ? String(last.text).trim() : '';
	}

	// --- the page (not unit tested: it needs a DOM, Deep Chat, and the backend) -------------

	// Deep Chat draws in a shadow root, so the bubble HTML gets its CSS here.
	const AUX_STYLE = [
		'p{margin:0}',
		'p+p{margin-top:4px}',
		'.from{font-size:12px;opacity:.75;margin-bottom:2px}',
		'.note{font-size:13px;color:#B4ADE0}',
		'details.tool{font-size:13px;color:#F6F4FF}',
		'details.tool summary{cursor:pointer;list-style:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
		'details.tool summary::-webkit-details-marker{display:none}',
		'details.tool summary::before{content:\'▸ \';color:#B4ADE0}',
		'details.tool[open] summary::before{content:\'▾ \'}',
		'details.tool .label{font-weight:600}',
		'details.tool .summary{color:#B4ADE0}',
		'details.tool.error .label{color:#FF6B6B}',
		'details.tool pre{margin:8px 0 0;padding:8px;border-radius:8px;background:#16133A;white-space:pre-wrap;word-break:break-word;font-size:12px;font-family:ui-monospace,Menlo,monospace;max-height:320px;overflow:auto}',
		'details.tool .running{margin-top:6px;color:#B4ADE0;font-style:italic}',
		'details.tool .more{margin-top:4px;font-size:12px;color:#B4ADE0}',
	].join('\n');

	const BUBBLE = {padding: '10px 12px', borderRadius: '14px', maxWidth: '88%', fontSize: '15px', lineHeight: '1.4'};
	const MESSAGE_STYLES = {
		default: {
			shared: {bubble: {...BUBBLE, color: '#F6F4FF'}},
			user: {bubble: {backgroundColor: '#FF4F9A', color: '#16133A'}},
			ai: {bubble: {backgroundColor: '#2A2560'}},
			activity: {bubble: {...BUBBLE, backgroundColor: 'transparent', border: '1px solid #3A3478', maxWidth: '100%', width: '100%', boxSizing: 'border-box'}},
		},
	};

	function start(doc) {
		const BlunderApi = global.BlunderApi;
		const client = BlunderApi.browserClient();
		const signin = doc.getElementById('signin');
		const view = doc.getElementById('view');
		const chat = doc.getElementById('chat');
		const status = doc.getElementById('status');
		const who = doc.getElementById('who');
		let state = emptyState();
		let lastActivity = null;
		const cards = {};
		let lastKey = null;
		let timer = null;

		function showSignIn() {
			clearTimeout(timer);
			view.hidden = true;
			signin.hidden = false;
			BlunderApi.mountSignIn(signin, client, {title: 'blunderbot', onSignedIn: showChat});
		}

		function draw(messages) {
			for (const m of messages) {
				const update = m.updates && m.updates === lastKey;
				chat.addMessage({role: m.role, html: m.html}, update);
				if (!update) lastKey = m.key;
			}
		}

		async function poll() {
			try {
				const q = [];
				if (state.afterEvent != null) q.push('after_event=' + state.afterEvent);
				if (state.afterMessage != null) q.push('after_message=' + state.afterMessage);
				const feed = await client.request('GET', '/bot/feed' + (q.length ? '?' + q.join('&') : ''));
				state = mergeFeed(state, feed);
				draw(render(state.fresh, cards));
				lastActivity = feed.last_activity_at || lastActivity;
				status.textContent = statusText(lastActivity, Date.now());
				status.classList.remove('offline');
			} catch (err) {
				if (err && (err.status === 401 || err.status === 403)) return showSignIn();
				status.textContent = 'Cannot reach the server. Trying again.';
				status.classList.add('offline');
			}
			// A hidden tab polls less: nobody is looking, and the Lambda bill is per request.
			timer = setTimeout(poll, doc.hidden ? POLL_MS * 5 : POLL_MS);
		}

		function showChat() {
			signin.hidden = true;
			view.hidden = false;
			who.textContent = client.email() || '';
			chat.auxiliaryStyle = AUX_STYLE;
			chat.messageStyles = MESSAGE_STYLES;
			chat.textInput = {placeholder: {text: 'Message blunderbot'}, characterLimit: 4000};
			chat.connect = {
				stream: true,
				// The bot answers through the feed, maybe minutes later, so the send only stores
				// the message. Opening and closing the stream with no text adds no empty bubble.
				handler: async (body, signals) => {
					signals.onOpen();
					try {
						const sent = await client.request('POST', '/bot/messages', {text: messageText(body)});
						state = markSent(state, sent.id);
						lastKey = 'm' + sent.id;
					} catch (err) {
						if (err && (err.status === 401 || err.status === 403)) return showSignIn();
						await signals.onResponse({error: (err && err.message) || 'The message did not send.'});
					}
					signals.onClose();
				},
			};
			clearTimeout(timer);
			// addMessage fails until Deep Chat has drawn its view, and each property set above
			// draws it again (which also clears it). So the feed starts from scratch on each draw.
			chat.onComponentRender = () => {
				clearTimeout(timer);
				state = emptyState();
				lastKey = null;
				for (const id of Object.keys(cards)) delete cards[id];
				poll();
			};
		}

		doc.getElementById('signout').addEventListener('click', () => {
			client.signOut();
			showSignIn();
		});
		doc.addEventListener('visibilitychange', () => {
			if (!doc.hidden && !view.hidden) {
				clearTimeout(timer);
				poll();
			}
		});
		setInterval(() => {
			if (!view.hidden) status.textContent = statusText(lastActivity, Date.now());
		}, 30000);

		if (client.signedIn()) showChat();
		else showSignIn();
	}

	const api = {POLL_MS, start, escapeHtml, parseTime, emptyState, mergeFeed, markSent, toolLabel, toolSummary, render, statusText, messageText};
	if (typeof module !== 'undefined' && module.exports) {
		module.exports = api;
	} else {
		global.BlunderBot = api;
	}
})(typeof window !== 'undefined' ? window : globalThis);
