// The shorts queue page. The schedule itself is planned on the server; these tests pin how the
// page groups the clips, says the schedule out loud, and turns an Eastern time into UTC.
const test = require('node:test');
const assert = require('node:assert/strict');
const q = require('../site/admin/queue/queue.js');

function clip(over) {
	return Object.assign({
		id: 1, status: 'pending', title: 't', rank: 1, created_at: '2026-12-02T14:00:00Z',
		scheduled_at: null, pinned_at: null, posts: {youtube: null, tiktok: null},
	}, over);
}

const NOW = '2026-12-02T15:00:00Z'; // Wed 10 am Eastern

test('formatSlot says the Eastern day and time, short within a week', () => {
	assert.equal(q.formatSlot('2026-12-02T16:00:00Z', NOW), 'Wed 11 am');
	assert.equal(q.formatSlot('2026-12-02T20:00:00Z', NOW), 'Wed 3 pm');
	assert.equal(q.formatSlot('2026-12-03T00:30:00Z', NOW), 'Wed 7:30 pm');
	assert.equal(q.formatSlot('2026-12-03T17:00:00Z', NOW), 'Thu 12 pm');
	assert.equal(q.formatSlot('2026-12-15T16:00:00Z', NOW), 'Dec 15, 11 am');
});

test('summaryLine lists when each accepted clip goes out, in order', () => {
	const queue = {now: NOW, clips: [
		clip({id: 2, status: 'accepted', scheduled_at: '2026-12-02T20:00:00Z'}),
		clip({id: 1, status: 'accepted', scheduled_at: '2026-12-02T16:00:00Z'}),
		clip({id: 3, status: 'pending'}),
		clip({id: 4, status: 'rejected'}),
	]};
	assert.equal(q.summaryLine(queue), '2 ready. They go out Wed 11 am and Wed 3 pm.');
});

test('summaryLine with one, three, and none', () => {
	const at = iso => clip({status: 'accepted', scheduled_at: iso});
	assert.equal(q.summaryLine({now: NOW, clips: [at('2026-12-02T16:00:00Z')]}), '1 ready. It goes out Wed 11 am.');
	assert.equal(
		q.summaryLine({now: NOW, clips: [at('2026-12-02T16:00:00Z'), at('2026-12-02T20:00:00Z'), at('2026-12-03T00:00:00Z')]}),
		'3 ready. They go out Wed 11 am, Wed 3 pm and Wed 7 pm.',
	);
	assert.equal(q.summaryLine({now: NOW, clips: [clip({status: 'pending'})]}), 'Nothing is scheduled yet. Accept a clip to give it a time.');
});

test('summaryLine does not count a clip that already went out', () => {
	const posted = {status: 'posted'};
	const queue = {now: NOW, clips: [
		clip({status: 'accepted', scheduled_at: '2026-12-02T11:00:00Z', posts: {youtube: posted, tiktok: posted}}),
		clip({status: 'accepted', scheduled_at: '2026-12-02T16:00:00Z'}),
	]};
	assert.equal(q.summaryLine(queue), '1 ready. It goes out Wed 11 am.');
});

test('etWallToUtcIso reads a datetime-local value as Eastern time, across DST', () => {
	assert.equal(q.etWallToUtcIso('2026-12-02T16:00'), '2026-12-02T21:00:00.000Z');
	assert.equal(q.etWallToUtcIso('2026-07-04T11:30'), '2026-07-04T15:30:00.000Z');
	assert.equal(q.etWallToUtcIso(''), null);
});

test('utcIsoToEtWall is the inverse, for the time input', () => {
	assert.equal(q.utcIsoToEtWall('2026-12-02T21:00:00Z'), '2026-12-02T16:00');
	assert.equal(q.utcIsoToEtWall('2026-07-04T15:30:00Z'), '2026-07-04T11:30');
});

test('sections sorts each clip into one place', () => {
	const posted = {status: 'posted'};
	const waiting = {status: 'awaiting_manual'};
	const clips = [
		clip({id: 1, status: 'pending', rank: 2}),
		clip({id: 2, status: 'pending', rank: 1}),
		clip({id: 3, status: 'accepted', scheduled_at: '2026-12-03T16:00:00Z'}),
		clip({id: 4, status: 'accepted', scheduled_at: '2026-12-02T16:00:00Z'}),
		clip({id: 5, status: 'accepted', scheduled_at: '2026-12-02T11:00:00Z', posts: {youtube: waiting, tiktok: posted}}),
		clip({id: 6, status: 'accepted', scheduled_at: '2026-12-01T16:00:00Z', posts: {youtube: posted, tiktok: posted}}),
		clip({id: 7, status: 'rejected'}),
		clip({id: 8, status: 'accepted', scheduled_at: '2026-12-02T11:00:00Z', posts: {youtube: {status: 'failed'}, tiktok: null}}),
	];
	const s = q.sections({now: NOW, clips});
	assert.deepEqual(s.postNow.map(c => c.id), [5, 8]);
	assert.deepEqual(s.review.map(c => c.id), [2, 1]);
	assert.deepEqual(s.scheduled.map(c => c.id), [4, 3]);
	assert.deepEqual(s.done.map(c => c.id), [6, 7]);
});

test('postedOn lists the platforms that still need a manual post', () => {
	const c = clip({posts: {youtube: {status: 'awaiting_manual'}, tiktok: {status: 'posted'}}});
	assert.deepEqual(q.platformsToPost(c), ['youtube']);
});

test('escapeHtml blocks markup in clip titles', () => {
	assert.equal(q.escapeHtml('<b>"x"</b> & y'), '&lt;b&gt;&quot;x&quot;&lt;/b&gt; &amp; y');
});

test('no copy on the page uses the word band', () => {
	const fs = require('node:fs');
	const html = fs.readFileSync(require.resolve('../site/admin/queue/index.html'), 'utf8');
	const js = fs.readFileSync(require.resolve('../site/admin/queue/queue.js'), 'utf8');
	assert.doesNotMatch(html + js, /\bband\b/i);
});
