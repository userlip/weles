// Threads login. The public login page offers Instagram sign-in rather than
// its own form: the stored Instagram account's cookies are injected onto
// instagram.com and mirrored onto threads.net (the same path
// meta/threads_register.mjs takes), and when that alone does not sign the
// page in, its "Continue with Instagram" sign-in and consent are walked.
// The resulting Threads cookies are kept in the Threads account's record.
import {
  getSocialAccount,
  resolveAccountSession,
} from '../../../dist/utils/credentials.js';
import { WSession } from '../../../dist/session/wsession.js';
import { pageSettled } from '../_shared/page/settled.mjs';
import {
  injectProviderCookies,
  waitForNavBackTo,
} from '../../../dist/platforms/_shared/cross_platform_oauth.js';
import { persistFreshCookieJar } from '../_shared/auth/cookie-freshness.mjs';
import { clickOffered } from '../_shared/page/judged/seen.mjs';
import { answerOAuthConsent } from '../_shared/oauth/consent.mjs';

const LOGIN_URL = 'https://www.threads.net/login';
/** Whether `url` is on a Threads domain (threads.net or threads.com). */
const onThreads = (url) => url.hostname.split('.').includes('threads');
/** Whether `url` is Threads' own login route, on whichever Threads domain. */
const onLogin = (address) => {
  const url = new URL(address);
  return onThreads(url) && /^\/(?:accounts\/)?login/.test(url.pathname);
};

const acct = await getSocialAccount('threads');
if (!acct)
  throw new Error(
    'THREADS_ACCOUNT_UNAVAILABLE: no active threads account in Skarbiec',
  );
const igAcct = await getSocialAccount('instagram');
if (!igAcct)
  throw new Error(
    'THREADS_INSTAGRAM_UNAVAILABLE: no instagram account to sign Threads in through',
  );
const igCookies = igAcct.metadata?.cookies;
if (!Array.isArray(igCookies) || !igCookies.length)
  throw new Error(
    `THREADS_INSTAGRAM_SIGNED_OUT: instagram ${igAcct.username} holds no cookies; sign it in to Instagram first`,
  );
console.log(
  `[threads-login] target=${acct.username} via instagram=${igAcct.username}`,
);

const { proxyUrl, persona } = await resolveAccountSession(acct);
const s = await WSession.start({
  label: 'threads_login',
  proxy: proxyUrl,
  persona,
});
try {
  const injected = await injectProviderCookies(s.ctx, 'instagram', igCookies, [
    '.threads.net',
  ]);
  console.log(`[threads-login] injected ${injected} instagram+threads cookies`);
  await s.goto(LOGIN_URL);
  await pageSettled(s.page);
  // Cookies that sign the page in send it straight off /login; otherwise the
  // Instagram sign-in and its consent are walked.
  if (
    onLogin(s.page.url()) &&
    (await clickOffered(s.page, 'the Continue with Instagram button'))
  ) {
    await pageSettled(s.page);
    await answerOAuthConsent(s.page);
    await waitForNavBackTo(s.page, onThreads);
  }
  if (onLogin(s.page.url()))
    throw new Error(
      `threads_login_did_not_advance: the page stays on ${s.page.url()} (the Instagram cookies may be stale)`,
    );
  const cookies = await s.ctx.cookies();
  const persisted = await persistFreshCookieJar(acct, cookies, {
    currentProxyUrl: proxyUrl,
    currentPersona: persona,
  });
  if (!persisted.ok)
    throw new Error(`threads_persist_failed: ${persisted.reason}`);
  console.log(
    `PASS: threads logged in (${cookies.length} cookies persisted, final=${s.page.url()})`,
  );
} finally {
  await s.close();
}
