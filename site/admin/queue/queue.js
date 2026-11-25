// The shorts queue page (/admin/queue/).
//
// After each stream the clip bot puts its cuts here as "to review". A reviewer accepts or
// rejects each one and can fix its title. The server gives every accepted clip a time (three
// slots a day, Eastern) and plans the whole queue again after every change, so this page never
// computes a schedule: it shows the server's plan and sends edits.
//
// Until a real publisher is in place, a clip whose time comes shows up under "Post now". The
// reviewer posts it by hand and taps the button for each platform.
//
// Shipped as a file, not an inline <script>, so the Node tests load exactly what the page runs.
(function (global) {
	'use strict';

	const TZ = 'America/New_York';
	const PLATFORMS = ['youtube', 'tiktok'];
	const PLATFORM_LABELS = {youtube: 'YouTube Shorts', tiktok: 'TikTok'};
	const DAY_MS = 86400000;

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

	function byTime(a, b) {
		return String(a.scheduled_at || '').localeCompare(String(b.scheduled_at || ''));
	}

	function sections(queue) {
		const out = {postNow: [], review: [], scheduled: [], done: []};
		for (const c of queue.clips || []) {
			if (c.status === 'rejected' || (c.status === 'accepted' && fullyPosted(c))) out.done.push(c);
			else if (c.status === 'accepted' && platformsToPost(c).length) out.postNow.push(c);
			else if (c.status === 'accepted') out.scheduled.push(c);
			else out.review.push(c);
		}
		out.postNow.sort(byTime);
		out.scheduled.sort(byTime);
		out.review.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || a.rank - b.rank || a.id - b.id);
		out.done.sort((a, b) => byTime(b, a) || b.id - a.id);
		return out;
	}

	function joinList(items) {
		if (items.length <= 1) return items.join('');
		return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
	}

	// "7 ready. They go out Wed 11 am, Wed 3 pm, ... and Fri 11 am."
	function summaryLine(queue) {
		const ready = (queue.clips || [])
			.filter(c => c.status === 'accepted' && c.scheduled_at && !fullyPosted(c))
			.sort(byTime);
		if (!ready.length) return 'Nothing is scheduled yet. Accept a clip to give it a time.';
		const times = ready.map(c => formatSlot(c.scheduled_at, queue.now));
		return ready.length === 1
			? '1 ready. It goes out ' + times[0] + '.'
			: ready.length + ' ready. They go out ' + joinList(times) + '.';
	}

	function escapeHtml(s) {
		return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
	}

	// ---- the page ------------------------------------------------------------------------

	function video(c) {
		return c.video_url
			// `#t=0.1` makes Safari draw the first frame in place of a black box. The fragment
			// is not sent to the server, so the signed URL stays valid.
			? '<video src="' + escapeHtml(c.video_url) + '#t=0.1" preload="metadata" playsinline controls></video>'
			: '<div class="novideo">No video</div>';
	}

	function meta(c, queue, extra) {
		const bits = ['#' + c.rank];
		if (c.vod_time) bits.push('VOD ' + escapeHtml(c.vod_time));
		if (extra) bits.push(extra);
		return '<div class="meta">' + bits.join(' · ') + '</div>';
	}

	function titleInput(c) {
		return '<label class="field"><span>Title</span><input class="title" maxlength="100" value="' + escapeHtml(c.title) + '"></label>';
	}

	function reviewCard(c, queue) {
		return '<article class="clip" data-id="' + c.id + '">' + video(c) + '<div class="body">' +
			meta(c, queue) + titleInput(c) +
			(c.note ? '<p class="note">' + escapeHtml(c.note) + '</p>' : '') +
			'<div class="actions">' +
			'<button type="button" class="primary" data-action="accept">Accept</button>' +
			'<button type="button" data-action="reject">Reject</button>' +
			'</div></div></article>';
	}

	function scheduledCard(c, queue) {
		const when = c.scheduled_at ? formatSlot(c.scheduled_at, queue.now) + (c.pinned_at ? ' (your time)' : '') : 'No time';
		return '<article class="clip" data-id="' + c.id + '">' + video(c) + '<div class="body">' +
			'<div class="when">' + escapeHtml(when) + '</div>' +
			meta(c, queue) + titleInput(c) +
			'<label class="field"><span>Time (Eastern)</span><input class="time" type="datetime-local" step="300" value="' +
			(c.scheduled_at ? utcIsoToEtWall(c.scheduled_at) : '') + '"></label>' +
			'<div class="actions">' +
			'<button type="button" class="primary" data-action="save">Save</button>' +
			(c.pinned_at ? '<button type="button" data-action="auto">Use the auto time</button>' : '') +
			'<button type="button" data-action="unaccept">Back to review</button>' +
			'<button type="button" data-action="reject">Reject</button>' +
			'</div></div></article>';
	}

	function postNowCard(c, queue) {
		const buttons = platformsToPost(c).map(p => {
			const failed = postStatus(c, p) === 'failed';
			return '<button type="button" class="primary" data-action="posted" data-platform="' + p + '">' +
				'I posted it on ' + PLATFORM_LABELS[p] + '</button>' +
				(failed ? '<span class="err">' + escapeHtml(c.posts[p].error || 'The upload failed.') + '</span>' : '');
		}).join('');
		return '<article class="clip due" data-id="' + c.id + '">' + video(c) + '<div class="body">' +
			'<div class="when">Due ' + escapeHtml(formatSlot(c.scheduled_at, queue.now)) + '</div>' +
			meta(c, queue) +
			'<div class="copyrow"><code>' + escapeHtml(c.title) + '</code>' +
			'<button type="button" data-action="copy">Copy title</button></div>' +
			(c.video_url ? '<a class="download" href="' + escapeHtml(c.video_url) + '" target="_blank" rel="noopener">Open the video to save it</a>' : '') +
			'<div class="actions">' + buttons + '</div></div></article>';
	}

	function doneRow(c, queue) {
		let state;
		let actions = '';
		if (c.status === 'rejected') {
			state = 'Rejected';
			actions = '<button type="button" data-action="unaccept">Restore</button>';
		} else {
			state = 'Posted ' + escapeHtml(formatSlot(c.scheduled_at, queue.now));
			actions = PLATFORMS.map(p => {
				const post = c.posts[p];
				const label = PLATFORM_LABELS[p];
				const link = post && post.external_url
					? '<a href="' + escapeHtml(post.external_url) + '" target="_blank" rel="noopener">' + label + '</a>'
					: label;
				return '<span class="plat">' + link +
					' <button type="button" class="small" data-action="unpost" data-platform="' + p + '">Undo</button></span>';
			}).join('');
		}
		return '<li class="done-row" data-id="' + c.id + '"><div><strong>' + escapeHtml(c.title) + '</strong>' +
			'<div class="meta">' + state + '</div></div><div class="actions">' + actions + '</div></li>';
	}

	function section(title, hint, html, empty) {
		return '<section class="group"><h2>' + title + '</h2>' + (hint ? '<p class="hint">' + hint + '</p>' : '') +
			(html || '<p class="empty">' + empty + '</p>') + '</section>';
	}

	function renderQueue(root, queue) {
		const s = sections(queue);
		root.querySelector('#summary').textContent = summaryLine(queue);
		root.querySelector('#groups').innerHTML =
			(s.postNow.length ? section('Post now', 'These are due. Post each one, then tap the button for each platform.',
				s.postNow.map(c => postNowCard(c, queue)).join('')) : '') +
			section('To review', 'Accept the clips you want. Fix a title before you accept it.',
				s.review.map(c => reviewCard(c, queue)).join(''), 'No clips to review.') +
			section('Scheduled', 'Times are Eastern. Three a day: 11 am, 3 pm and 7 pm. Set a time to move a clip; the others move around it.',
				s.scheduled.map(c => scheduledCard(c, queue)).join(''), 'No clips are scheduled.') +
			(s.done.length ? section('Done', 'The last two weeks.',
				'<ul class="done">' + s.done.map(c => doneRow(c, queue)).join('') + '</ul>') : '');
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
		const status = doc.getElementById('status');
		let busy = false;

		function say(text, isError) {
			status.textContent = text || '';
			status.classList.toggle('error', Boolean(isError));
			status.hidden = !text;
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

		async function load() {
			page.hidden = false;
			doc.getElementById('who').textContent = client.email();
			try {
				const queue = await call('GET', '/clips');
				if (queue) renderQueue(page, queue);
			} catch (err) {
				say(err.message, true);
			}
		}

		async function change(method, path, body, done) {
			if (busy) return;
			busy = true;
			page.classList.add('busy');
			say('Saving…');
			try {
				const queue = await call(method, path, body);
				if (queue) {
					renderQueue(page, queue);
					say(done || 'Saved.');
				}
			} catch (err) {
				say(err.message, true);
			} finally {
				busy = false;
				page.classList.remove('busy');
			}
		}

		page.addEventListener('click', async ev => {
			const button = ev.target.closest('button[data-action]');
			if (!button) return;
			const card = button.closest('[data-id]');
			const id = card.getAttribute('data-id');
			const titleEl = card.querySelector('input.title');
			const timeEl = card.querySelector('input.time');
			const title = titleEl ? titleEl.value : undefined;
			const action = button.getAttribute('data-action');
			const platform = button.getAttribute('data-platform');
			if (action === 'accept') await change('PATCH', '/clips/' + id, {status: 'accepted', title}, 'Accepted.');
			else if (action === 'reject') await change('PATCH', '/clips/' + id, {status: 'rejected'}, 'Rejected.');
			else if (action === 'unaccept') await change('PATCH', '/clips/' + id, {status: 'pending'}, 'Back in review.');
			else if (action === 'auto') await change('PATCH', '/clips/' + id, {pinned_at: null}, 'Back to the auto time.');
			else if (action === 'save') {
				const body = {title};
				const original = timeEl.defaultValue;
				if (timeEl.value && timeEl.value !== original) body.pinned_at = etWallToUtcIso(timeEl.value);
				await change('PATCH', '/clips/' + id, body);
			} else if (action === 'posted') await change('POST', '/clips/' + id + '/posts', {platform}, 'Marked as posted.');
			else if (action === 'unpost') await change('DELETE', '/clips/' + id + '/posts/' + platform, undefined, 'Undone.');
			else if (action === 'copy') {
				const ok = await copyText(doc, card.querySelector('code').textContent);
				say(ok ? 'Title copied.' : 'Copy failed. Select the title and copy it.', !ok);
			}
		});

		doc.getElementById('signout').addEventListener('click', () => {
			client.signOut();
			showSignIn();
		});
		// The video links are signed for one hour, so a tab that comes back gets fresh ones.
		doc.addEventListener('visibilitychange', () => {
			if (doc.visibilityState === 'visible' && client.signedIn() && !busy) load();
		});

		if (client.signedIn()) load();
		else showSignIn();
	}

	const api = {
		TZ, PLATFORMS, formatSlot, summaryLine, sections, platformsToPost, etWallToUtcIso, utcIsoToEtWall,
		escapeHtml, renderQueue, start,
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = api;
	} else {
		global.BlunderQueue = api;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
