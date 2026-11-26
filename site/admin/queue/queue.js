// The shorts queue page (/admin/queue/).
//
// After each stream the clip bot puts its cuts here as "to review". A reviewer accepts or
// rejects each one and can fix its title. The server gives every accepted clip a time (three
// slots a day, Eastern) and plans the whole queue again after every change, so this page never
// computes a schedule: it shows the server's plan and sends edits.
//
// When a clip's time comes, the server's publisher posts it. With Upload-Post (the deployed
// publisher) the page shows "Going out now" with each platform's state, and nothing is
// manual. With the `manual` fallback the page shows "Post now", and the reviewer posts the
// clip by hand and taps the button for each platform.
//
// Shipped as a file, not an inline <script>, so the Node tests load exactly what the page runs.
(function (global) {
	'use strict';

	const TZ = 'America/New_York';
	const PLATFORMS = ['youtube', 'tiktok'];
	const PLATFORM_LABELS = {youtube: 'YouTube Shorts', tiktok: 'TikTok'};
	const DAY_MS = 86400000;
	// The server tries a failed post again after this long (publisher.RETRY_AFTER).
	const RETRY_MS = 30 * 60000;

	const etFormat = new Intl.DateTimeFormat('en-US', {
		timeZone: TZ, weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
		hour: 'numeric', minute: '2-digit', hourCycle: 'h23',
	});
	const etNumeric = new Intl.DateTimeFormat('en-US', {
		timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
		hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
	});

	function parts(fmt, date) {
		const out = {};
		for (const p of fmt.formatToParts(date)) out[p.type] = p.value;
		return out;
	}

	function etDayNumber(date) {
		const p = parts(etNumeric, date);
		return Math.floor(Date.UTC(+p.year, +p.month - 1, +p.day) / DAY_MS);
	}

	function clockLabel(hour, minute) {
		const h12 = hour % 12 === 0 ? 12 : hour % 12;
		return h12 + (minute ? ':' + String(minute).padStart(2, '0') : '') + (hour < 12 ? ' am' : ' pm');
	}

	// "Wed 11 am" inside the next week, "Dec 15, 11 am" after that. Always Eastern time.
	function formatSlot(iso, nowIso) {
		const date = new Date(iso);
		const p = parts(etFormat, date);
		const clock = clockLabel(+p.hour, +p.minute);
		const days = etDayNumber(date) - etDayNumber(new Date(nowIso || Date.now()));
		if (days >= 0 && days < 7) return p.weekday + ' ' + clock;
		return p.month + ' ' + p.day + ', ' + clock;
	}

	// The offset of Eastern time from UTC at one instant, in ms (for example -5 h in winter).
	function etOffset(ms) {
		const p = parts(etNumeric, new Date(ms));
		const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute);
		return asUtc - Math.floor(ms / 60000) * 60000;
	}

	// A datetime-local value ("2026-12-02T16:00"), read as Eastern wall-clock time, to UTC ISO.
	// The input has no timezone, and a reviewer in a different zone still means Eastern, the
	// zone the slots are in.
	function etWallToUtcIso(wall) {
		const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(wall || '');
		if (!m) return null;
		const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
		let ms = guess - etOffset(guess);
		ms = guess - etOffset(ms);
		return new Date(ms).toISOString();
	}

	function utcIsoToEtWall(iso) {
		const p = parts(etNumeric, new Date(iso));
		return p.year + '-' + p.month + '-' + p.day + 'T' + String(+p.hour % 24).padStart(2, '0') + ':' + p.minute;
	}

	function postStatus(c, platform) {
		return c.posts && c.posts[platform] ? c.posts[platform].status : null;
	}

	function fullyPosted(c) {
		return PLATFORMS.every(p => postStatus(c, p) === 'posted');
	}

	function platformsToPost(c) {
		return PLATFORMS.filter(p => {
			const s = postStatus(c, p);
			return s === 'awaiting_manual' || s === 'failed';
		});
	}

	// Any post row means the clip's time came and the publisher has it.
	function inFlight(c) {
		return c.status === 'accepted' && !fullyPosted(c) && PLATFORMS.some(p => postStatus(c, p) !== null);
	}

	function isManual(queue) {
		return queue.publisher === 'manual';
	}

	// One line for each platform on a "Going out now" card.
	function platformState(c, platform, queue) {
		const label = PLATFORM_LABELS[platform];
		const post = c.posts && c.posts[platform];
		if (!post) return {text: 'Waiting to send to ' + label + '.'};
		if (post.status === 'posted') return {text: 'Posted on ' + label + '.', url: post.external_url || null};
		if (post.status === 'submitted') return {text: 'Sending to ' + label + '.'};
		if (post.status === 'failed') {
			const next = post.at ? formatSlot(new Date(Date.parse(post.at) + RETRY_MS).toISOString(), queue.now) : null;
			return {
				text: label + ' failed: ' + (post.error || 'no reason given') + (next ? ' The next try is ' + next + '.' : ''),
				error: true,
			};
		}
		return {text: label + ': ' + post.status + '.'};
	}

	function byTime(a, b) {
		return String(a.scheduled_at || '').localeCompare(String(b.scheduled_at || ''));
	}

	function sections(queue) {
		const out = {postNow: [], review: [], scheduled: [], done: []};
		for (const c of queue.clips || []) {
			if (c.status === 'rejected' || (c.status === 'accepted' && fullyPosted(c))) out.done.push(c);
			else if (inFlight(c)) out.postNow.push(c);
			else if (c.status === 'accepted') out.scheduled.push(c);
			else out.review.push(c);
		}
		out.postNow.sort(byTime);
		out.scheduled.sort(byTime);
		out.review.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || a.rank - b.rank || a.id - b.id);
		out.done.sort((a, b) => byTime(b, a) || b.id - a.id);
		return out;
	}

	// "in 45m", "in 3h", "in 2d". A time that has come says "now".
	function relTime(iso, nowIso) {
		const min = Math.round((Date.parse(iso) - Date.parse(nowIso || new Date().toISOString())) / 60000);
		if (min <= 0) return 'now';
		if (min < 60) return 'in ' + min + 'm';
		if (min < 48 * 60) return 'in ' + Math.round(min / 60) + 'h';
		return 'in ' + Math.round(min / 1440) + 'd';
	}

	// One short line for the top bar: "7 ready · next Wed 11 am (in 1h) · last Fri 7 pm".
	function summaryLine(queue) {
		const ready = (queue.clips || [])
			.filter(c => c.status === 'accepted' && c.scheduled_at && !fullyPosted(c) && !inFlight(c))
			.sort(byTime);
		if (!ready.length) return 'Nothing scheduled. Accept a clip to give it a time.';
		const first = ready[0].scheduled_at;
		const next = formatSlot(first, queue.now) + ' (' + relTime(first, queue.now) + ')';
		if (ready.length === 1) return '1 ready · goes out ' + next;
		return ready.length + ' ready · next ' + next + ' · last ' + formatSlot(ready[ready.length - 1].scheduled_at, queue.now);
	}

	function counts(s) {
		return {review: s.review.length, postNow: s.postNow.length, scheduled: s.scheduled.length, done: s.done.length};
	}

	// The tab a phone opens on: the work that waits for the reviewer first.
	function defaultTab(n) {
		if (n.review) return 'review';
		if (n.postNow) return 'postNow';
		return 'scheduled';
	}

	// Keyboard shortcuts. `k` is a KeyboardEvent (or an object with the same fields).
	const KEYMAP = {
		j: 'next', k: 'prev', a: 'accept', x: 'reject', u: 'unaccept', e: 'edit', t: 'time', s: 'save',
		' ': 'play', f: 'fullscreen', '?': 'help', Escape: 'deselect',
	};

	function keyAction(k, inField) {
		if (k.metaKey || k.ctrlKey || k.altKey) return inField && k.key === 'Enter' ? 'submit' : null;
		if (inField) {
			if (k.key === 'Escape') return 'blur';
			if (k.key === 'Enter') return 'submit';
			return null;
		}
		return KEYMAP[k.key] || null;
	}

	function escapeHtml(s) {
		return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
	}

	// ---- the page ------------------------------------------------------------------------

	function kbd(k) {
		return '<kbd>' + k + '</kbd>';
	}

	function video(c, preload) {
		return c.video_url
			// `#t=0.1` makes Safari draw the first frame in place of a black box. The fragment
			// is not sent to the server, so the signed URL stays valid.
			? '<video src="' + escapeHtml(c.video_url) + '#t=0.1" preload="' + preload + '" playsinline controls></video>'
			: '<div class="novideo">No video</div>';
	}

	function meta(c, extra) {
		const bits = ['#' + c.rank];
		if (c.vod_time) bits.push('VOD ' + escapeHtml(c.vod_time));
		if (extra) bits.push(extra);
		return '<div class="meta">' + bits.join(' · ') + '</div>';
	}

	function titleInput(c) {
		const len = String(c.title || '').length;
		return '<label class="field"><span>Title <span class="count">' + len + '/100</span></span>' +
			// A textarea so a long title wraps and shows in full. Enter saves (see keyAction), so a
			// title never gets a line break.
			'<textarea class="title" rows="2" maxlength="100" enterkeyhint="done">' + escapeHtml(c.title) + '</textarea></label>';
	}

	function reviewCard(c) {
		return '<article class="clip" data-id="' + c.id + '" data-kind="review">' + video(c, 'metadata') +
			'<div class="body">' + meta(c) + titleInput(c) +
			(c.note ? '<p class="note">' + escapeHtml(c.note) + '</p>' : '') + '</div>' +
			'<div class="actions">' +
			'<button type="button" class="primary" data-action="accept">Accept' + kbd('A') + '</button>' +
			'<button type="button" data-action="reject">Reject' + kbd('X') + '</button>' +
			'</div></article>';
	}

	function scheduledRow(c, queue) {
		const slot = c.scheduled_at ? formatSlot(c.scheduled_at, queue.now) : 'No time';
		const rel = c.scheduled_at ? relTime(c.scheduled_at, queue.now) : '';
		return '<details class="row" data-id="' + c.id + '" data-kind="scheduled">' +
			'<summary><span class="slot">' + escapeHtml(slot) + '</span>' +
			'<span class="rel">' + rel + '</span>' +
			(c.pinned_at ? '<span class="tag" title="You set this time">pinned</span>' : '') +
			'<span class="row-title">' + escapeHtml(c.title) + '</span></summary>' +
			'<div class="row-body">' + video(c, 'none') + '<div class="body">' + meta(c) + titleInput(c) +
			'<label class="field"><span>Time (Eastern)</span><input class="time" type="datetime-local" step="300" value="' +
			(c.scheduled_at ? utcIsoToEtWall(c.scheduled_at) : '') + '"></label>' +
			'<div class="actions">' +
			'<button type="button" class="primary" data-action="save">Save' + kbd('S') + '</button>' +
			(c.pinned_at ? '<button type="button" data-action="auto">Auto time</button>' : '') +
			'<button type="button" data-action="unaccept">To review' + kbd('U') + '</button>' +
			'<button type="button" data-action="reject">Reject' + kbd('X') + '</button>' +
			'</div></div></div></details>';
	}

	function postNowCard(c, queue) {
		const buttons = platformsToPost(c).map(p => {
			const failed = postStatus(c, p) === 'failed';
			return '<button type="button" class="primary" data-action="posted" data-platform="' + p + '">' +
				'I posted it on ' + PLATFORM_LABELS[p] + '</button>' +
				(failed ? '<span class="err">' + escapeHtml(c.posts[p].error || 'The upload failed.') + '</span>' : '');
		}).join('');
		return '<article class="clip due" data-id="' + c.id + '" data-kind="postNow">' + video(c, 'metadata') +
			'<div class="body">' +
			'<div class="when">Due ' + escapeHtml(formatSlot(c.scheduled_at, queue.now)) + '</div>' +
			meta(c) +
			'<div class="copyrow"><code>' + escapeHtml(c.title) + '</code>' +
			'<button type="button" class="small" data-action="copy">Copy</button></div>' +
			(c.video_url ? '<a class="download" href="' + escapeHtml(c.video_url) + '" target="_blank" rel="noopener">Open the video to save it</a>' : '') +
			'</div><div class="actions">' + buttons + '</div></article>';
	}

	function goingOutRow(c, queue) {
		const lines = PLATFORMS.map(p => {
			const st = platformState(c, p, queue);
			const dot = postStatus(c, p) || 'waiting';
			const text = st.url
				? escapeHtml(st.text) + ' <a href="' + escapeHtml(st.url) + '" target="_blank" rel="noopener">Open</a>'
				: escapeHtml(st.text);
			return '<li class="' + (st.error ? 'err' : '') + '"><span class="dot ' + dot + '"></span>' + text + '</li>';
		}).join('');
		return '<article class="row going" data-id="' + c.id + '" data-kind="postNow">' +
			'<div class="row-line"><span class="slot">' + escapeHtml(formatSlot(c.scheduled_at, queue.now)) + '</span>' +
			'<span class="row-title">' + escapeHtml(c.title) + '</span></div>' +
			'<ul class="plat-states">' + lines + '</ul></article>';
	}

	function doneRow(c, queue) {
		let state;
		let actions = '';
		if (c.status === 'rejected') {
			state = 'Rejected';
			actions = '<button type="button" class="small" data-action="unaccept">Restore</button>';
		} else {
			state = 'Posted ' + escapeHtml(formatSlot(c.scheduled_at, queue.now));
			actions = PLATFORMS.map(p => {
				const post = c.posts[p];
				const label = PLATFORM_LABELS[p];
				const link = post && post.external_url
					? '<a href="' + escapeHtml(post.external_url) + '" target="_blank" rel="noopener">' + label + '</a>'
					: label;
				// Undo is for a mis-tap in the manual flow. With a real publisher it would post
				// the clip a second time.
				const undo = isManual(queue)
					? ' <button type="button" class="small" data-action="unpost" data-platform="' + p + '">Undo</button>'
					: '';
				return '<span class="plat">' + link + undo + '</span>';
			}).join('');
		}
		return '<li class="done-row" data-id="' + c.id + '" data-kind="done"><div class="done-main"><span class="row-title">' +
			escapeHtml(c.title) + '</span><span class="meta">' + state + '</span></div>' +
			'<div class="actions">' + actions + '</div></li>';
	}

	function section(key, title, n, hint, html, empty) {
		return '<section class="group" data-section="' + key + '"><h2>' + title + ' <span class="n">' + n + '</span></h2>' +
			(hint ? '<p class="hint">' + hint + '</p>' : '') +
			(html || '<p class="empty">' + empty + '</p>') + '</section>';
	}

	const TAB_LABELS = {review: 'Review', postNow: 'Going out', scheduled: 'Scheduled', done: 'Done'};

	function tabsHtml(n, tab, queue) {
		return ['review', 'postNow', 'scheduled', 'done']
			.filter(k => k !== 'postNow' || n.postNow)
			.map(k => {
				const label = k === 'postNow' && isManual(queue) ? 'Post now' : TAB_LABELS[k];
				return '<button type="button" role="tab" data-tab="' + k + '" aria-selected="' + (k === tab) + '">' +
					label + ' <span class="n">' + n[k] + '</span></button>';
			}).join('');
	}

	// Draws the queue. Desktop shows the review grid with the rest in a side column; a phone
	// shows one tab at a time (the CSS picks which, from `data-tab` on #groups).
	function renderQueue(root, queue, tab) {
		const s = sections(queue);
		const n = counts(s);
		tab = tab || defaultTab(n);
		root.querySelector('#summary').textContent = summaryLine(queue);
		const tabs = root.querySelector('#tabs');
		if (tabs) tabs.innerHTML = tabsHtml(n, tab, queue);
		const postNow = s.postNow.length
			? (isManual(queue)
				? section('postNow', 'Post now', n.postNow, 'These are due. Post each one, then tap the button for each platform.',
					s.postNow.map(c => postNowCard(c, queue)).join(''))
				: section('postNow', 'Going out now', n.postNow, 'Upload-Post sends these to YouTube Shorts and TikTok. This page updates each minute.',
					'<div class="list">' + s.postNow.map(c => goingOutRow(c, queue)).join('') + '</div>'))
			: '';
		root.querySelector('#groups').innerHTML =
			'<div class="col-main">' +
			section('review', 'To review', n.review, 'Fix a title before you accept it.',
				s.review.length ? '<div class="cards">' + s.review.map(reviewCard).join('') + '</div>' : '', 'No clips to review.') +
			'</div><div class="col-side">' + postNow +
			section('scheduled', 'Scheduled', n.scheduled, 'Eastern. 11 am, 3 pm, 7 pm. Pin a time and the others move around it.',
				s.scheduled.length ? '<div class="list">' + s.scheduled.map(c => scheduledRow(c, queue)).join('') + '</div>' : '',
				'No clips are scheduled.') +
			section('done', 'Done', n.done, 'The last two weeks.',
				s.done.length ? '<ul class="done">' + s.done.map(c => doneRow(c, queue)).join('') + '</ul>' : '', 'Nothing yet.') +
			'</div>';
		return {counts: n, tab};
	}

	async function copyText(doc, text) {
		try {
			await doc.defaultView.navigator.clipboard.writeText(text);
			return true;
		} catch (e) {
			return false;
		}
	}

	function start(doc) {
		const Api = global.BlunderApi;
		const client = Api.browserClient();
		const signin = doc.getElementById('signin');
		const page = doc.getElementById('page');
		const groups = doc.getElementById('groups');
		const status = doc.getElementById('status');
		const help = doc.getElementById('keys');
		const win = doc.defaultView;
		// What the reviewer looks at survives a re-render: the tab, the selected clip, and the
		// scheduled rows they opened.
		const ui = {tab: null, sel: null, open: new Set()};
		let busy = false;
		let lastQueue = null;
		let toastTimer = null;

		function say(text, isError, sticky) {
			win.clearTimeout(toastTimer);
			status.textContent = text || '';
			status.classList.toggle('error', Boolean(isError));
			status.hidden = !text;
			if (text && !isError && !sticky) toastTimer = win.setTimeout(() => { status.hidden = true; }, 2500);
		}

		function showSignIn() {
			page.hidden = true;
			signin.hidden = false;
			Api.mountSignIn(signin, client, {title: 'Shorts queue', onSignedIn: () => { signin.hidden = true; load(); }});
		}

		async function call(method, path, body) {
			try {
				return await client.request(method, path, body);
			} catch (err) {
				if (err.status === 401 || err.status === 403) {
					if (err.status === 403) client.signOut();
					showSignIn();
					return null;
				}
				throw err;
			}
		}

		function render(queue) {
			lastQueue = queue;
			const out = renderQueue(page, queue, ui.tab);
			ui.tab = out.tab;
			groups.setAttribute('data-tab', ui.tab);
			for (const id of ui.open) {
				const el = groups.querySelector('details[data-id="' + id + '"]');
				if (el) el.open = true;
				else ui.open.delete(id);
			}
			select(ui.sel, false);
			doc.getElementById('updated').textContent =
				'Updated ' + new Date().toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'});
		}

		async function load() {
			page.hidden = false;
			doc.getElementById('who').textContent = client.email();
			try {
				const queue = await call('GET', '/clips');
				if (queue) render(queue);
			} catch (err) {
				say(err.message, true);
			}
		}

		async function change(method, path, body, done) {
			if (busy) return;
			busy = true;
			page.classList.add('busy');
			say('Saving…', false, true);
			try {
				const queue = await call(method, path, body);
				if (queue) {
					render(queue);
					say(done || 'Saved.');
				}
			} catch (err) {
				say(err.message, true);
			} finally {
				busy = false;
				page.classList.remove('busy');
			}
		}

		// ---- selection and keys ----------------------------------------------------------

		function visibleCards() {
			return Array.from(groups.querySelectorAll('[data-id]')).filter(el => el.getClientRects().length);
		}

		function select(id, scroll) {
			for (const el of groups.querySelectorAll('.sel')) el.classList.remove('sel');
			ui.sel = id;
			const el = id == null ? null : groups.querySelector('[data-id="' + id + '"]');
			if (!el) return null;
			el.classList.add('sel');
			if (scroll) el.scrollIntoView({block: 'nearest', behavior: 'smooth'});
			return el;
		}

		// After a clip leaves its list (accept, reject), keep the reviewer's place: select the
		// next clip of the same kind, or the one before it.
		function neighbor(card) {
			const same = visibleCards().filter(el => el.getAttribute('data-kind') === card.getAttribute('data-kind'));
			const i = same.indexOf(card);
			const next = same[i + 1] || same[i - 1];
			return next ? next.getAttribute('data-id') : null;
		}

		function move(dir) {
			const cards = visibleCards();
			if (!cards.length) return;
			const cur = cards.findIndex(el => el.classList.contains('sel'));
			const i = cur < 0 ? 0 : Math.min(cards.length - 1, Math.max(0, cur + dir));
			select(cards[i].getAttribute('data-id'), true);
		}

		function focusField(card, cls) {
			if (card.tagName === 'DETAILS') card.open = true;
			const input = card.querySelector('.' + cls);
			if (input) {
				input.focus();
				if (cls === 'title') input.setSelectionRange(input.value.length, input.value.length);
			}
		}

		async function run(action, card, platform) {
			const id = card.getAttribute('data-id');
			const kind = card.getAttribute('data-kind');
			const titleEl = card.querySelector('.title');
			const timeEl = card.querySelector('input.time');
			const title = titleEl ? titleEl.value : undefined;
			if (action === 'accept') {
				if (kind !== 'review') return;
				ui.sel = neighbor(card);
				await change('PATCH', '/clips/' + id, {status: 'accepted', title}, 'Accepted.');
			} else if (action === 'reject') {
				if (kind !== 'review' && kind !== 'scheduled') return;
				ui.sel = neighbor(card);
				await change('PATCH', '/clips/' + id, {status: 'rejected'}, 'Rejected.');
			} else if (action === 'unaccept') {
				if (kind !== 'scheduled' && !(kind === 'done' && card.querySelector('[data-action="unaccept"]'))) return;
				ui.sel = neighbor(card);
				await change('PATCH', '/clips/' + id, {status: 'pending'}, 'Back in review.');
			} else if (action === 'auto') await change('PATCH', '/clips/' + id, {pinned_at: null}, 'Back to the auto time.');
			else if (action === 'save') {
				if (kind !== 'scheduled') return;
				const body = {title};
				if (timeEl.value && timeEl.value !== timeEl.defaultValue) body.pinned_at = etWallToUtcIso(timeEl.value);
				ui.open.delete(id);
				await change('PATCH', '/clips/' + id, body);
			} else if (action === 'posted') await change('POST', '/clips/' + id + '/posts', {platform}, 'Marked as posted.');
			else if (action === 'unpost') await change('DELETE', '/clips/' + id + '/posts/' + platform, undefined, 'Undone.');
			else if (action === 'copy') {
				const ok = await copyText(doc, card.querySelector('code').textContent);
				say(ok ? 'Title copied.' : 'Copy failed. Select the title and copy it.', !ok);
			}
		}

		page.addEventListener('click', async ev => {
			const tabBtn = ev.target.closest('[data-tab]');
			if (tabBtn && tabBtn.tagName === 'BUTTON') {
				// Only flip the attributes: a re-render would drop a title the reviewer is typing.
				ui.tab = tabBtn.getAttribute('data-tab');
				groups.setAttribute('data-tab', ui.tab);
				for (const b of page.querySelectorAll('#tabs [data-tab]')) b.setAttribute('aria-selected', String(b === tabBtn));
				win.scrollTo({top: 0});
				return;
			}
			const card = ev.target.closest('#groups [data-id]');
			if (!card) return;
			select(card.getAttribute('data-id'), false);
			const button = ev.target.closest('button[data-action]');
			if (button) await run(button.getAttribute('data-action'), card, button.getAttribute('data-platform'));
		});

		page.addEventListener('toggle', ev => {
			const el = ev.target;
			if (el.tagName !== 'DETAILS') return;
			const id = el.getAttribute('data-id');
			if (el.open) ui.open.add(id);
			else ui.open.delete(id);
		}, true);

		page.addEventListener('input', ev => {
			if (!ev.target.classList.contains('title')) return;
			const count = ev.target.closest('.field').querySelector('.count');
			if (count) count.textContent = ev.target.value.length + '/100';
		});

		doc.addEventListener('keydown', async ev => {
			if (page.hidden) return;
			if (help.open) {
				if (ev.key === '?') { ev.preventDefault(); help.close(); }
				return;
			}
			const target = ev.target;
			const tag = target && target.tagName;
			const inField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
			// Let a focused button, link or row header take its own Enter and Space.
			if (!inField && (ev.key === ' ' || ev.key === 'Enter') && (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY')) return;
			const action = keyAction(ev, inField);
			if (!action) return;
			const fieldCard = inField ? target.closest('#groups [data-id]') : null;
			const card = fieldCard || (ui.sel != null ? groups.querySelector('[data-id="' + ui.sel + '"]') : null);
			ev.preventDefault();
			if (action === 'blur') return target.blur();
			if (action === 'help') return help.showModal();
			if (action === 'deselect') return select(null, false);
			if (action === 'next') return move(1);
			if (action === 'prev') return move(-1);
			if (!card) return move(1);
			if (action === 'submit') {
				target.blur();
				return run(card.getAttribute('data-kind') === 'review' ? 'accept' : 'save', card);
			}
			if (action === 'edit') return focusField(card, 'title');
			if (action === 'time') return focusField(card, 'time');
			if (action === 'play' || action === 'fullscreen') {
				if (card.tagName === 'DETAILS') card.open = true;
				const v = card.querySelector('video');
				if (!v) return;
				if (action === 'fullscreen') return (v.requestFullscreen || v.webkitEnterFullscreen || (() => {})).call(v);
				return v.paused ? v.play() : v.pause();
			}
			return run(action, card);
		});

		doc.getElementById('keys-btn').addEventListener('click', () => help.showModal());
		doc.getElementById('signout').addEventListener('click', () => {
			client.signOut();
			showSignIn();
		});
		// The video links are signed for one hour, so a tab that comes back gets fresh ones.
		doc.addEventListener('visibilitychange', () => {
			if (doc.visibilityState === 'visible' && client.signedIn() && !busy) load();
		});

		// While a clip goes out, show each platform's new state without a reload. Skip the
		// refresh while the reviewer types, because a re-render would drop the edit.
		win.setInterval(() => {
			const typing = doc.activeElement && ['INPUT', 'TEXTAREA'].includes(doc.activeElement.tagName);
			if (!busy && !typing && doc.visibilityState === 'visible' && client.signedIn() &&
				lastQueue && sections(lastQueue).postNow.length) load();
		}, 60000);

		if (client.signedIn()) load();
		else showSignIn();
	}

	const api = {
		TZ, PLATFORMS, formatSlot, relTime, summaryLine, sections, defaultTab, keyAction, platformsToPost, platformState,
		etWallToUtcIso, utcIsoToEtWall, escapeHtml, renderQueue, start,
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = api;
	} else {
		global.BlunderQueue = api;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
