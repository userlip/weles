import { pageCondition, pageSettled } from '../../_shared/page/settled.mjs';
// Google Play Console: publish an Android app release — fully browser-driven.
//
// Drives play.google.com/console exactly as a human would: open the app's
// chosen track -> create a new release -> upload the AAB/APK via the file
// input -> fill the release name and notes -> advance -> review -> start the
// rollout or send for review -> confirm. Verifies the release status before
// reporting PASS. Every control and field is found by the vision model
// (`_shared/page/judged/seen.mjs`) from what the page shows, not from
// button texts; every refusal is thrown with its cause.
//
// Unlike App Store Connect, Play Console DOES expose a web upload form for the
// app bundle, so this trajectory performs the binary upload too.
//
// Args (env):
//   BUNDLE_PATH      (required) local path to the .aab (or .apk) to upload
//   PACKAGE_NAME     (required unless PLAY_RELEASE_URL given) e.g. com.foo.bar
//   PLAY_RELEASE_URL (optional) full Play Console URL of the track's release
//                    page; when set, navigation by package is skipped
//   TRACK            (required) internal | closed | open | production
//   RELEASE_NAME     (optional) release name shown in the console
//   RELEASE_NOTES    (optional) "What's new" notes for the default language
//   SUBMIT           (optional) "1" makes the terminal rollout/send-for-review
//                    click; anything else stages the release and stops there.
//   PROXY_URL        (required) proxy URL or provider filter; 'direct' for none
//
// Requires a logged-in Google session for an account with Play Console access
// (run a google login/register trajectory first to seed the cookie jar).

import { existsSync } from 'node:fs';
import { getSocialAccount } from '../../../../dist/utils/credentials.js';
import { WSession } from '../../../../dist/session/wsession.js';
import { statedProxy, statedText } from '../../_shared/inputs/stated.mjs';
import {
  clickOffered,
  fillOffered,
  pageShows,
  shownText,
} from '../../_shared/page/judged/seen.mjs';
import { onGoogleSignIn } from '../../_shared/profile/google_session.mjs';

const BUNDLE_PATH = process.env.BUNDLE_PATH;
const PACKAGE_NAME = process.env.PACKAGE_NAME;
const PLAY_RELEASE_URL = process.env.PLAY_RELEASE_URL;
// Which track a release goes to is the caller's; none is chosen here.
const TRACK = statedText(
  ['TRACK'],
  'the Play track the release goes to: internal, closed, open or production',
).toLowerCase();
const RELEASE_NAME = process.env.RELEASE_NAME;
const RELEASE_NOTES = process.env.RELEASE_NOTES;
// A rollout reaches real users, so it happens only when asked for.
const SUBMIT = process.env.SUBMIT === '1';
const PLAY_CONSOLE_HOME = 'https://play.google.com/console/u/0/developers';

if (!BUNDLE_PATH || !existsSync(BUNDLE_PATH)) {
  throw new Error(
    `PLAY_BUNDLE_REQUIRED: BUNDLE_PATH must point to an existing .aab/.apk (got: ${BUNDLE_PATH ? BUNDLE_PATH : 'unset'})`,
  );
}
if (!PACKAGE_NAME && !PLAY_RELEASE_URL) {
  throw new Error(
    'PLAY_APP_REQUIRED: PACKAGE_NAME or PLAY_RELEASE_URL names the app the release belongs to',
  );
}
const RELEASE_TARGET = PLAY_RELEASE_URL ? PLAY_RELEASE_URL : PACKAGE_NAME;

// The Play Console navigation entry of each track.
const trackNav = {
  internal: 'Internal testing',
  closed: 'Closed testing',
  open: 'Open testing',
  production: 'Production',
};
if (!Object.hasOwn(trackNav, TRACK))
  throw new Error(
    `TRACK is "${TRACK}", not one of ${Object.keys(trackNav).join(', ')}; nothing was uploaded`,
  );
const navLabel = trackNav[TRACK];

if (!(await getSocialAccount('google'))) {
  throw new Error(
    'PLAY_GOOGLE_ACCOUNT_REQUIRED: no active google account in the accounts store',
  );
}

/** Click what `description` names, refusing with `code` when the page shows none. */
async function clickRequired(s, description, code) {
  if (!(await clickOffered(s.page, description)))
    throw new Error(`${code}: no ${description} at ${s.page.url()}`);
  console.log(`[play-submit] clicked: ${description}`);
  await pageSettled(s.page);
}

/** Fill the field `description` names, refusing with `code` when there is none. */
async function fillRequired(s, description, value, code) {
  if (!(await fillOffered(s.page, description, value)))
    throw new Error(`${code}: no ${description} at ${s.page.url()}`);
  console.log(`[play-submit] filled: ${description}`);
  await pageSettled(s.page);
}

const s = await WSession.start({
  label: 'google_play_submit',
  proxy: statedProxy('the Play Console release'),
});
try {
  // 1) Reach the track's release page.
  await s.goto(PLAY_RELEASE_URL ? PLAY_RELEASE_URL : PLAY_CONSOLE_HOME);
  await pageSettled(s.page);
  if (onGoogleSignIn(s.page.url())) {
    throw new Error(
      `PLAY_NOT_SIGNED_IN: the Google session is not signed in (url=${s.page.url()}); run a google login trajectory first`,
    );
  }

  // Navigate by package when no direct URL was given: open the app, then the
  // track in the left navigation.
  if (!PLAY_RELEASE_URL) {
    await clickRequired(
      s,
      `the app whose package name is ${PACKAGE_NAME} in the Play Console app list`,
      'PLAY_APP_NOT_FOUND',
    );
    await clickRequired(
      s,
      `the ${navLabel} entry of the Play Console navigation`,
      'PLAY_RELEASE_TRACK_UNAVAILABLE',
    );
  }

  // 2) Create a new release.
  await clickRequired(
    s,
    'the button that creates a new release on this track',
    'PLAY_CREATE_RELEASE_UNAVAILABLE',
  );

  // 3) Upload the bundle through the file input. setInputFiles is the only
  //    mechanism for a file picker and emits a genuine change event.
  const fileInput = s.page.locator('input[type="file"]').first();
  await fileInput.waitFor({ state: 'attached' });
  await fileInput.setInputFiles(BUNDLE_PATH);
  console.log(`[play-submit] uploading ${BUNDLE_PATH}`);

  // The bundle is processed once the file input is no longer busy and the
  // release's artifact table has a row; Play Console marks an upload failure
  // with an alert in the upload region. The condition reads those, not words.
  const upload = await pageCondition(s.page, () => {
    const alert = document.querySelector(
      '[role="alert"], [role="alertdialog"]',
    );
    if (alert && alert.offsetParent !== null) return 'error';
    const uploading = document.querySelector('[role="progressbar"]');
    if (uploading && uploading.offsetParent !== null) return false;
    const artifacts = document.querySelector(
      'table tbody tr, [role="table"] [role="row"] + [role="row"]',
    );
    return artifacts ? 'done' : false;
  });
  if (upload === 'error') {
    const alert = await s.page
      .locator('[role="alert"], [role="alertdialog"]')
      .first()
      .innerText();
    throw new Error(
      `PLAY_UPLOAD_REFUSED: Play Console reported an upload error: ${alert}`,
    );
  }
  console.log('[play-submit] bundle processed');

  // 4) Release name + notes (optional).
  if (RELEASE_NAME) {
    await fillRequired(
      s,
      'the release name field',
      RELEASE_NAME,
      'PLAY_RELEASE_NAME_UNAVAILABLE',
    );
  }
  if (RELEASE_NOTES) {
    await fillRequired(
      s,
      'the release notes field for the default language',
      RELEASE_NOTES,
      'PLAY_RELEASE_NOTES_UNAVAILABLE',
    );
  }

  // 5) Advance: Next / Save.
  await clickRequired(
    s,
    'the Next or Save button that advances the release',
    'PLAY_RELEASE_ADVANCE_UNAVAILABLE',
  );

  if (!SUBMIT) {
    console.log(
      `PASS: staged ${TRACK} release for ${RELEASE_TARGET} (SUBMIT=0, not sent)`,
    );
  } else {
    // 6) Review screen (when the console shows one) then the terminal
    //    rollout / send-for-review and its confirmation dialog.
    if (await clickOffered(s.page, 'the button that opens the release review'))
      await pageSettled(s.page);
    await clickRequired(
      s,
      'the button that starts the rollout or sends the release for review',
      'PLAY_ROLLOUT_UNAVAILABLE',
    );
    if (
      await clickOffered(
        s.page,
        'the button of a confirmation dialog that confirms the rollout or the review',
      )
    )
      await pageSettled(s.page);

    // 7) Verify a sent/rollout status surfaced, and report it as printed.
    if (
      !(await pageShows(
        s.page,
        'Does the page show the release as in review, sent for review, rolling out, live or published?',
      ))
    ) {
      throw new Error(
        `PLAY_RELEASE_OUTCOME_UNOBSERVED: no release status observed at ${s.page.url()}`,
      );
    }
    const status = await shownText(s.page, 'status of this release');
    if (!status) {
      throw new Error(
        `PLAY_RELEASE_STATUS_UNREAD: the page shows a sent release but no status could be read at ${s.page.url()}`,
      );
    }
    console.log(
      `PASS: ${TRACK} release sent for ${RELEASE_TARGET} — status "${status}"`,
    );
  }
} finally {
  await s.close();
}
