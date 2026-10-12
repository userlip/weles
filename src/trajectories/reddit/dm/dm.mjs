import {
  getSocialAccount,
  resolveAccountSession,
  markCookiesStale,
} from '../../../../dist/utils/credentials.js';
import { WSession } from '../../../../dist/session/wsession.js';
import { humanType } from '../../../../dist/human/keyboard.js';
import { confirmedFill } from '../../_shared/page/confirmed-fill.mjs';
import {
  humanClickLocator,
  humanIdlePause,
} from '../../../../dist/human/mouse.js';
import {
  assertAuthed,
  AuthProbeError,
} from '../../_shared/auth/auth-probe.mjs';
import {
  loadFreshCookieJarOrFail,
  CookieJarStaleError,
} from '../../_shared/auth/cookie-freshness.mjs';
import { statedText } from '../../_shared/inputs/stated.mjs';
import { responseAfterAction } from '../../_shared/page/settled.mjs';
import { exitStatusFor } from '../../../../dist/cli/usage.js';

// old.reddit's compose form posts itself to /api/compose and is answered with
// the jQuery calls its page runs; a refused field is a call on the element
// carrying Reddit's own error code as a class (`.error.<CODE>`).
const ERROR_CALL = /\.error\.(?<code>[A-Z_]+)/g;

// Reddit messaging surfaces:
//   * legacy PM at old.reddit.com/message/compose — subject + body, persistent,
//     non-realtime, works from cookie replay with no Matrix handshake.
//   * chat.reddit.com (Matrix-backed realtime DM) — extra device attestation
//     and a separate cookie minted by the chat OAuth flow.
// We use the legacy PM surface — only deterministic path the routine layer
// already permits.
const RECIPIENT = statedText(
  ['RECIPIENT_HANDLE'],
  'the Reddit username the message goes to',
)
  .replace(/^u\//, '')
  .replace(/^\//, '');
const SUBJECT = statedText(
  ['DM_SUBJECT'],
  'the subject line of the message a real person receives',
);
const MESSAGE = statedText(
  ['DM_MESSAGE'],
  'the text sent from a real account to a real person',
);

const acct = await getSocialAccount('reddit');
if (!acct)
  throw new Error(
    'REDDIT_ACCOUNT_UNAVAILABLE: no active reddit account in the account store',
  );
console.log(`[trajectory] Using account: ${acct.username}`);

const { proxyUrl, persona } = await resolveAccountSession(acct);
const s = await WSession.start({
  label: 'reddit_dm',
  proxy: proxyUrl,
  persona,
});

try {
  let stored;
  try {
    const all = loadFreshCookieJarOrFail(acct, {
      platform: 'reddit',
      label: 'reddit_dm',
      currentProxyUrl: proxyUrl,
      currentPersona: persona,
    });
    stored = all.filter((c) => /reddit\.com/.test(c.domain ?? ''));
    if (!stored.length)
      throw new CookieJarStaleError(
        'cookie_jar_no_domain_match: jar fresh but no reddit.com cookies',
        { platform: 'reddit' },
      );
  } catch (jarErr) {
    if (jarErr instanceof CookieJarStaleError) await markCookiesStale(acct.id);
    throw jarErr;
  }
  await s.ctx.addCookies(stored.map((c) => ({ ...c, path: c.path || '/' })));

  // Auth-probe on a real shell — the compose page renders the form even
  // when logged out, so it's an unreliable place to probe.
  await s.goto('https://old.reddit.com/');
  await humanIdlePause('deliberate');
  try {
    await assertAuthed('reddit', s, { label: 'reddit_dm' });
  } catch (probeErr) {
    if (probeErr instanceof AuthProbeError) await markCookiesStale(acct.id);
    throw probeErr;
  }

  await s.goto(
    `https://old.reddit.com/message/compose/?to=${encodeURIComponent(RECIPIENT)}`,
  );

  const toIn = s.page
    .locator('input#send_to, input[name="to"]')
    .filter({ visible: true })
    .first();
  await toIn.waitFor({ state: 'visible' });
  const currentTo = await toIn.inputValue();
  // A recipient field still holding another name would send the message to
  // them; the field is read back before anything else is typed.
  if (currentTo.toLowerCase() !== RECIPIENT.toLowerCase())
    await confirmedFill(s.page, toIn, RECIPIENT, 'the Reddit recipient field');

  const subjectIn = s.page
    .locator('input#subject, input[name="subject"]')
    .filter({ visible: true })
    .first();
  await humanClickLocator(s.page, subjectIn);
  await humanType(s.page, SUBJECT);

  const bodyIn = s.page
    .locator('textarea#message-text, textarea[name="text"]')
    .filter({ visible: true })
    .first();
  await humanClickLocator(s.page, bodyIn);
  await humanType(s.page, MESSAGE);

  const sendBtn = s.page
    .locator(
      'form#compose-message button[type="submit"], button.btn:has-text("send"), button[name="send"]',
    )
    .filter({ visible: true })
    .first();
  await sendBtn.waitFor({ state: 'visible' });
  const response = await responseAfterAction(
    s.page,
    (request) =>
      request.method() === 'POST' &&
      new URL(request.url()).pathname.endsWith('/api/compose'),
    () => humanClickLocator(s.page, sendBtn),
  );
  const answer = await response.text();
  if (!response.ok())
    throw new Error(
      `REDDIT_DM_HTTP_ERROR: ${response.status()} from ${response.url()}: ${answer}`,
    );
  const refused = [...answer.matchAll(ERROR_CALL)].map(
    (match) => match.groups.code,
  );
  if (refused.length)
    throw new Error(
      `REDDIT_DM_REFUSED: reddit answered ${[...new Set(refused)].join(', ')}: ${answer}`,
    );
  console.log(`PASS: DM (PM) sent to u/${RECIPIENT}`);
} catch (e) {
  console.log('FAIL:', e.message);
  process.exitCode = exitStatusFor(e);
} finally {
  await s.close();
}
