// App Store Connect: upload a build and submit it for App Review, with no
// person or Transporter step.
//
// When IPA_PATH is set, the .ipa is delivered headlessly via `xcrun altool`
// (altool_upload.mjs); then the trajectory drives appstoreconnect.apple.com:
// open the app -> create the stated version when none is editable -> enter
// What's New -> attach the stated build (or the newest one, once the uploaded
// build has finished processing) -> save -> Add for Review -> Submit for
// Review -> read that App Review received it. Controls are found by the vision
// model in whatever wording App Store Connect uses; a stated input the page
// offers no control for fails the run by name.
//
//   APP_ID         (required) numeric app id
//   IPA_PATH       (optional) .ipa uploaded first; credentials come only from
//                  the Weles App Store Connect API item
//   VERSION_STRING (optional) marketing version created when none is editable
//   WHATS_NEW      (optional) release notes for this version
//   BUILD_NUMBER   (optional) build attached; the newest selectable otherwise
//   SUBMIT         (optional) "1" makes the terminal Submit for Review click;
//                  anything else stages everything and stops before it
//
// Run apple/login.mjs first to seed the session cookie jar.

import { pageSettled } from '../../_shared/page/settled.mjs';
import { clickDescribed, clickOffered, fillDescribed, pageShows } from '../../_shared/page/judged/seen.mjs';
import { getSocialAccount } from '../../../../dist/utils/credentials.js';
import { WSession } from '../../../../dist/session/wsession.js';
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { uploadIpa } from './altool_upload.mjs';
import { readScopedSecret } from '../../../_shared/scoped-secrets.mjs';
import { statedProxy, statedText } from '../../_shared/inputs/stated.mjs';
import { openAppStoreConnect } from '../asc_session.mjs';

const APP_ID = statedText(['APP_ID'], 'the numeric App Store Connect id of the app');
if (!/^\d+$/.test(APP_ID)) throw new Error(`APP_ID must be the numeric App Store Connect id; it is "${APP_ID}"`);
const IPA_PATH = process.env.IPA_PATH;
const VERSION_STRING = process.env.VERSION_STRING;
const WHATS_NEW = process.env.WHATS_NEW;
const BUILD_NUMBER = process.env.BUILD_NUMBER;
// A submission sends the build to Apple's review, so it happens only when
// asked for — the convention every publishing trajectory uses.
const SUBMIT = process.env.SUBMIT === '1';
const DISTRIBUTION = `/apps/${APP_ID}/distribution`;

const acct = await getSocialAccount('apple');
if (!acct) throw new Error('ASC_ACCOUNT_ABSENT: no Apple account is stored');

// Headless binary delivery first: altool validates the .ipa at upload, so a
// failure surfaces before the browser phase starts.
if (IPA_PATH)
  await uploadIpa({
    ipaPath: IPA_PATH,
    keyId: readScopedSecret('appleAppStoreConnectApi', 'key_id'),
    issuerId: readScopedSecret('appleAppStoreConnectApi', 'issuer_id'),
    privateKey: readScopedSecret('appleAppStoreConnectApi', 'private_key'),
    platform: statedText(
      ['APPLE_PLATFORM'],
      'the Apple platform the .ipa is uploaded for (ios, appletvos, macos or visionos, as altool names it)',
    ),
  });

/**
 * Attach BUILD_NUMBER (or the newest selectable build) to the version.
 * True once a build is attached; false when the picker lists no build to
 * choose yet (an uploaded build still processing).
 */
async function attachBuild(page) {
  if (await pageShows(page, 'Does the version already have a build attached?')) return true;
  await clickDescribed(page, 'the control that adds a build to this version');
  await pageSettled(page);
  if (BUILD_NUMBER) {
    const row = page.locator('tr, [role="row"], label').filter({ hasText: BUILD_NUMBER }).first();
    if (!(await row.isVisible())) return false;
    await humanClickLocator(page, row);
  } else if (!(await clickOffered(page, 'the newest build in the list of builds to choose'))) return false;
  await clickDescribed(page, 'the button that confirms the chosen build');
  await pageSettled(page);
  console.log(`[asc-submit] build attached: ${BUILD_NUMBER ? BUILD_NUMBER : 'the newest selectable'}`);
  return true;
}

const s = await WSession.start({
  label: 'apple_asc_submit',
  proxy: statedProxy('the App Store Connect submission'),
});
try {
  await openAppStoreConnect(s, DISTRIBUTION);

  // 1) The stated version, created when no version is editable.
  if (VERSION_STRING && !(await pageShows(s.page, 'Does the page show a version in the Prepare for Submission state?'))) {
    console.log(`[asc-submit] no editable version, creating ${VERSION_STRING}`);
    await clickDescribed(s.page, 'the control that adds a new version or platform');
    await fillDescribed(s.page, 'the version number field of the new version', VERSION_STRING);
    await clickDescribed(s.page, 'the button that creates the version');
    await pageSettled(s.page);
  }

  // 2) What's New, when stated.
  if (WHATS_NEW) {
    await fillDescribed(s.page, "the What's New in This Version release notes field", WHATS_NEW);
    console.log(`[asc-submit] What's New entered (${WHATS_NEW.length} chars)`);
  }

  // 3) The build. One just uploaded is processed by App Store Connect before
  //    it can be chosen, so the page is reloaded until it can; without an
  //    upload, a build that cannot be chosen fails the run.
  let attached = await attachBuild(s.page);
  if (!attached && !IPA_PATH)
    throw new Error('ASC_NO_BUILD: no processed build can be attached (set IPA_PATH to upload one)');
  // retry-allowed: reload App Store Connect until the altool-uploaded build
  // finishes processing and is selectable. Apple decides how long processing
  // takes; the run shows each reload, and the operator cancels a build that
  // never finishes.
  while (!attached) {
    console.log('[asc-submit] the uploaded build is still processing; reloading the version page');
    await openAppStoreConnect(s, DISTRIBUTION);
    attached = await attachBuild(s.page);
  }

  await clickDescribed(s.page, 'the Save button of the version page');
  await pageSettled(s.page);

  if (!SUBMIT) console.log(`PASS: staged version for app ${APP_ID} (SUBMIT is not 1, not sent to review)`);
  else {
    // 4) The terminal submit: current App Store Connect adds the version for
    //    review first and submits it from the review summary.
    if (await clickOffered(s.page, 'the Add for Review button')) await pageSettled(s.page);
    await clickDescribed(s.page, 'the button that submits the version to App Review');
    await pageSettled(s.page);
    // 5) App Review received it once the version shows a waiting or in-review
    //    status; a page still showing Prepare for Submission, or no status, is
    //    not proof, and a second run would submit the version twice.
    if (!(await pageShows(s.page, 'Does the page show the version waiting for review or in review (not Prepare for Submission)?')))
      throw new Error(
        `app ${APP_ID} submit-for-review was clicked but the page shows no review status; read the version's status in App Store Connect before running this again`,
      );
    console.log(`PASS: app ${APP_ID} submitted for review`);
  }
} finally {
  await s.close();
}
