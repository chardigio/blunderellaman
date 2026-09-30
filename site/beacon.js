// Views and link taps for the /admin page, with no analytics server and no third party.
//
// Each event is a GET of the 1x1 /t.gif with a query string. CloudFront logs every request,
// and an hourly job in the stardust-labs repo counts these lines out of the logs. The query
// keys (e, ref, utm_source, l) are that job's input format; change them in both places.
//
// Same UMD-ish shape as the admin page: CommonJS under Node so the tests load this exact file,
// a global in the browser.
(function (global) {
	'use strict';

	const PIXEL = '/t.gif';

	// Only the origin of the referrer: where people came from, not which page they read.
	function referrerOrigin(referrer) {
		try {
			const url = new URL(referrer);
			return url.protocol === 'http:' || url.protocol === 'https:' ? url.protocol + '//' + url.hostname : '';
		} catch (e) {
			return '';
		}
	}

	function viewUrl(search, referrer) {
		const params = new URLSearchParams({e: 'view'});
		const ref = referrerOrigin(referrer);
		if (ref) params.set('ref', ref);
		const source = new URLSearchParams(search).get('utm_source');
		if (source) params.set('utm_source', source);
		return PIXEL + '?' + params.toString();
	}

	function tapUrl(link) {
		return PIXEL + '?' + new URLSearchParams({e: 'tap', l: link}).toString();
	}

	// no-store, or the browser answers a repeat from its own cache and CloudFront never logs it.
	// keepalive lets a tap's request finish after the tap opens a new tab or leaves the page.
	function send(url) {
		try {
			global.fetch(url, {cache: 'no-store', credentials: 'omit', keepalive: true}).catch(function () {});
		} catch (e) {
			new global.Image().src = url;
		}
	}

	function start(doc) {
		send(viewUrl(global.location.search, doc.referrer));
		doc.addEventListener('click', function (event) {
			const link = event.target.closest && event.target.closest('a[data-link]');
			if (link) send(tapUrl(link.dataset.link));
		});
	}

	const api = {viewUrl: viewUrl, tapUrl: tapUrl, start: start};
	if (typeof module !== 'undefined' && module.exports) {
		module.exports = api;
	} else {
		global.BlunderBeacon = api;
	}
})(typeof window !== 'undefined' ? window : globalThis);
