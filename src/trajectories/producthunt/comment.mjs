// Post a comment on the Product Hunt launch the caller names.
//
// Env:
//   PRODUCTHUNT_URL   required: https://www.producthunt.com/products/<slug>,
//                     the launch the comment is posted on
//   PH_COMMENT        required: the comment's text, published under the
//                     account's name
//
// Nothing is commented on a launch nobody named, and no words are written
// here. The account signs in from its fresh cookie jar, or through its X
// sign-in when the jar is stale or the page shows it signed out; the comment
// counts as posted only when its text shows outside every editable field.
import { WSession } from '../../../dist/session/wsession.js';
import {
  getSocialAccount,
  resolveAccountSession,
  markCookiesStale,
} from '../../../dist/utils/credentials.js';
import { injectPHCookies, loginViaTwitter } from './_session.mjs';
import { humanType } from '../../../dist/human/keyboard.js';
import { humanClickLocator } from '../../../dist/human/mouse.js';
import { assertAuthed, AuthProbeError } from '../_shared/auth/auth-probe.mjs';
import {
  loadFreshCookieJarOrFail,
  CookieJarStaleError,
} from '../_shared/auth/cookie-freshness.mjs';
import { statedText } from '../_shared/inputs/stated.mjs';
import { pageSettled } from '../_shared/page/settled.mjs';
import { textShownOutsideEditors } from '../_shared/page/shows.mjs';
import { clickDescribed, pageShows } from '../_shared/page/judged/seen.mjs';

const TARGET_URL = statedText(
  ['PRODUCTHUNT_URL'],
  'the Product Hunt launch page the comment is posted on',
);
const COMMENT_TEXT = statedText(['PH_COMMENT'], 'the comment text to publish');

/** Inject the account's saved cookies unless its jar is stale. */
async function injectFreshCookies(s, acct, sessionMeta) {
  let cookies;
  let stale;
  try {
    cookies = loadFreshCookieJarOrFail(acct, {
      platform: 'producthunt',
      label: 'producthunt_comment',
      currentProxyUrl: sessionMeta.proxyUrl,
      currentPersona: sessionMeta.persona,
    });
  } catch (jarErr) {
    if (!(jarErr instanceof CookieJarStaleError)) throw jarErr;
    stale = jarErr;
  }
  if (stale) {
    console.log(`[ph-comment] ${stale.message}; signing in through X`);
    return;
  }
  const inj = await injectPHCookies(s, cookies);
  console.log(`[ph-comment] injected ${inj} saved cookies`);
}

async function postComment(s, acct, sessionMeta) {
  await injectFreshCookies(s, acct, sessionMeta);
  await s.goto(TARGET_URL);
  await pageSettled(s.page);
  if (
    await pageShows(
      s.page,
      'Is the visitor signed out of Product Hunt, with the page offering to sign in?',
    )
  ) {
    console.log('[ph-comment] signed out; running the X sign-in');
    await loginViaTwitter(s);
    await s.goto(TARGET_URL);
    await pageSettled(s.page);
  }
  try {
    await assertAuthed('producthunt', s, { label: 'producthunt_comment' });
  } catch (probeErr) {
    if (!(probeErr instanceof AuthProbeError)) throw probeErr;
    // A jar that could not be marked stale is picked again by the next run;
    // the failure says so beside the probe's own cause.
    const marked = await markCookiesStale(acct.id).then(
      () => '',
      (markError) =>
        `; the cookie jar was not marked stale: ${markError.message}`,
    );
    throw new Error(`auth_probe_failed: ${probeErr.message}${marked}`);
  }

  // The launch's comment editor is a TipTap contenteditable, typed into
  // with real key events; the comment is posted with its own button.
  const editor = s.page
    .locator('[contenteditable="true"][role="textbox"].tiptap')
    .first();
  await editor.waitFor();
  await humanClickLocator(s.page, editor);
  await humanType(s.page, COMMENT_TEXT);
  await clickDescribed(
    s.page,
    'the button that posts the comment typed in the comment editor',
  );
  await pageSettled(s.page);
  if (!(await textShownOutsideEditors(s.page, COMMENT_TEXT)))
    throw new Error(
      `comment_not_found_after_post: the comment shows nowhere outside the editor at ${s.page.url()}`,
    );
}

const acct = await getSocialAccount('producthunt');
if (!acct)
  throw new Error('no Product Hunt account is recorded; nothing was commented');
console.log(`[ph-comment] using account: ${acct.username}`);

const sessionOpts = await resolveAccountSession(acct);
const s = await WSession.start({
  label: 'producthunt_comment',
  ...sessionOpts,
  browser: 'chromium',
});
try {
  await postComment(s, acct, sessionOpts);
  console.log(`PASS: ${acct.username} commented on ${TARGET_URL}`);
} finally {
  await s.close();
}
