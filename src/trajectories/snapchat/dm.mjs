import {
  getSocialAccount,
  resolveAccountSession,
  markCookiesStale,
} from '../../../dist/utils/credentials.js';
import { WSession } from '../../../dist/session/wsession.js';
import { humanType } from '../../../dist/human/keyboard.js';
import {
  humanClickLocator,
  humanIdlePause,
} from '../../../dist/human/mouse.js';
import { assertAuthed, AuthProbeError } from '../_shared/auth/auth-probe.mjs';
import {
  loadFreshCookieJarOrFail,
  CookieJarStaleError,
} from '../_shared/auth/cookie-freshness.mjs';
import { statedText } from '../_shared/inputs/stated.mjs';

const RECIPIENT = statedText(
  ['RECIPIENT_HANDLE'],
  'the Snapchat username the DM goes to',
).replace(/^@/, '');
const MESSAGE = statedText(
  ['DM_MESSAGE'],
  'the text sent from a real account to a real person',
);

const acct = await getSocialAccount('snapchat');
if (!acct) {
  console.log('FAIL: no active snapchat account in DB');
  process.exit(1);
}
console.log(`[trajectory] Using account: ${acct.username} → @${RECIPIENT}`);

const { proxyUrl, persona } = await resolveAccountSession(acct);
const s = await WSession.start({
  label: 'snapchat_dm',
  proxy: proxyUrl,
  persona,
});

try {
  let stored = [];
  try {
    stored = loadFreshCookieJarOrFail(acct, {
      platform: 'snapchat',
      label: 'snapchat_dm',
      currentProxyUrl: proxyUrl,
      currentPersona: persona,
    });
  } catch (jarErr) {
    if (jarErr instanceof CookieJarStaleError) await markCookiesStale(acct.id);
    throw jarErr;
  }
  await s.ctx
    .addCookies(
      stored
        .filter((c) => c?.name && c?.value && (c.domain || c.url))
        .map((c) => ({ ...c, path: c.path || '/' })),
    )
    .catch(() => {});

  await s.page.goto('https://web.snapchat.com/', {
    waitUntil: 'domcontentloaded',
  });
  await humanIdlePause('long');
  if (/login|signup|accounts\.snapchat\.com/.test(s.page.url())) {
    await markCookiesStale(acct.id);
    throw new Error(`cookies stale, redirected to ${s.page.url()}`);
  }
  try {
    await assertAuthed('snapchat', s, { label: 'snapchat_dm' });
  } catch (probeErr) {
    if (probeErr instanceof AuthProbeError) await markCookiesStale(acct.id);
    throw probeErr;
  }

  const composeBtn = s.page
    .locator(
      'button[aria-label="Compose Chat"], button[aria-label*="New Chat" i], button[aria-label*="Compose" i]',
    )
    .filter({ visible: true })
    .first();
  await composeBtn.waitFor({ state: 'visible' });
  await humanClickLocator(s.page, composeBtn);

  const searchIn = s.page
    .locator(
      'div[role="textbox"][contenteditable="true"], input[type="search"], input[aria-label*="Search" i], input[placeholder*="Search" i]',
    )
    .filter({ visible: true })
    .first();
  await searchIn.waitFor({ state: 'visible' });
  await humanClickLocator(s.page, searchIn);
  await humanType(s.page, RECIPIENT);

  const userRow = s.page
    .locator(
      `[role="option"]:has-text("${RECIPIENT}"), [role="button"]:has-text("${RECIPIENT}"), li:has-text("${RECIPIENT}")`,
    )
    .filter({ visible: true })
    .first();
  await userRow.waitFor({ state: 'visible' });
  await humanClickLocator(s.page, userRow);
  await humanIdlePause('short');

  await humanIdlePause('short');
  const chatBtnSel =
    'button:has-text("Chat"), button:has-text("Next"), [role="button"]:has-text("Chat")';
  const chatBtnCount = await s.page
    .locator(chatBtnSel)
    .filter({ visible: true })
    .count()
    .catch(() => 0);
  if (chatBtnCount > 0) {
    await humanClickLocator(
      s.page,
      s.page.locator(chatBtnSel).filter({ visible: true }).first(),
    );
    await humanIdlePause('deliberate');
  }

  const composer = s.page
    .locator(
      'div[role="textbox"][contenteditable="true"][aria-label*="message" i], div[role="textbox"][contenteditable="true"]',
    )
    .filter({ visible: true })
    .last();
  await composer.waitFor({ state: 'visible' });
  await humanClickLocator(s.page, composer);
  await humanType(s.page, MESSAGE);
  await humanIdlePause('short');

  const sendSel =
    'button[aria-label*="Send" i], div[role="button"][aria-label*="Send" i]';
  const sendCount = await s.page
    .locator(sendSel)
    .filter({ visible: true })
    .count()
    .catch(() => 0);
  if (sendCount > 0) {
    await humanClickLocator(
      s.page,
      s.page.locator(sendSel).filter({ visible: true }).first(),
    );
  } else {
    await s.page.keyboard.press('Enter');
  }
  await humanIdlePause('deliberate');

  const echoCount = await s.page
    .locator(`:text("${MESSAGE}")`)
    .filter({ visible: true })
    .count()
    .catch(() => 0);
  if (!echoCount)
    throw new Error('composer typed but message not echoed in chat');
  console.log(`PASS: DM sent to @${RECIPIENT}`);
} catch (e) {
  console.error('FAIL:', e);
  process.exitCode = 1;
} finally {
  await s.close();
}
