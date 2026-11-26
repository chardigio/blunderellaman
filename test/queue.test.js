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

test('summaryLine gives the count, the next slot with how soon, and the last slot', () => {
	const queue = {now: NOW, clips: [
		clip({id: 2, status: 'accepted', scheduled_at: '2026-12-02T20:00:00Z'}),
		clip({id: 1, status: 'accepted', scheduled_at: '2026-12-02T16:00:00Z'}),
		clip({id: 5, status: 'accepted', scheduled_at: '2026-12-04T00:00:00Z'}),
		clip({id: 3, status: 'pending'}),
		clip({id: 4, status: 'rejected'}),
	]};
	assert.equal(q.summaryLine(queue), '3 ready · next Wed 11 am (in 1h) · last Thu 7 pm');
});

test('summaryLine with one and none', () => {
	assert.equal(
		q.summaryLine({now: NOW, clips: [clip({status: 'accepted', scheduled_at: '2026-12-02T15:45:00Z'})]}),
		'1 ready · goes out Wed 10:45 am (in 45m)',
	);
	assert.equal(q.summaryLine({now: NOW, clips: [clip({status: 'pending'})]}), 'Nothing scheduled. Accept a clip to give it a time.');
});

test('summaryLine does not count a clip that went out or is going out now', () => {
	const posted = {status: 'posted'};
	const queue = {now: NOW, clips: [
		clip({status: 'accepted', scheduled_at: '2026-12-02T11:00:00Z', posts: {youtube: posted, tiktok: posted}}),
		clip({status: 'accepted', scheduled_at: '2026-12-02T14:00:00Z', posts: {youtube: posted, tiktok: {status: 'submitted'}}}),
		clip({status: 'accepted', scheduled_at: '2026-12-02T16:00:00Z'}),
	]};
	assert.equal(q.summaryLine(queue), '1 ready · goes out Wed 11 am (in 1h)');
});

test('relTime says how soon, in minutes, hours, or days', () => {
	assert.equal(q.relTime('2026-12-02T14:00:00Z', NOW), 'now');
	assert.equal(q.relTime('2026-12-02T15:00:00Z', NOW), 'now');
	assert.equal(q.relTime('2026-12-02T15:20:00Z', NOW), 'in 20m');
	assert.equal(q.relTime('2026-12-02T20:00:00Z', NOW), 'in 5h');
	assert.equal(q.relTime('2026-12-04T15:00:00Z', NOW), 'in 2d');
});

test('defaultTab opens on the work that waits for the reviewer', () => {
	assert.equal(q.defaultTab({review: 2, postNow: 1, scheduled: 3, done: 0}), 'review');
	assert.equal(q.defaultTab({review: 0, postNow: 1, scheduled: 3, done: 0}), 'postNow');
	assert.equal(q.defaultTab({review: 0, postNow: 0, scheduled: 0, done: 4}), 'scheduled');
});

test('keyAction maps keys, and only Enter and Escape work inside a field', () => {
	const k = (key, more) => Object.assign({key, metaKey: false, ctrlKey: false, altKey: false}, more);
	assert.equal(q.keyAction(k('j'), false), 'next');
	assert.equal(q.keyAction(k('k'), false), 'prev');
	assert.equal(q.keyAction(k('a'), false), 'accept');
	assert.equal(q.keyAction(k('x'), false), 'reject');
	assert.equal(q.keyAction(k(' '), false), 'play');
	assert.equal(q.keyAction(k('?'), false), 'help');
	assert.equal(q.keyAction(k('A'), false), null);
	assert.equal(q.keyAction(k('a', {metaKey: true}), false), null);
	assert.equal(q.keyAction(k('a'), true), null);
	assert.equal(q.keyAction(k('Enter'), true), 'submit');
	assert.equal(q.keyAction(k('Enter', {metaKey: true}), true), 'submit');
	assert.equal(q.keyAction(k('Escape'), true), 'blur');
});

test('renderQueue draws a tab for each section with its count, and Going out only when a clip goes out', () => {
	const root = fakeRoot();
	const out = q.renderQueue(root, {now: NOW, publisher: 'upload_post', clips: [
		clip({id: 1, status: 'pending'}),
		clip({id: 2, status: 'accepted', scheduled_at: '2026-12-02T20:00:00Z'}),
	]});
	assert.equal(out.tab, 'review');
	assert.match(root.tabs.innerHTML, /data-tab="review" aria-selected="true">Review <span class="n">1<\/span>/);
	assert.match(root.tabs.innerHTML, /data-tab="scheduled" aria-selected="false">Scheduled <span class="n">1<\/span>/);
	assert.doesNotMatch(root.tabs.innerHTML, /data-tab="postNow"/);
	assert.match(root.groups.innerHTML, /data-section="review"/);
	assert.match(root.groups.innerHTML, /<details class="row" data-id="2" data-kind="scheduled">/);

	q.renderQueue(root, {now: NOW, publisher: 'upload_post', clips: [
		clip({id: 3, status: 'accepted', scheduled_at: '2026-12-02T14:00:00Z', posts: {youtube: {status: 'submitted'}, tiktok: null}}),
	]}, 'scheduled');
	assert.match(root.tabs.innerHTML, /data-tab="postNow" aria-selected="false">Going out <span class="n">1<\/span>/);
	assert.match(root.tabs.innerHTML, /data-tab="scheduled" aria-selected="true"/);
});

test('a title shows how many of its 100 characters it uses', () => {
	const root = fakeRoot();
	q.renderQueue(root, {now: NOW, clips: [clip({id: 1, title: 'Queen sac'})]});
	assert.match(root.groups.innerHTML, /<span class="count">9\/100<\/span>/);
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

test('sections puts a clip that Upload-Post has under going out, until both platforms are posted', () => {
	const clips = [
		clip({id: 1, status: 'accepted', scheduled_at: '2026-12-02T16:00:00Z', posts: {youtube: {status: 'submitted'}, tiktok: {status: 'submitted'}}}),
		clip({id: 2, status: 'accepted', scheduled_at: '2026-12-02T16:00:00Z', posts: {youtube: {status: 'posted'}, tiktok: {status: 'submitted'}}}),
		clip({id: 3, status: 'accepted', scheduled_at: '2026-12-02T16:00:00Z', posts: {youtube: {status: 'posted'}, tiktok: {status: 'posted'}}}),
	];
	const s = q.sections({now: NOW, publisher: 'upload_post', clips});
	assert.deepEqual(s.postNow.map(c => c.id), [1, 2]);
	assert.deepEqual(s.done.map(c => c.id), [3]);
});

test('platformState says what Upload-Post is doing on each platform', () => {
	const queue = {now: NOW, publisher: 'upload_post'};
	const c = clip({posts: {
		youtube: {status: 'posted', external_url: 'https://youtu.be/x'},
		tiktok: {status: 'failed', error: 'Video too short.', at: '2026-12-02T15:00:00Z'},
	}});
	assert.deepEqual(q.platformState(c, 'youtube', queue), {text: 'Posted on YouTube Shorts.', url: 'https://youtu.be/x'});
	assert.deepEqual(q.platformState(c, 'tiktok', queue), {
		text: 'TikTok failed: Video too short. The next try is Wed 10:30 am.', error: true,
	});
	assert.equal(q.platformState(clip({posts: {youtube: {status: 'submitted'}}}), 'youtube', queue).text, 'Sending to YouTube Shorts.');
	assert.equal(q.platformState(clip({}), 'tiktok', queue).text, 'Waiting to send to TikTok.');
});

test('the Upload-Post page has no manual buttons and no undo', () => {
	const root = fakeRoot();
	q.renderQueue(root, {now: NOW, publisher: 'upload_post', clips: [
		clip({id: 1, status: 'accepted', scheduled_at: '2026-12-02T14:00:00Z', posts: {youtube: {status: 'submitted'}, tiktok: null}}),
		clip({id: 2, status: 'accepted', scheduled_at: '2026-12-01T16:00:00Z', posts: {youtube: {status: 'posted'}, tiktok: {status: 'posted'}}}),
	]});
	const html = root.groups.innerHTML;
	assert.match(html, /Going out now/);
	assert.match(html, /Sending to YouTube Shorts\./);
	assert.doesNotMatch(html, /I posted it/);
	assert.doesNotMatch(html, /data-action="unpost"/);
	assert.doesNotMatch(html, /Post now/);
});

test('the manual page keeps the post buttons and undo', () => {
	const root = fakeRoot();
	q.renderQueue(root, {now: NOW, publisher: 'manual', clips: [
		clip({id: 1, status: 'accepted', scheduled_at: '2026-12-02T14:00:00Z', posts: {youtube: {status: 'awaiting_manual'}, tiktok: {status: 'awaiting_manual'}}}),
		clip({id: 2, status: 'accepted', scheduled_at: '2026-12-01T16:00:00Z', posts: {youtube: {status: 'posted'}, tiktok: {status: 'posted'}}}),
	]});
	assert.match(root.groups.innerHTML, /I posted it on TikTok/);
	assert.match(root.groups.innerHTML, /data-action="unpost"/);
});

function fakeRoot() {
	const els = {'#summary': {textContent: ''}, '#tabs': {innerHTML: ''}, '#groups': {innerHTML: ''}};
	return {summary: els['#summary'], tabs: els['#tabs'], groups: els['#groups'], querySelector: sel => els[sel]};
}

test('escapeHtml blocks markup in clip titles', () => {
	assert.equal(q.escapeHtml('<b>"x"</b> & y'), '&lt;b&gt;&quot;x&quot;&lt;/b&gt; &amp; y');
});

test('no copy on the page uses the word band', () => {
	const fs = require('node:fs');
	const html = fs.readFileSync(require.resolve('../site/admin/queue/index.html'), 'utf8');
	const js = fs.readFileSync(require.resolve('../site/admin/queue/queue.js'), 'utf8');
	assert.doesNotMatch(html + js, /\bband\b/i);
});
