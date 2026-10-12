import {
  getSocialAccount,
  resolveAccountSession,
  markCookiesStale,
} from '../../../../../dist/utils/credentials.js';
import { WSession } from '../../../../../dist/session/wsession.js';
import { humanType } from '../../../../../dist/human/keyboard.js';
import {
  humanClickLocator,
  humanIdlePause,
} from '../../../../../dist/human/mouse.js';
import { AuthProbeError } from '../../../_shared/auth/auth-probe.mjs';
import { openLinkedinAuthed } from '../../../_shared/linkedin/authed_open.mjs';
import {
  loadFreshCookieJarOrFail,
  CookieJarStaleError,
} from '../../../_shared/auth/cookie-freshness.mjs';
import { statedText } from '../../../_shared/inputs/stated.mjs';
import { textShownOutsideEditors } from '../../../_shared/page/shows.mjs';

// RECIPIENT_HANDLE accepts vanity ("williamhgates") or full /in/ URL. We
// always click "Message" on the public profile — the only deterministic
// LinkedIn DM path. The /messaging/ composer typeahead surfaces "Connect"
// cohort users mis-matched against the intended recipient on small accounts.
const RECIPIENT = statedText(
  ['RECIPIENT_HANDLE'],
  'the LinkedIn vanity or /in/ URL the DM goes to',
)
  .replace(/^@/, '')
  .replace(/\/$/, '');
const MESSAGE = statedText(
  ['DM_MESSAGE'],
  'the text sent from a real account to a real person',
);
const profileUrl = /^https?:\/\//.test(RECIPIENT)
  ? RECIPIENT
  : `https://www.linkedin.com/in/${encodeURIComponent(RECIPIENT)}/`;

const acct = await getSocialAccount('linkedin');
if (!acct) {
  console.log('FAIL: no active linkedin account in DB');
  process.exit(1);
}
console.log(`[trajectory] Using account: ${acct.username}`);

const { proxyUrl, persona } = await resolveAccountSession(acct);
const s = await WSession.start({
  label: 'linkedin_dm',
  proxy: proxyUrl,
  persona,
});

try {
  let stored;
  try {
    const all = loadFreshCookieJarOrFail(acct, {
      platform: 'linkedin',
      label: 'linkedin_dm',
      currentProxyUrl: proxyUrl,
      currentPersona: persona,
    });
    stored = all.filter((c) => /linkedin\.com/.test(c.domain ?? ''));
    if (!stored.length)
      throw new CookieJarStaleError(
        'cookie_jar_no_domain_match: jar fresh but no linkedin.com cookies',
        { platform: 'linkedin' },
      );
  } catch (jarErr) {
    if (jarErr instanceof CookieJarStaleError) await markCookiesStale(acct.id);
    throw jarErr;
  }
  await s.ctx.addCookies(stored.map((c) => ({ ...c, path: c.path || '/' })));

  let opened;
  try {
    opened = await openLinkedinAuthed(s, acct, 'linkedin_dm', async () => {
      await s.page.goto('https://www.linkedin.com/feed/', {
        waitUntil: 'domcontentloaded',
      });
      await humanIdlePause('deliberate');
      const url = s.page.url();
      if (
        ['/login', '/checkpoint', '/uas'].some((wall) =>
          new URL(url).pathname.startsWith(wall),
        )
      )
        throw new AuthProbeError(`auth_wall: redirected to ${url}`);
    });
  } catch (gateErr) {
    if (
      !(gateErr instanceof AuthProbeError) &&
      !/auth_wall/.test(String(gateErr?.message))
    )
      throw gateErr;
    await markCookiesStale(acct.id);
    throw new Error(`still signed out after relogin: ${gateErr.message}`);
  }
  if (!opened.ok) {
    await markCookiesStale(acct.id);
    throw new Error(`inline relogin failed: ${opened.reason}`);
  }

  await s.page.goto(profileUrl, { waitUntil: 'domcontentloaded' });
  await humanIdlePause('deliberate');

  // No Message button = not connected + not Open Profile → DM impossible
  // without InMail credits. Surface as structured FAIL early.
  const msgSel =
    'button:has-text("Message"), a:has-text("Message"), button[aria-label*="Message" i]';
  const msgCount = await s.page
    .locator(msgSel)
    .filter({ visible: true })
    .count()
    .catch(() => 0);
  if (!msgCount)
    throw new Error(
      'recipient profile has no Message button (not connected; InMail required)',
    );
  await humanClickLocator(
    s.page,
    s.page.locator(msgSel).filter({ visible: true }).first(),
  );

  const composer = s.page
    .locator(
      'div.msg-form__contenteditable[contenteditable="true"], div[role="textbox"][contenteditable="true"]',
    )
    .filter({ visible: true })
    .first();
  await composer.waitFor({ state: 'visible' });
  await humanClickLocator(s.page, composer);
  await humanType(s.page, MESSAGE);

  const sendBtn = s.page
    .locator(
      'button.msg-form__send-button:enabled:not([aria-disabled="true"]), button[aria-label*="Send" i]:enabled:not([aria-disabled="true"])',
    )
    .filter({ visible: true })
    .first();
  await sendBtn.waitFor({ state: 'visible' });
  await humanClickLocator(s.page, sendBtn);
  await humanIdlePause('deliberate');

  if (!(await textShownOutsideEditors(s.page, MESSAGE)))
    throw new Error('composer typed but message not echoed in conversation');
  console.log(`PASS: DM sent to ${RECIPIENT}`);
} catch (e) {
  console.log('FAIL:', e.message);
  process.exitCode = 1;
} finally {
  await s.close();
}
