// TestFlight: invite a tester by email to one group of one app.
// Inputs: APP_ID (numeric), TESTER_EMAIL and GROUP_NAME, all required: the
// group a tester joins is the caller's, never whichever is listed first.
// The invite counts once App Store Connect lists the address in the group.
import { pageSettled } from '../../_shared/page/settled.mjs';
import {
  clickDescribed,
  clickOffered,
} from '../../_shared/page/judged/seen.mjs';
import { getSocialAccount } from '../../../../dist/utils/credentials.js';
import { WSession } from '../../../../dist/session/wsession.js';
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { statedProxy, statedText } from '../../_shared/inputs/stated.mjs';
import { openAppStoreConnect } from '../asc_session.mjs';

const APP_ID = statedText(
  ['APP_ID'],
  'the numeric App Store Connect id of the app',
);
const TESTER_EMAIL = statedText(
  ['TESTER_EMAIL'],
  'the email address invited to TestFlight',
);
const GROUP_NAME = statedText(
  ['GROUP_NAME'],
  'the TestFlight group the tester joins',
);

const acct = await getSocialAccount('apple');
if (!acct) throw new Error('ASC_ACCOUNT_ABSENT: no Apple account is stored');

const s = await WSession.start({
  label: 'apple_testflight_invite',
  proxy: statedProxy('the TestFlight invite'),
});
try {
  await openAppStoreConnect(s, `/apps/${APP_ID}/testflight/groups`);
  const group = s.page
    .locator('a[href*="/testflight/groups/"]')
    .filter({ hasText: GROUP_NAME })
    .first();
  if (!(await group.isVisible()))
    throw new Error(
      `TESTFLIGHT_GROUP_ABSENT: app ${APP_ID} lists no TestFlight group "${GROUP_NAME}"`,
    );
  await humanClickLocator(s.page, group);
  await pageSettled(s.page);

  // The group opens on its builds or its testers; the Testers tab, when the
  // page shows one, leads to the add control.
  if (await clickOffered(s.page, 'the Testers tab of the group'))
    await pageSettled(s.page);
  await clickDescribed(s.page, 'the button that adds testers to the group');
  await pageSettled(s.page);
  if (
    await clickOffered(s.page, 'the option that adds a tester by email address')
  )
    await pageSettled(s.page);
  await s.page
    .locator('input[type="email"], input[placeholder*="email" i]')
    .fill(TESTER_EMAIL);
  await pageSettled(s.page);
  await clickDescribed(
    s.page,
    'the button that adds or invites the tester with the entered email',
  );
  await pageSettled(s.page);
  // A click that landed nowhere leaves the address absent, and the run fails here.
  await s.page
    .getByText(TESTER_EMAIL, { exact: true })
    .first()
    .waitFor({ state: 'visible' });
  console.log(
    `PASS: invited ${TESTER_EMAIL} to group "${GROUP_NAME}" of app ${APP_ID}`,
  );
} finally {
  await s.close();
}
