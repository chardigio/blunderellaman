// The link list is the page's whole job, and a wrong handle fails silently: the link still opens,
// just to someone else's profile. These tests pin each link's target and the handle shown under
// it, so a handle change must update both.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'site', 'index.html'), 'utf8');

function link(name) {
	const match = html.match(
		new RegExp(`<a data-link="${name}" href="([^"]+)"[\\s\\S]*?<span class="handle">([^<]+)</span>`),
	);
	assert.ok(match, `no a[data-link="${name}"] with a handle in site/index.html`);
	return {href: match[1], handle: match[2]};
}

test('Instagram goes to @blunderellaman', () => {
	assert.deepEqual(link('instagram'), {
		href: 'https://www.instagram.com/blunderellaman/',
		handle: '@blunderellaman',
	});
});

test('the other links keep their targets', () => {
	assert.equal(link('twitch').href, 'https://www.twitch.tv/blunderellaman');
	assert.equal(link('youtube').href, 'https://www.youtube.com/@blunderellaman');
	assert.equal(link('tiktok').href, 'https://www.tiktok.com/@blunderellaman');
	assert.equal(link('chesscom').href, 'https://www.chess.com/member/blunderellaman');
});

test('the rebranded links show blunderellaman handles', () => {
	assert.equal(link('twitch').handle, 'twitch.tv/blunderellaman');
	assert.equal(link('youtube').handle, '@blunderellaman');
	assert.equal(link('tiktok').handle, '@blunderellaman');
});
