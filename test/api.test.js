// The shared sign-in for the admin pages that call api.blunderellaman.com (the clip queue, and
// the blunderbot viewer after it). Both pages use the one storage key, so one sign-in covers both.
const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../site/admin/api.js');

function memoryStorage() {
	const data = {};
	return {
		getItem: k => (k in data ? data[k] : null),
		setItem: (k, v) => { data[k] = String(v); },
		removeItem: k => { delete data[k]; },
		data,
	};
}

function fakeFetch(routes) {
	const calls = [];
	const fn = async (url, opts = {}) => {
		calls.push({url, opts});
		const handler = routes.shift();
		const {status, body} = handler(url, opts);
		return {ok: status >= 200 && status < 300, status, json: async () => body};
	};
	fn.calls = calls;
	return fn;
}

test('the storage key is shared with the blunderbot viewer', () => {
	assert.equal(api.STORAGE_KEY, 'blunderellaman_auth');
});

test('apiBase is the production API, and the local server on localhost', () => {
	assert.equal(api.apiBase({hostname: 'blunderellaman.com'}), 'https://api.blunderellaman.com');
	assert.equal(api.apiBase({hostname: 'www.blunderellaman.com'}), 'https://api.blunderellaman.com');
	assert.equal(api.apiBase({hostname: 'localhost'}), 'http://127.0.0.1:5558');
	assert.equal(api.apiBase({hostname: '127.0.0.1'}), 'http://127.0.0.1:5558');
});

test('signIn stores the tokens with the install id it sent', async () => {
	const storage = memoryStorage();
	const fetch = fakeFetch([
		() => ({status: 200, body: {access_token: 'A', refresh_token: 'R'}}),
	]);
	const client = api.createClient({fetch, storage, base: 'https://x', uuid: () => 'install-1'});
	await client.verifyCode(' Me@Example.com ', '123456');
	const sent = JSON.parse(fetch.calls[0].opts.body);
	assert.deepEqual(sent, {email: 'me@example.com', code: '123456', install_id: 'install-1'});
	assert.deepEqual(JSON.parse(storage.data.blunderellaman_auth), {
		access_token: 'A', refresh_token: 'R', install_id: 'install-1', email: 'me@example.com',
	});
	assert.equal(client.signedIn(), true);
});

test('requestCode surfaces the server message for an email off the list', async () => {
	const fetch = fakeFetch([() => ({status: 403, body: {detail: 'This email cannot sign in.'}})]);
	const client = api.createClient({fetch, storage: memoryStorage(), base: 'https://x'});
	await assert.rejects(client.requestCode('x@example.com'), /cannot sign in/);
});

test('a 401 refreshes once and retries with the new token', async () => {
	const storage = memoryStorage();
	storage.setItem('blunderellaman_auth', JSON.stringify({access_token: 'old', refresh_token: 'R', install_id: 'i', email: 'e'}));
	const fetch = fakeFetch([
		() => ({status: 401, body: {detail: 'expired'}}),
		() => ({status: 200, body: {access_token: 'new', refresh_token: 'R2'}}),
		() => ({status: 200, body: {clips: []}}),
	]);
	const client = api.createClient({fetch, storage, base: 'https://x'});
	assert.deepEqual(await client.request('GET', '/clips'), {clips: []});
	assert.equal(fetch.calls[1].url, 'https://x/auth/refresh');
	assert.equal(fetch.calls[1].opts.headers.Authorization, 'Bearer old');
	assert.equal(fetch.calls[2].opts.headers.Authorization, 'Bearer new');
	assert.equal(JSON.parse(storage.data.blunderellaman_auth).refresh_token, 'R2');
});

test('a failed refresh signs out', async () => {
	const storage = memoryStorage();
	storage.setItem('blunderellaman_auth', JSON.stringify({access_token: 'old', refresh_token: 'R', install_id: 'i', email: 'e'}));
	const fetch = fakeFetch([
		() => ({status: 401, body: {}}),
		() => ({status: 401, body: {}}),
	]);
	const client = api.createClient({fetch, storage, base: 'https://x'});
	await assert.rejects(client.request('GET', '/clips'), err => err.status === 401);
	assert.equal(client.signedIn(), false);
	assert.equal(storage.data.blunderellaman_auth, undefined);
});

test('a JSON body is sent with its content type', async () => {
	const storage = memoryStorage();
	storage.setItem('blunderellaman_auth', JSON.stringify({access_token: 'T', refresh_token: 'R', install_id: 'i', email: 'e'}));
	const fetch = fakeFetch([() => ({status: 200, body: {}})]);
	const client = api.createClient({fetch, storage, base: 'https://x'});
	await client.request('PATCH', '/clips/1', {status: 'accepted'});
	assert.equal(fetch.calls[0].opts.method, 'PATCH');
	assert.equal(fetch.calls[0].opts.headers['Content-Type'], 'application/json');
	assert.equal(fetch.calls[0].opts.body, '{"status":"accepted"}');
});
