import {
  getSocialAccount,
  resolveAccountSession,
  markCookiesStale,
} from '../../../../dist/utils/credentials.js';
import { WSession } from '../../../../dist/session/wsession.js';
import {
  humanClickLocator,
  humanIdlePause,
} from '../../../../dist/human/mouse.js';
import { pageSettled } from '../../_shared/page/settled.mjs';
import { detectLinkedInBanSignals } from '../../../../dist/platforms/linkedin/ban_signals.js';
import { banSignalOf } from '../../_shared/auth/ban-signal.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { checkReachable } from '../../_shared/action-runner.mjs';
import { statedText } from '../../_shared/inputs/stated.mjs';
import { openLinkedinAuthed } from '../../_shared/linkedin/authed_open.mjs';
import { runRecordingsDir } from '../../../../dist/session/run-recordings.js';

// Whom to invite is the caller's: the profile in TARGET_URL. Without it the
// run is refused rather than inviting the first person LinkedIn suggests.
const TARGET_URL = statedText(
  ['TARGET_URL'],
  'the LinkedIn profile to invite to connect',
  'LINKEDIN_CONNECT_TARGET_REQUIRED',
);
const targetHost = new URL(TARGET_URL).hostname;

const acct = await getSocialAccount('linkedin');
if (!acct) throw new Error('no active linkedin account to connect with');
const { proxyUrl, persona } = await resolveAccountSession(acct);
const s = await WSession.start({
  label: 'linkedin_connect',
  proxy: proxyUrl,
  persona,
});
// The account's stored jar, limited to the cookies the profile's host would
// be sent; an account with no stored jar has none to inject.
const storedJar = Array.isArray(acct.metadata?.cookies)
  ? acct.metadata.cookies
  : [];
const stored = storedJar.filter((c) => {
  if (typeof c.domain !== 'string') return false;
  const domain = c.domain.replace(/^\./, '');
  return targetHost === domain || targetHost.endsWith(`.${domain}`);
});
// A jar that could not be injected leaves the session signed out; the
// failure is raised inside the try so it is reported and the session closed.
let cookieInjectError = null;
if (stored.length)
  await s.ctx.addCookies(stored).catch((e) => {
    cookieInjectError = e;
  });
let ban = null;
try {
  if (cookieInjectError)
    throw new Error(
      `stored cookies could not be injected: ${cookieInjectError.message}`,
    );
  const opened = await openLinkedinAuthed(
    s,
    acct,
    'linkedin_connect',
    async () => {
      await s.page.goto(TARGET_URL, { waitUntil: 'domcontentloaded' });
      checkReachable(s, 'linkedin');
      await humanIdlePause('deliberate');
    },
  );
  if (!opened.ok) {
    await markCookiesStale(acct.id);
    throw new Error(`inline relogin failed: ${opened.reason}`);
  }
  // The profile's own invite control is <button aria-label="Invite NAME to
  // connect"> in the page's main column; suggestions of other people sit in
  // the aside and are never touched. A profile already invited shows Pending.
  const profile = s.page.locator('main').first();
  const pendingBtn = profile.locator('button[aria-label*="Pending" i]').first();
  if (await pendingBtn.isVisible()) {
    ban = await banSignalOf(detectLinkedInBanSignals, s, 'on a pending invite');
    console.log(`[ban-signal] ${ban?.signal}  PASS: already invited`);
  } else {
    const inviteBtn = profile
      .locator('button[aria-label^="Invite "][aria-label$="to connect"]')
      .filter({ visible: true })
      .first();
    if (!(await inviteBtn.count()))
      throw new Error(
        `${TARGET_URL} offers no invite to connect on the profile itself`,
      );
    await inviteBtn.scrollIntoViewIfNeeded();
    await humanClickLocator(s.page, inviteBtn);
    // Optional confirm modal: <button aria-label="Send now"> or "Send" inside
    // artdeco-modal.
    const sendBtn = s.page
      .locator(
        'div.artdeco-modal button[aria-label="Send now"], div.artdeco-modal button:has-text("Send")',
      )
      .first();
    await pageSettled(s.page);
    if (await sendBtn.isVisible()) {
      await humanClickLocator(s.page, sendBtn);
      await pageSettled(s.page);
    }
    // The same profile's control turns to Pending once the invite is sent.
    if (!(await pendingBtn.count()))
      throw new Error(
        `linkedin_connect: ${TARGET_URL} shows no Pending invite after the invite click`,
      );
    ban = await banSignalOf(detectLinkedInBanSignals, s, 'after the request');
    console.log(`[ban-signal] ${ban?.signal}  PASS: connection_requested`);
  }
} catch (e) {
  ban =
    e.banSignal ??
    (await banSignalOf(detectLinkedInBanSignals, s, 'after the failure'));
  console.log(`[ban-signal] ${ban?.signal}  FAIL: ${e.message}`);
  throw e;
} finally {
  if (ban) {
    try {
      const dir = runRecordingsDir('linkedin_connect');
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'ban_signal.json'),
        JSON.stringify(
          {
            account_id: acct.id,
            username: acct.username,
            action: 'linkedin_connect',
            target_url: TARGET_URL,
            ...ban,
            ts: new Date().toISOString(),
          },
          null,
          '  ',
        ),
      );
    } catch (e) {
      console.log('[ban-signal] persist err:', e.message);
    }
  }
  await s.close();
}
