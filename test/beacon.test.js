// The beacon URLs are the whole analytics contract: the stats Lambda in the stardust-labs repo
// (services/website_blunderellaman_dot_com/_infrastructure/stats_lambda/index.py) parses exactly
// these query strings out of the CloudFront logs. Change one side and the other must follow.
const test = require('node:test');
const assert = require('node:assert/strict');
const {viewUrl, tapUrl} = require('../site/beacon.js');

const params = url => Object.fromEntries(new URL(url, 'https://blunderellaman.com').searchParams);

test('a view carries the referrer origin and the utm source', () => {
	const url = viewUrl('?utm_source=tiktok_bio&x=1', 'https://www.twitch.tv/digimate?foo=bar');
	assert.ok(url.startsWith('/t.gif?'));
	assert.deepEqual(params(url), {e: 'view', ref: 'https://www.twitch.tv', utm_source: 'tiktok_bio'});
});

test('a direct view has no referrer or source', () => {
	assert.deepEqual(params(viewUrl('', '')), {e: 'view'});
});

test('a bad referrer is dropped, not sent raw', () => {
	assert.deepEqual(params(viewUrl('', 'not a url')), {e: 'view'});
});

test('a tap names the link', () => {
	assert.deepEqual(params(tapUrl('twitch')), {e: 'tap', l: 'twitch'});
});
