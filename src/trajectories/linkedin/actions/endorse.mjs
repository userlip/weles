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
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { checkReachable } from '../../_shared/action-runner.mjs';
import { banSignalOf } from '../../_shared/auth/ban-signal.mjs';
import { statedText } from '../../_shared/inputs/stated.mjs';
import { openLinkedinAuthed } from '../../_shared/linkedin/authed_open.mjs';
import { runRecordingsDir } from '../../../../dist/session/run-recordings.js';

// Whom to endorse and for which skill are the caller's: the profile in
// TARGET_URL, the skill in ENDORSE_SKILL (or the request's text). Without
// either the run is refused rather than endorsing the first connection's
// first skill.
const TARGET_URL = statedText(
  ['TARGET_URL'],
  'the LinkedIn profile to endorse',
  'LINKEDIN_ENDORSE_TARGET_REQUIRED',
);
const SKILL = statedText(
  ['ENDORSE_SKILL', 'SVC_TEXT'],
  'the skill on that profile to endorse, as the profile lists it',
  'LINKEDIN_ENDORSE_SKILL_REQUIRED',
);
const targetHost = new URL(TARGET_URL).hostname;

const acct = await getSocialAccount('linkedin');
if (!acct)
  throw new Error('no active linkedin account to endorse with; nothing ran');
const { proxyUrl, persona } = await resolveAccountSession(acct);
const s = await WSession.start({
  label: 'linkedin_endorse',
  proxy: proxyUrl,
  persona,
});
// The account's stored jar, limited to the cookies the profile's host would
// be sent (its own domain or a parent domain on a label boundary); an
// account with no stored jar has none to inject.
const storedJar = Array.isArray(acct.metadata?.cookies)
  ? acct.metadata.cookies
  : [];
const targetCookies = storedJar.filter((c) => {
  if (typeof c.domain !== 'string') return false;
  const domain = c.domain.replace(/^\./, '');
  return targetHost === domain || targetHost.endsWith(`.${domain}`);
});
if (targetCookies.length)
  await s.ctx
    .addCookies(targetCookies)
    .catch((e) =>
      console.log(
        `[linkedin_endorse] stored cookies not injected: ${e.message}; the auth gate signs in again`,
      ),
    );
let ban = null;
try {
  const opened = await openLinkedinAuthed(
    s,
    acct,
    'linkedin_endorse',
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
  // Each listed skill carries a button labelled "Endorse <skill>"; once
  // endorsed it reads "Endorsed <skill>" or is pressed.
  const endorseBtn = s.page.getByRole('button', {
    name: `Endorse ${SKILL}`,
    exact: true,
    pressed: false,
  });
  if (!(await endorseBtn.count()))
    throw new Error(
      `the profile shows no "Endorse ${SKILL}" button: the skill is not listed there or is already endorsed`,
    );
  await endorseBtn.scrollIntoViewIfNeeded();
  await humanClickLocator(s.page, endorseBtn);
  // A confirmation modal may ask for proficiency; its Endorse button
  // completes the endorsement.
  const modalConfirm = s.page
    .locator('div.artdeco-modal button:has-text("Endorse")')
    .first();
  await pageSettled(s.page);
  if (await modalConfirm.isVisible()) {
    await humanClickLocator(s.page, modalConfirm);
    await pageSettled(s.page);
  }
  const endorsed = s.page
    .getByRole('button', { name: `Endorsed ${SKILL}`, exact: true })
    .or(
      s.page.getByRole('button', {
        name: `Endorse ${SKILL}`,
        exact: true,
        pressed: true,
      }),
    );
  if (!(await endorsed.count()))
    throw new Error(
      `linkedin_endorse: "${SKILL}" does not read as endorsed after the endorse click`,
    );
  ban = await banSignalOf(detectLinkedInBanSignals, s, 'after the endorsement');
  console.log(`[ban-signal] ${ban?.signal}  PASS: endorsed ${SKILL}`);
} catch (e) {
  ban =
    e.banSignal ??
    (await banSignalOf(detectLinkedInBanSignals, s, 'after the failure'));
  console.log(`[ban-signal] ${ban?.signal}  FAIL: ${e.message}`);
  throw e;
} finally {
  if (ban) {
    try {
      const dir = runRecordingsDir('linkedin_endorse');
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'ban_signal.json'),
        JSON.stringify(
          {
            account_id: acct.id,
            username: acct.username,
            action: 'linkedin_endorse',
            target_url: TARGET_URL,
            skill: SKILL,
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
