// Product Hunt is signed into through X. A new Product Hunt account signs up
// through an X account no Product Hunt account is linked to yet (Product Hunt
// binds one X account to one of its own); an existing one signs in again
// through the X account it was linked with (metadata.linked_twitter_username,
// kept by stampLinkedTwitter). The cross-platform OAuth steps (provider
// cookies, consent, the way back, the captcha gate) are the shared ones in
// src/platforms/_shared/cross_platform_oauth.ts; the page's own controls are
// found by the vision model.
import { CaptchaSolver } from '../../../dist/captcha/solver.js';
import {
  injectProviderCookies,
  handleOAuthConsent,
  waitForNavBackTo,
  clearReCaptchaGate,
} from '../../../dist/platforms/_shared/cross_platform_oauth.js';
import { clickDescribed, clickOffered } from '../_shared/page/judged/seen.mjs';
import { pageSettled } from '../_shared/page/settled.mjs';
import { findAccount, listAccounts, updateAccountMetadata } from '../_shared/skarbiec/accounts.mjs';

const HOME = 'https://www.producthunt.com/';
const HANDLE_PATH = /^\/@(?<handle>[^/?#]+)/;
const hasCookies = (account) => Array.isArray(account.metadata.cookies) && account.metadata.cookies.length;

/** An X account with cookies that no Product Hunt account is linked to yet; refused when there is none. */
export async function findUsableTwitterAccount() {
  const linked = new Set();
  for (const account of listAccounts('producthunt')) {
    if (account.metadata.linked_twitter_username) linked.add(account.metadata.linked_twitter_username.toLowerCase());
    // Accounts recorded before the link was kept carry the X name as their own.
    linked.add(account.username.toLowerCase());
  }
  const free = listAccounts('twitter').find((account) => hasCookies(account) && !linked.has(account.username.toLowerCase()));
  if (!free) throw new Error('PRODUCTHUNT_NO_FREE_X_ACCOUNT: every X account with cookies is already linked to a Product Hunt account');
  return free;
}

/** The X account `phAcct` was linked with; refused when the link or the account is missing. */
export function linkedTwitterAccount(phAcct) {
  const name = phAcct.metadata.linked_twitter_username;
  if (!name) throw new Error(`PRODUCTHUNT_X_LINK_MISSING: Product Hunt account ${phAcct.username} records no linked X account`);
  const twitter = findAccount('twitter', name);
  if (!twitter) throw new Error(`PRODUCTHUNT_X_ACCOUNT_MISSING: Product Hunt account ${phAcct.username} is linked to X ${name}, which Skarbiec does not hold`);
  if (!hasCookies(twitter)) throw new Error(`PRODUCTHUNT_X_COOKIES_MISSING: X account ${name} holds no cookies to sign in with`);
  return twitter;
}

/** Records on the Product Hunt account which X account it signed up through. */
export async function stampLinkedTwitter(phUsername, twUsername) {
  const account = findAccount('producthunt', phUsername);
  if (!account) throw new Error(`cannot link X ${twUsername}: Product Hunt account ${phUsername} was not saved`);
  updateAccountMetadata(account.id, { linked_twitter_username: twUsername });
  console.log(`[ph] stamped linked_twitter_username="${twUsername}" on ${account.id}`);
}

/** Signs `s` in to Product Hunt through the X account `twitter`. */
export async function signInThroughX(s, twitter) {
  console.log(`[ph-session] OAuth via X account ${twitter.username}`);
  await injectProviderCookies(s.ctx, 'twitter', twitter.metadata.cookies);
  await s.goto(HOME);
  await pageSettled(s.page);
  await clickOffered(s.page, "the button that opens Product Hunt's sign-in");
  await clickDescribed(s.page, 'the button that signs in with X (Twitter), not Google or Apple');
  await pageSettled(s.page);
  await handleOAuthConsent(s);
  await waitForNavBackTo(s.page, 'producthunt.com', ['/auth/', 'twitter.com', 'x.com']);
  if (!(await clearReCaptchaGate(s, new CaptchaSolver(), '/captcha_verification')))
    throw new Error(`PRODUCTHUNT_CAPTCHA_GATE: the captcha after signing in through X ${twitter.username} was not cleared`);
}

/** Signs the existing Product Hunt account `phAcct` in again, through the X account it is linked with. */
export async function loginViaTwitter(s, phAcct) {
  await signInThroughX(s, linkedTwitterAccount(phAcct));
}

/**
 * The signed-in account's Product Hunt handle: from Product Hunt's own API
 * (a GraphQL `Me` query with the session's cookies, which no cached signed-out
 * page can answer for), else from where /my/profile sends the session.
 * Refused, with both observations, when neither names one.
 */
export async function extractPhHandle(s) {
  const answer = await s.ctx.request.post('https://www.producthunt.com/frontend/graphql', {
    headers: { 'content-type': 'application/json' },
    data: JSON.stringify({ query: 'query Me { user { username } }' }),
  });
  const body = answer.ok() ? await answer.json() : null;
  const handle = body && body.data && body.data.user ? body.data.user.username : null;
  if (handle) return handle;
  await s.goto('https://www.producthunt.com/my/profile');
  await pageSettled(s.page);
  const redirected = new URL(s.page.url()).pathname.match(HANDLE_PATH)?.groups.handle;
  if (redirected) return redirected;
  throw new Error(
    `PRODUCTHUNT_HANDLE_UNREAD: the Me query answered ${answer.status()} ${JSON.stringify(body)}, and /my/profile led to ${s.page.url()}`,
  );
}
