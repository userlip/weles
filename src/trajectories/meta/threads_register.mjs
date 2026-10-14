import { WSession } from '../../../dist/session/wsession.js';
import { injectProviderCookies } from '../../../dist/platforms/_shared/cross_platform_oauth.js';
import { listAccounts } from '../_shared/skarbiec/accounts.mjs';
import { pageSettled } from '../_shared/page/settled.mjs';
import { control, field } from '../_shared/page/offers.mjs';
import { clickOffered } from '../_shared/page/judged/seen.mjs';
import { statedProxy } from '../_shared/inputs/stated.mjs';

// The control that takes an onboarding step forward without changing it.
const NEXT_STEP = 'the button that skips or continues this onboarding step';

// An active Instagram account whose record carries a session (its cookies).
function findUsableInstagramAccount() {
  return (
    listAccounts('instagram').find(
      (account) =>
        Array.isArray(account.metadata?.cookies) &&
        account.metadata.cookies.length >= 2,
    ) ?? null
  );
}

const URL = 'https://www.threads.net/login';
const proxy = statedProxy('the Threads signup');

function pathOf(page) {
  return new globalThis.URL(page.url()).pathname;
}

function onInstagram(page) {
  return new globalThis.URL(page.url()).hostname.endsWith('instagram.com');
}

function onThreadsFeed(page) {
  const url = new globalThis.URL(page.url());
  return (
    /(^|\.)threads\.(net|com)$/.test(url.hostname) &&
    !url.pathname.startsWith('/login') &&
    (url.pathname === '/' || url.pathname.startsWith('/@'))
  );
}

// The Instagram account cannot go on: its session landed on a block or a
// challenge, or Instagram asks for a phone.
async function instagramBlocked(page) {
  if (!onInstagram(page)) return false;
  const path = pathOf(page);
  return (
    path.startsWith('/accounts/suspended') ||
    path.startsWith('/challenge') ||
    (await field(page, 'phone_number')) !== null
  );
}

async function signup(s) {
  const page = s.page;
  const igAccount = findUsableInstagramAccount();
  if (!igAccount) throw new Error('no_instagram_account_with_cookies');
  const igCookies = igAccount.metadata.cookies;
  const igUsername = igAccount.username;
  const igPassword = igAccount.password;
  const igEmail = igAccount.metadata?.email;
  console.log(
    `[threads] using instagram account: ${igUsername} (${igCookies.length} cookies)`,
  );
  // Threads is signed into through Instagram, so the account is recorded with
  // Instagram's email and password. Without them no Threads profile is
  // created: one created first would be recorded with an invented address
  // and password.
  if (!igEmail || !igPassword)
    throw new Error(
      `instagram_account_incomplete: Instagram account ${igUsername} carries no ${igEmail ? 'password' : 'email'} in Skarbiec to record the Threads account with; nothing was created`,
    );

  const injected = await injectProviderCookies(s.ctx, 'instagram', igCookies, {
    extraMirrorDomains: ['.threads.net'],
  });
  console.log(`[threads] injected ${injected} instagram+threads cookies`);

  await s.goto(URL);
  await pageSettled(page);

  // Cookie consent: one click on the consent control the page offers.
  if (await clickOffered(page, 'the button that accepts cookies')) {
    await pageSettled(page);
    if (page.isClosed()) throw new Error('page_crashed_on_cookie_dismiss');
  }

  // Sign in through the Instagram session.
  if (await clickOffered(page, 'the button or link to continue with Instagram'))
    await pageSettled(page);

  // Instagram's own login form means the cookies no longer carry a session.
  if (onInstagram(page) && (await field(page, 'password'))) {
    console.log('[threads] re-authenticating with instagram credentials');
    if (!igPassword) throw new Error('instagram_cookies_expired_no_password');
    await s.fill('username', igUsername);
    await pageSettled(page);
    await s.fill('password', igPassword);
    await pageSettled(page);
    const submit = page.locator('button[type="submit"]').first();
    if (!(await submit.isVisible()))
      throw new Error('instagram login form offers no submit');
    await submit.click();
    await pageSettled(page);
  }

  // Instagram's own prompts after login (save login, notifications) are each
  // dismissed without accepting.
  while (
    await clickOffered(
      page,
      'the button that dismisses an Instagram prompt (save login, notifications) without accepting it',
    )
  ) {
    await pageSettled(page);
  }

  // Threads onboarding: each step offers a control to take it forward; however
  // many there are are walked, and a page with none is the failure.
  for (;;) {
    if (page.isClosed()) throw new Error('page_crashed_during_onboarding');
    console.log(`[threads] onboarding: url=${page.url()}`);
    if (await instagramBlocked(page))
      throw new Error(
        `instagram_account_suspended_or_challenged: ${igUsername}`,
      );
    if (onThreadsFeed(page)) {
      console.log('[threads] reached main feed');
      break;
    }
    if (
      await clickOffered(
        page,
        'the button that imports the profile from Instagram',
      )
    ) {
      await pageSettled(page);
      continue;
    }
    if (await control(page, 'radio', 'Public profile')) {
      await (await control(page, 'radio', 'Public profile')).click();
      await clickOffered(page, NEXT_STEP);
      await pageSettled(page);
      continue;
    }
    if (
      await clickOffered(page, 'the button that follows all suggested profiles')
    ) {
      await clickOffered(page, NEXT_STEP);
      await pageSettled(page);
      continue;
    }
    if (
      await clickOffered(
        page,
        'the button that joins Threads or starts signing up',
      )
    ) {
      await pageSettled(page);
      continue;
    }
    if (await clickOffered(page, NEXT_STEP)) {
      await pageSettled(page);
      continue;
    }
    throw new Error(
      `threads onboarding offers no control to continue at ${page.url()}`,
    );
  }

  // Success is the Threads session cookie, not what the page says; the
  // device and CSRF cookies are set for signed-out visitors too.
  const cookies = await s.ctx.cookies();
  const threadsAuth = cookies.filter(
    (c) =>
      (c.domain?.includes('threads.net') ||
        c.domain?.includes('threads.com')) &&
      c.name === 'sessionid',
  );
  if (!threadsAuth.length) {
    console.log(
      `[threads] no threads session cookie. all cookies: ${cookies.map((c) => `${c.name}@${c.domain}`).join(', ')}`,
    );
    throw new Error('no_threads_auth_cookies');
  }
  console.log(
    `[threads] auth cookies: ${threadsAuth.map((c) => `${c.name}@${c.domain}`).join(', ')}`,
  );

  const result = await s.saveAccount('threads', {
    username: igUsername,
    email: igEmail,
    password: igPassword,
  });
  console.log(`[threads] ${result}`);
  return igUsername;
}

const s = await WSession.start({ label: 'threads_register', proxy });
try {
  const username = await signup(s);
  console.log(`PASS: ${username}`);
} catch (e) {
  console.log(`FAIL: ${e.message}`);
  process.exitCode = 1;
} finally {
  await s.close();
}
