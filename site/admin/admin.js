// The /admin stats page.
//
// There is no server to sign in to. An hourly job writes the stats to
// /admin/data/<key>.json, where <key> is a slow hash of the passphrase, and the bucket does not
// allow listing. So "signing in" is deriving the same key here and fetching that file: a 404
// means a wrong passphrase. adminKey must match admin_key in the stardust-labs repo's
// services/website_blunderellaman_dot_com/_infrastructure/stats_lambda/index.py byte for byte.
//
// Shipped as a file, not an inline <script>, so the Node tests load exactly what the page runs.
(function (global) {
	'use strict';

	const SALT = 'blunderellaman.com/admin';
	// 600k PBKDF2-SHA256 rounds: the key is a public URL path, so how slow a guess is is the
	// only thing that protects it. The page pays this once per sign-in.
	const ITERATIONS = 600000;
	const STORAGE_KEY = 'blunderellaman-admin-key';

	const RANGES = [
		{id: 'today', label: 'Today'},
		{id: '7d', label: '7 days'},
		{id: '30d', label: '30 days'},
		{id: '90d', label: '90 days'},
	];
	const RANGE_DAYS = {'7d': 7, '30d': 30, '90d': 90};

	const SITE_URL = 'https://blunderellaman.com/';

	// One tagged link per place the URL gets posted, so views land in the right
	// "utm_source tags" row. `tag: null` is the plain, untagged link.
	const SHARE_SOURCES = [
		{label: 'TikTok bio', tag: 'tiktok_bio'},
		{label: 'Instagram bio', tag: 'instagram_bio'},
		{label: 'YouTube description', tag: 'youtube_description'},
		{label: 'Twitch panels', tag: 'twitch_panels'},
		{label: 'Plain link (no tag)', tag: null},
	];

	function shareLink(tag) {
		return tag ? SITE_URL + '?utm_source=' + encodeURIComponent(tag) : SITE_URL;
	}

	function shareLinks() {
		return SHARE_SOURCES.map(src => ({label: src.label, tag: src.tag, url: shareLink(src.tag)}));
	}

	// data-link names on the home page, shown as people would say them.
	const LINK_LABELS = {
		twitch: 'Twitch',
		youtube: 'YouTube',
		tiktok: 'TikTok',
		instagram: 'Instagram',
		chesscom: 'chess.com profile',
		chesscom_tracker: 'chess.com (rating card)',
		game: 'A recent game',
	};
	const DEVICE_LABELS = {mobile: 'Phone', tablet: 'Tablet', desktop: 'Computer'};
	const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

	async function adminKey(passphrase) {
		const subtle = global.crypto.subtle;
		const enc = new TextEncoder();
		const material = await subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveBits']);
		const bits = await subtle.deriveBits(
			{name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(SALT), iterations: ITERATIONS},
			material,
			256,
		);
		return Array.from(new Uint8Array(bits), b => b.toString(16).padStart(2, '0')).join('');
	}

	function dataPath(key) {
		return '/admin/data/' + key + '.json';
	}

	function formatCount(n) {
		return Number(n || 0).toLocaleString('en-US');
	}

	function formatRate(part, whole) {
		return whole ? Math.round((100 * part) / whole) + '%' : '–';
	}

	function hourLabel(hour) {
		const h = hour % 12 === 0 ? 12 : hour % 12;
		return h + (hour < 12 ? ' AM' : ' PM');
	}

	function shortDate(iso) {
		const [, m, d] = iso.split('-').map(Number);
		return MONTHS[m - 1] + ' ' + d;
	}

	function bars(stats, range) {
		if (range === 'today') {
			return stats.today_hours.map((value, hour) => ({label: hourLabel(hour), value: value}));
		}
		return stats.days.slice(-RANGE_DAYS[range]).map(d => ({label: d.date, value: d.views}));
	}

	function escapeHtml(s) {
		return String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);
	}


	function copyText(doc, text) {
		if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
			return global.navigator.clipboard.writeText(text);
		}
		return new Promise((resolve, reject) => {
			const ta = doc.createElement('textarea');
			ta.value = text;
			ta.style.position = 'fixed';
			ta.style.opacity = '0';
			doc.body.appendChild(ta);
			ta.select();
			try {
				if (doc.execCommand('copy')) resolve();
				else reject(new Error('copy_failed'));
			} catch (e) {
				reject(e);
			}
			doc.body.removeChild(ta);
		});
	}

	function renderShare(doc) {
		const list = doc.querySelector('#share .share-list');
		list.innerHTML = shareLinks()
			.map(
				(s, i) => `<li>
				<span class="slabel">${escapeHtml(s.label)}</span>
				<code>${escapeHtml(s.url)}</code>
				<button type="button" data-copy="${i}">Copy</button>
			</li>`,
			)
			.join('');
	}

	// ---- browser only below -------------------------------------------------------------

	function storage(fn) {
		try {
			return fn(global.localStorage);
		} catch (e) {
			return null;
		}
	}

	function table(title, rows, labels, empty) {
		const total = rows.reduce((sum, r) => sum + r[1], 0);
		const body = rows.length
			? rows
					.map(
						([name, count]) => `<tr>
				<th scope="row">${escapeHtml((labels && labels[name]) || name)}</th>
				<td><span class="share" style="--w:${total ? (100 * count) / total : 0}%"></span>${formatCount(count)}</td>
			</tr>`,
					)
					.join('')
			: `<tr><td colspan="2" class="empty">${escapeHtml(empty)}</td></tr>`;
		return `<section class="panel"><h2>${escapeHtml(title)}</h2><table>${body}</table></section>`;
	}

	function renderChart(el, stats, range) {
		const items = bars(stats, range);
		const max = Math.max(1, ...items.map(b => b.value));
		const name = range === 'today' ? label => label : shortDate;
		const unit = v => (v === 1 ? 'view' : 'views');
		const readout = el.querySelector('.readout');
		const resting = `${formatCount(items.reduce((s, b) => s + b.value, 0))} views, ${
			range === 'today' ? 'by hour' : 'by day'
		}`;
		readout.textContent = resting;
		const plot = el.querySelector('.plot');
		plot.style.setProperty('--n', items.length);
		plot.innerHTML = items
			.map(
				b => `<div class="bar" tabindex="0" data-tip="${escapeHtml(name(b.label))}: ${formatCount(b.value)} ${unit(
					b.value,
				)}" aria-label="${escapeHtml(name(b.label))}: ${formatCount(b.value)} ${unit(b.value)}">
				<span style="height:${(100 * b.value) / max}%"></span></div>`,
			)
			.join('');
		const show = e => {
			const bar = e.target.closest('.bar');
			readout.textContent = bar ? bar.dataset.tip : resting;
		};
		plot.onmouseover = show;
		plot.onfocusin = show;
		plot.onclick = show;
		plot.onmouseleave = () => (readout.textContent = resting);
		const axis = el.querySelector('.axis');
		axis.innerHTML = `<span>${escapeHtml(name(items[0].label))}</span><span>${escapeHtml(
			name(items[items.length - 1].label),
		)}</span>`;
	}

	function renderStats(doc, stats, range) {
		const s = stats.ranges[range];
		doc.getElementById('tiles').innerHTML = [
			['Views', formatCount(s.views)],
			['Visitors', formatCount(s.visitors)],
			['Link taps', formatCount(s.taps)],
			['Tap rate', formatRate(s.taps, s.views)],
		]
			.map(([label, value]) => `<div class="tile"><div class="label">${label}</div><div class="value">${value}</div></div>`)
			.join('');
		renderChart(doc.getElementById('chart'), stats, range);
		doc.getElementById('tables').innerHTML = [
			table('Link taps', s.links, LINK_LABELS, 'No taps yet.'),
			table('Where visitors came from', s.referrers, null, 'No views yet.'),
			table('utm_source tags', s.sources, null, 'No tagged links yet. Add ?utm_source=name to a link you post.'),
			table('Devices', s.devices, DEVICE_LABELS, 'No views yet.'),
		].join('');
		for (const button of doc.querySelectorAll('#ranges button')) {
			button.setAttribute('aria-pressed', String(button.dataset.range === range));
		}
		const updated = new Date(stats.generated_at);
		doc.getElementById('updated').textContent =
			'Updated ' + updated.toLocaleString([], {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'});
	}

	async function start(doc) {
		const signin = doc.getElementById('signin');
		const dash = doc.getElementById('dash');
		const error = doc.getElementById('signin-error');
		const submit = signin.querySelector('button');
		let range = 'today';
		let stats = null;

		doc.getElementById('ranges').innerHTML = RANGES.map(
			r => `<button type="button" data-range="${r.id}" aria-pressed="false">${r.label}</button>`,
		).join('');
		doc.getElementById('share').addEventListener('click', e => {
			const button = e.target.closest('button[data-copy]');
			if (!button) return;
			const url = shareLinks()[Number(button.dataset.copy)].url;
			button.disabled = true;
			copyText(doc, url).then(
				() => (button.textContent = 'Copied ✓'),
				() => (button.textContent = 'Copy failed'),
			);
			setTimeout(() => {
				button.textContent = 'Copy';
				button.disabled = false;
			}, 1500);
		});

		doc.getElementById('ranges').addEventListener('click', e => {
			const button = e.target.closest('button');
			if (!button || !stats) return;
			range = button.dataset.range;
			renderStats(doc, stats, range);
		});

		async function open(key) {
			const res = await global.fetch(dataPath(key), {cache: 'no-store'});
			if (!res.ok) return false;
			stats = await res.json();
			storage(s => s.setItem(STORAGE_KEY, key));
			signin.hidden = true;
			dash.hidden = false;
			renderShare(doc);
			renderStats(doc, stats, range);
			return true;
		}

		signin.addEventListener('submit', async e => {
			e.preventDefault();
			error.hidden = true;
			submit.disabled = true;
			submit.textContent = 'Checking…';
			try {
				const key = await adminKey(signin.elements.passphrase.value);
				if (!(await open(key))) {
					error.textContent =
						'No stats match that passphrase. Check it. After the first deploy, the stats can take up to an hour to appear.';
					error.hidden = false;
				}
			} catch (err) {
				error.textContent = 'Could not load the stats. Check the connection and try again.';
				error.hidden = false;
			} finally {
				submit.disabled = false;
				submit.textContent = 'Open stats';
			}
		});

		doc.getElementById('signout').addEventListener('click', () => {
			storage(s => s.removeItem(STORAGE_KEY));
			stats = null;
			dash.hidden = true;
			signin.hidden = false;
			signin.reset();
		});

		const saved = storage(s => s.getItem(STORAGE_KEY));
		if (saved) {
			try {
				if (await open(saved)) return;
			} catch (e) {
				/* fall through to the form */
			}
			storage(s => s.removeItem(STORAGE_KEY));
		}
		signin.hidden = false;
	}

	const api = {adminKey, dataPath, formatCount, formatRate, bars, shortDate, escapeHtml, shareLink, shareLinks, start};
	if (typeof module !== 'undefined' && module.exports) {
		module.exports = api;
	} else {
		global.BlunderAdmin = api;
	}
})(typeof window !== 'undefined' ? window : globalThis);
