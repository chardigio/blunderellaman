// The sign-in and the API client for the admin pages that call api.blunderellaman.com: the
// shorts queue (/admin/queue/), and the blunderbot viewer after it.
//
// The login is an email + 6-digit code. Only the emails on a list in the private backend can
// get a code, so this public file holds no list and no secret. Both pages keep the tokens under
// one storage key, so one sign-in covers both.
//
// Shipped as a file, not an inline <script>, so the Node tests load exactly what the page runs.
(function (global) {
	'use strict';

	const STORAGE_KEY = 'blunderellaman_auth';
	const PROD_API = 'https://api.blunderellaman.com';
	// `uv run python -m services.blunderellaman.server` in the stardust-labs repo.
	const LOCAL_API = 'http://127.0.0.1:5558';

	function apiBase(location) {
		const host = (location && location.hostname) || '';
		return host === 'localhost' || host === '127.0.0.1' ? LOCAL_API : PROD_API;
	}

	function normalizeEmail(email) {
		return String(email || '').replace(/\s+/g, '').toLowerCase();
	}

	function randomUuid() {
		if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
		// Old Safari: a v4 UUID from Math.random is fine for an install id, which is not a secret.
		return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
			const r = Math.random() * 16 | 0;
			return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
		});
	}

	class ApiError extends Error {
		constructor(status, detail) {
			super(detail || ('Request failed (' + status + ')'));
			this.status = status;
		}
	}

	function createClient({fetch, storage, base, uuid}) {
		const makeUuid = uuid || randomUuid;

		function load() {
			try {
				const raw = storage.getItem(STORAGE_KEY);
				return raw ? JSON.parse(raw) : null;
			} catch (e) {
				return null;
			}
		}

		function save(auth) {
			try { storage.setItem(STORAGE_KEY, JSON.stringify(auth)); } catch (e) { /* private mode */ }
		}

		function signOut() {
			try { storage.removeItem(STORAGE_KEY); } catch (e) { /* private mode */ }
		}

		async function send(method, path, body, token) {
			const headers = {};
			if (token) headers.Authorization = 'Bearer ' + token;
			const opts = {method, headers};
			if (body !== undefined) {
				headers['Content-Type'] = 'application/json';
				opts.body = JSON.stringify(body);
			}
			const res = await fetch(base + path, opts);
			let data = null;
			try { data = await res.json(); } catch (e) { data = null; }
			if (!res.ok) {
				const detail = data && typeof data.detail === 'string' ? data.detail : null;
				throw new ApiError(res.status, detail);
			}
			return data;
		}

		async function requestCode(email) {
			return send('POST', '/auth/email-code', {email: normalizeEmail(email)});
		}

		async function verifyCode(email, code) {
			const clean = normalizeEmail(email);
			const installId = (load() || {}).install_id || makeUuid();
			const data = await send('POST', '/auth/email-code/verify', {
				email: clean, code: String(code).trim(), install_id: installId,
			});
			save({access_token: data.access_token, refresh_token: data.refresh_token, install_id: installId, email: clean});
			return data;
		}

		async function refresh(auth) {
			const data = await send('POST', '/auth/refresh', {
				refresh_token: auth.refresh_token, install_id: auth.install_id,
			}, auth.access_token);
			const next = Object.assign({}, auth, {access_token: data.access_token, refresh_token: data.refresh_token});
			save(next);
			return next;
		}

		// An access token lives 24 hours. On a 401 the client refreshes once and retries, so a
		// reviewer who opens the page the next day does not have to sign in again.
		async function request(method, path, body) {
			const auth = load();
			if (!auth) throw new ApiError(401, 'Sign in first.');
			try {
				return await send(method, path, body, auth.access_token);
			} catch (err) {
				if (err.status !== 401) throw err;
				let next;
				try {
					next = await refresh(auth);
				} catch (refreshErr) {
					signOut();
					throw new ApiError(401, 'Your sign-in expired. Sign in again.');
				}
				return send(method, path, body, next.access_token);
			}
		}

		return {
			requestCode,
			verifyCode,
			request,
			signOut,
			signedIn: () => Boolean(load()),
			email: () => (load() || {}).email || '',
		};
	}

	function escapeHtml(s) {
		return String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
	}

	// Draws the two-step sign-in (email, then the 6-digit code) into `el`, and calls
	// `onSignedIn()` after a good code. Each admin page that uses the API calls this, so the
	// sign-in looks and works the same on every page. The page styles it through `.bl-signin`.
	function mountSignIn(el, client, {title, onSignedIn}) {
		const doc = el.ownerDocument;
		let email = '';

		function draw(step, error) {
			el.innerHTML =
				'<form class="bl-signin" autocomplete="on">' +
				'<h1>' + escapeHtml(title) + '</h1>' +
				(step === 'email'
					? '<p>Type your email. We send you a 6-digit code.</p>' +
					  '<input name="email" type="email" autocomplete="email" required aria-label="Email" value="' + escapeHtml(email) + '">' +
					  '<button type="submit">Send the code</button>'
					: '<p>Type the code that we sent to ' + escapeHtml(email) + '.</p>' +
					  '<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required aria-label="Code">' +
					  '<button type="submit">Sign in</button>' +
					  '<button type="button" class="bl-back">Use a different email</button>') +
				'<p class="bl-error" role="alert"' + (error ? '' : ' hidden') + '>' + escapeHtml(error || '') + '</p>' +
				'</form>';
			const form = el.querySelector('form');
			const input = form.querySelector('input');
			input.focus();
			const back = form.querySelector('.bl-back');
			if (back) back.addEventListener('click', () => draw('email'));
			form.addEventListener('submit', async ev => {
				ev.preventDefault();
				const button = form.querySelector('button[type=submit]');
				button.disabled = true;
				try {
					if (step === 'email') {
						email = normalizeEmail(input.value);
						const res = await client.requestCode(email);
						// Off prod, an @example.com test address gets its code back at once.
						if (res && res.auto_verify_code) {
							await client.verifyCode(email, res.auto_verify_code);
							el.innerHTML = '';
							onSignedIn();
							return;
						}
						draw('code');
					} else {
						await client.verifyCode(email, input.value);
						el.innerHTML = '';
						onSignedIn();
					}
				} catch (err) {
					draw(step, err.message || 'Something went wrong. Try again.');
				}
			});
		}

		draw('email');
		return doc;
	}

	// The client for this page's own origin, with the browser's fetch and localStorage.
	function browserClient() {
		let storage;
		try { storage = global.localStorage; } catch (e) { storage = null; }
		const memory = {};
		return createClient({
			fetch: global.fetch.bind(global),
			storage: storage || {
				getItem: k => memory[k] || null, setItem: (k, v) => { memory[k] = v; }, removeItem: k => { delete memory[k]; },
			},
			base: apiBase(global.location),
		});
	}

	const api = {STORAGE_KEY, apiBase, normalizeEmail, createClient, browserClient, mountSignIn, escapeHtml, ApiError};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = api;
	} else {
		global.BlunderApi = api;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
