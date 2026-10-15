// Whether a navigation reached the platform at all. A page that never left
// Chromium's own error page means the proxy or the network did not carry the
// request; it is refused with a structured ban signal the caller persists.
// Whether the session that reached the site is signed in is not read from
// the address here: the DOM probe (`../auth/auth-probe.mjs` assertAuthed)
// and the platform's ban detector, which reads the routes the platform
// declares (`src/platforms/_shared/signals.json`), decide that.

export function checkReachable(s, platform) {
  const finalUrl = s.page.url();
  if (!finalUrl.startsWith('chrome-error://')) return;
  const err = new Error(
    `proxy_failed: ${platform} navigation never left Chromium's error page — the proxy or the network did not carry the request`,
  );
  err.banSignal = {
    signal: 'proxy_failed',
    healthy: false,
    details: {
      final_url: finalUrl,
      reason: "the navigation ended on Chromium's error page",
    },
  };
  throw err;
}
