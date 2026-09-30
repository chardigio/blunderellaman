// The admin page finds the stats at a URL derived from the passphrase, and the stats Lambda
// writes them there. If the two derivations drift, every correct passphrase reads as wrong.
// The vector below is also pinned in the stardust-labs repo:
// _infrastructure/_tests/test_blunderellaman_stats_lambda.py::test_admin_key_matches_the_browser_vector
const test = require('node:test');
const assert = require('node:assert/strict');
const admin = require('../site/admin/admin.js');

test('adminKey matches the Lambda vector', async () => {
	assert.equal(
		await admin.adminKey('correct horse battery staple'),
		'da9fad2598929b74d588c452fe33eeb3221fc7df3ebb335abc5efc3284d5f549',
	);
});

test('dataPath puts the key under /admin/data/', () => {
	assert.equal(admin.dataPath('abc'), '/admin/data/abc.json');
});

test('formatCount groups thousands', () => {
	assert.equal(admin.formatCount(0), '0');
	assert.equal(admin.formatCount(12345), '12,345');
});

test('formatRate is a whole percent, and a dash with no views', () => {
	assert.equal(admin.formatRate(3, 12), '25%');
	assert.equal(admin.formatRate(1, 3), '33%');
	assert.equal(admin.formatRate(1, 0), '–');
});

test('bars for today are hourly, other ranges are daily', () => {
	const stats = {
		today_hours: Array.from({length: 24}, (_, h) => h),
		days: Array.from({length: 90}, (_, i) => ({date: `d${i}`, views: i, visitors: 0, taps: 0})),
	};
	const today = admin.bars(stats, 'today');
	assert.equal(today.length, 24);
	assert.deepEqual(today[13], {label: '1 PM', value: 13});
	assert.deepEqual(today[0], {label: '12 AM', value: 0});
	const week = admin.bars(stats, '7d');
	assert.equal(week.length, 7);
	assert.deepEqual(week[6], {label: 'd89', value: 89});
	assert.equal(admin.bars(stats, '90d').length, 90);
});

test('shortDate reads as a month and day', () => {
	assert.equal(admin.shortDate('2026-09-29'), 'Sep 29');
});

test('escapeHtml neutralises a hostile referrer name', () => {
	assert.equal(admin.escapeHtml('<img src=x onerror=1>'), '&lt;img src=x onerror=1&gt;');
});
