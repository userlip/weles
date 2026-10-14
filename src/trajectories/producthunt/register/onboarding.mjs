import { CaptchaSolver } from '../../../../dist/captcha/solver.js';
import {
  handleOAuthConsent,
  clickOAuthProviderButton,
} from '../../../../dist/platforms/_shared/cross_platform_oauth.js';
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { pageSettled } from '../../_shared/page/settled.mjs';

async function readPage(s) {
  return (await s.page.locator('body').innerText()).toLowerCase();
}

export async function completeProductHuntOnboarding(
  s,
  url,
  twAccount,
  twUsername,
  twPassword,
  twEmail,
) {
  await s.goto(url);
  await pageSettled(s.page);

  // Dismiss any cookie consent banner
  const t0 = await readPage(s);
  if (
    t0.includes('cookies') ||
    t0.includes('cookie preferences') ||
    t0.includes('accept')
  ) {
    const r1 = await s.click('Accept all').catch(() => 'no-target-found');
    if (r1 === 'no-target-found')
      await s.click('Accept cookies').catch(() => {});
    await pageSettled(s.page);
    if (s.page.isClosed?.()) throw new Error('page_crashed_on_cookie_dismiss');
  }

  // Open the sign-up modal
  await s.click('Sign up').catch(() => {});
  await s.click('Get started').catch(() => {});
  await pageSettled(s.page);

  // Choose Twitter OAuth. Use accessible-name match so we don't misfire onto
  // adjacent provider buttons (Google/Apple) at larger viewports.
  const t1 = await readPage(s);
  console.log(`[ph] signup modal: ${t1.replace(/\n/g, ' ')}`);
  const twitterLabel =
    /^\s*(Sign in with X|Continue with X|Sign up with Twitter|Continue with Twitter)\s*$/i;
  const clickedTw = await clickOAuthProviderButton(s, twitterLabel);
  if (!clickedTw) {
    await s.click('Continue with Twitter').catch(() => {});
    await s.click('Continue with X').catch(() => {});
    await s.click('Sign up with Twitter').catch(() => {});
  }
  await pageSettled(s.page);

  // If Twitter bounced us to the login page (cookies expired), re-authenticate
  const url1 = s.page.url?.() ?? '';
  const t2 = await readPage(s);
  if (
    (url1.includes('twitter.com') || url1.includes('x.com')) &&
    (t2.includes('sign in') || t2.includes('log in') || t2.includes('password'))
  ) {
    console.log('[ph] re-authenticating with twitter credentials');
    await s.fill('username', twUsername).catch(() => {});
    await s.fill('email', twEmail).catch(() => {});
    await pageSettled(s.page);
    await s.click('Next').catch(() => {});
    await pageSettled(s.page);
    await s.fill('password', twPassword);
    await pageSettled(s.page);
    await s.click('Log in').catch(() => {});
    await pageSettled(s.page);
  }

  // OAuth consent screen — ProductHunt asks for Twitter read access
  await handleOAuthConsent(s);

  // ProductHunt onboarding (name, email, interests, notifications): however
  // many steps it shows are walked until the main feed. A page none of the
  // known steps matches is pressed forward; when that leaves it unchanged, it
  // is the failure, named by its URL and text.
  let unknownSeen = null;
  for (;;) {
    if (s.page.isClosed?.()) throw new Error('page_crashed_during_onboarding');
    const url = s.page.url?.() ?? '';
    const t = await readPage(s);
    console.log(`[ph] onboarding: url=${url} text=${t.replace(/\n/g, ' ')}`);

    if (url.includes('twitter.com/login') || url.includes('x.com/login')) {
      throw new Error(`twitter_login_required: ${twUsername}`);
    }

    // ProductHunt gates OAuth sign-ups behind reCAPTCHA v2 at /my/captcha_verification
    if (
      url.includes('/captcha_verification') ||
      t.includes('please, complete') ||
      t.includes('complete the captcha')
    ) {
      console.log(
        '[ph] captcha verification page — extracting sitekey from iframe',
      );
      // Extract sitekey directly from the reCAPTCHA anchor iframe — robust to DOM-order quirks
      const sitekey = await s.page
        .evaluate(`(() => {
        var ifr = document.querySelector('iframe[src*="recaptcha/api2/anchor"]') || document.querySelector('iframe[src*="recaptcha"]');
        if (!ifr) return null;
        var source = ifr.getAttribute('src');
        if (!source) return null;
        var m = source.match(/[?&]k=([^&]+)/);
        if (!m) return null;
        var [, sitekey] = m;
        return sitekey;
      })()`)
        .catch(() => null);
      console.log(`[ph] extracted sitekey: ${sitekey}`);
      if (!sitekey) {
        await pageSettled(s.page);
        continue;
      }
      const solver = new CaptchaSolver();
      const token = await solver
        .solveRecaptchaV2(s.page, sitekey)
        .catch((e) => {
          console.log(`[ph] solver threw: ${e.message}`);
          return null;
        });
      if (!token || typeof token !== 'string') {
        console.log(
          `[ph] solver returned no token (${typeof token}: ${token})`,
        );
        throw new Error('recaptcha_solver_no_token');
      }
      console.log(`[ph] got token: ${token.length} chars`);
      const injected = await s.page
        .evaluate(`(() => {
        var token = ${JSON.stringify(token)};
        // Fill every g-recaptcha-response textarea (there may be several — one per widget)
        document.querySelectorAll('textarea[name="g-recaptcha-response"], #g-recaptcha-response').forEach(function(ta) {
          ta.value = token;
          ta.dispatchEvent(new Event('change', { bubbles: true }));
          ta.dispatchEvent(new Event('input', { bubbles: true }));
        });
        // Walk ___grecaptcha_cfg.clients and fire every function held in a
        // "callback" field; the seen set ends cycles, so no depth is chosen.
        var firedCallbacks = [];
        var seen = new Set();
        function walk(o) {
          if (!o || typeof o !== 'object' || seen.has(o)) return;
          seen.add(o);
          if (typeof o.callback === 'function') { o.callback(token); firedCallbacks.push(o.callback); }
          for (var k in o) {
            try {
              var v = o[k];
              if (v && typeof v === 'object') walk(v);
            } catch (e) {}
          }
        }
        if (window.___grecaptcha_cfg && window.___grecaptcha_cfg.clients) walk(window.___grecaptcha_cfg.clients);
        return { cbCount: firedCallbacks.length, textareas: document.querySelectorAll('textarea[name="g-recaptcha-response"]').length };
      })()`)
        .catch(() => null);
      console.log(
        `[ph] injected token into ${injected?.textareas} textareas, fired ${injected?.cbCount} callbacks`,
      );
      await pageSettled(s.page);
      // ProductHunt's actual submit button is "Verify me!" — and it stays disabled until the reCAPTCHA callback fires
      await s.click('Verify me!').catch(() => {});
      // Force-enable the submit button (ProductHunt leaves it disabled after
      // the reCAPTCHA callback) and then trigger a trusted force-click.
      const submitBtn = s.page.locator('button[type="submit"]').first();
      if (await submitBtn.count()) {
        await submitBtn
          .evaluate((el) => {
            el.disabled = false;
            el.classList.remove('cursor-not-allowed', 'opacity-50');
          })
          .catch(() => {});
        await humanClickLocator(s.page, submitBtn).catch(() => {});
        console.log(`[ph] submit: clicked`);
      } else {
        console.log(`[ph] submit: no-button`);
      }
      await pageSettled(s.page);
      continue;
    }

    if (
      url.match(/producthunt\.com\/?$/) ||
      url.includes('/home') ||
      url.includes('/feed') ||
      t.includes('welcome back')
    ) {
      console.log('[ph] reached main feed');
      break;
    }

    if (
      t.includes('what should we call you') ||
      t.includes('your name') ||
      t.includes('display name')
    ) {
      await s.fill('name', `${twAccount.username}`).catch(() => {});
      await s.click('Continue').catch(() => {});
      await s.click('Next').catch(() => {});
      await pageSettled(s.page);
      continue;
    }
    if (
      t.includes('email') &&
      (t.includes('confirm') ||
        t.includes('verify') ||
        t.includes('enter your email'))
    ) {
      if (twEmail) await s.fill('email', twEmail).catch(() => {});
      await s.click('Continue').catch(() => {});
      await s.click('Next').catch(() => {});
      await pageSettled(s.page);
      continue;
    }
    if (
      t.includes('interests') ||
      t.includes('what topics') ||
      t.includes('follow topics')
    ) {
      await s.click('Skip').catch(() => {});
      await s.click('Continue').catch(() => {});
      await s.click('Next').catch(() => {});
      await pageSettled(s.page);
      continue;
    }
    if (t.includes('notifications') || t.includes('enable notifications')) {
      await s.click('Not now').catch(() => {});
      await s.click('Skip').catch(() => {});
      await pageSettled(s.page);
      continue;
    }
    if (unknownSeen === `${url}\n${t}`)
      throw new Error(
        `producthunt_onboarding_unrecognised: url=${url} text=${t.replace(/\n/g, ' ')}`,
      );
    unknownSeen = `${url}\n${t}`;
    await s.click('Continue').catch(() => {});
    await s.click('Next').catch(() => {});
    await s.click('Done').catch(() => {});
    await pageSettled(s.page);
  }
}
