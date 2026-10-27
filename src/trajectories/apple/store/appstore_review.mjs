// App Store review (web): rate and review an app on apps.apple.com with the
// stored Apple account. A review is a real publication under the account's
// name: the app, the rating and the words are the caller's (APP_ID, RATING,
// TITLE, REVIEW_TEXT); nothing is assumed. A session Apple sends to its
// sign-in marks the account's cookies stale, so the next run picks another
// account, and fails by name. The rating must be one of the stars the review
// form shows.
import { pageSettled } from '../../_shared/page/settled.mjs';
import { clickDescribed, pageShows } from '../../_shared/page/judged/seen.mjs';
import {
  getSocialAccount,
  markCookiesStale,
  resolveAccountSession,
} from '../../../../dist/utils/credentials.js';
import { WSession } from '../../../../dist/session/wsession.js';
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { humanFill } from '../../../../dist/human/keyboard.js';
import { statedProxy, statedText } from '../../_shared/inputs/stated.mjs';

const APP_ID = statedText(
  ['APP_ID'],
  'the numeric App Store id of the app reviewed',
);
if (!/^\d+$/.test(APP_ID))
  throw new Error(`APP_ID must be the numeric App Store id; it is "${APP_ID}"`);
const RATING = Number(
  statedText(['RATING'], 'the star rating the review gives'),
);
if (!Number.isSafeInteger(RATING) || !(RATING >= Number.MIN_VALUE))
  throw new Error(
    `RATING must be a whole number of stars; it is "${process.env.RATING}"`,
  );
const TITLE = statedText(['TITLE'], 'the title of the review');
const REVIEW_TEXT = statedText(['REVIEW_TEXT'], 'the words of the review');

const acct = await getSocialAccount('apple');
if (!acct)
  throw new Error('APPSTORE_ACCOUNT_ABSENT: no Apple account is stored');

const { proxyUrl, persona } = await resolveAccountSession(acct);
const s = await WSession.start({
  label: 'apple_appstore_review',
  proxy:
    proxyUrl ??
    statedProxy('the App Store review, whose account names no proxy,'),
  persona,
});

/** A page on Apple's sign-in host means the account's cookies are stale: marked, and the run fails. */
async function refuseSignIn(when) {
  if (new URL(s.page.url()).hostname !== 'idmsa.apple.com') return;
  await markCookiesStale(acct.id);
  throw new Error(
    `APPSTORE_COOKIES_STALE: Apple sent the session to its sign-in ${when} (${s.page.url()}); the account's cookies are marked stale`,
  );
}

try {
  // The app's listing in the account's own storefront.
  await s.goto(`https://apps.apple.com/app/id${APP_ID}`);
  await pageSettled(s.page);
  await refuseSignIn('on the listing');

  // Ratings & Reviews sits further down the listing; the click scrolls the
  // control into view, and a listing without it (not signed in) throws.
  await humanClickLocator(
    s.page,
    s.page
      .locator(
        'button:has-text("Write a Review"), a:has-text("Write a Review")',
      )
      .first(),
  );
  await pageSettled(s.page);
  await refuseSignIn('from the review form');

  const stars = s.page.locator('[role="radio"][aria-label*="star" i]');
  const starCount = await stars.count();
  if (RATING > starCount)
    throw new Error(
      `RATING ${RATING} is more than the ${starCount} stars the review form offers`,
    );
  await humanClickLocator(
    s.page,
    s.page
      .locator(
        `[role="radio"][aria-label*="${RATING} star" i], [role="radio"][aria-label="${RATING}"]`,
      )
      .first(),
  );
  await pageSettled(s.page);

  await humanFill(
    s.page,
    s.page
      .locator('input[placeholder*="title" i], input[aria-label*="title" i]')
      .first(),
    TITLE,
  );
  await pageSettled(s.page);
  await humanFill(
    s.page,
    s.page.locator('textarea, [contenteditable="true"]').first(),
    REVIEW_TEXT,
  );
  await pageSettled(s.page);
  await clickDescribed(s.page, 'the button that sends the review');
  await refuseSignIn('on submit');
  // The form collapses only once Apple accepted the review; one that stays
  // open holds Apple's refusal, and the run fails there.
  if (
    await pageShows(
      s.page,
      'Is the review form still open with its send button?',
    )
  )
    throw new Error(`Apple kept the review form open on ${s.page.url()}`);
  console.log(`PASS: review submitted for app ${APP_ID} (${RATING}★)`);
} finally {
  await s.close();
}
