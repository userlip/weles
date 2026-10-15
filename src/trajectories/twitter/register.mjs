import { WSession } from '../../../dist/session/wsession.js';
import { humanClickLocator } from '../../../dist/human/mouse.js';
import { autoBindCharacter } from '../lib/character-bind.mjs';
import { pageSettled } from '../_shared/page/settled.mjs';
import {
  autocompleteField,
  clickFirst,
  control,
  field,
  frameFrom,
} from '../_shared/page/offers.mjs';
import { statedProxy } from '../_shared/inputs/stated.mjs';
import { phoneForField } from '../_shared/inputs/phone.mjs';
import { fieldCodeLength, mailedCode } from '../_shared/inputs/mailed_code.mjs';

const SIGNUP_URL = 'https://x.com/i/flow/signup?lang=en';
const HOME = 'https://x.com/home';
const proxy = statedProxy('the X signup');

// Twitter's flow marks its own controls with test ids: the signup form's Next,
// the submit, and on every onboarding step a Skip control and a Next control.
const NEXT = '[data-testid="ocfSignupNextLink"]';
const SUBMIT =
  '[data-testid="SignupButton"], [data-testid="LoginForm_Login_Button"]';
const ONBOARDING_SKIP =
  '[data-testid$="SkipButton"], [data-testid$="SkipForNowButton"]';
const ONBOARDING_NEXT =
  '[data-testid$="NextButton"], [data-testid$="NextLink"]';

// The Arkose challenge, read from its iframe: the public key is the path
// segment shaped as a UUID, the blob the frame's `data` parameter in its query
// or its fragment (the solver takes a challenge without one). Null when no
// such frame is attached.
function arkose(page) {
  const frame = frameFrom(page, 'arkoselabs.com');
  if (!frame) return null;
  const src = new URL(frame.url());
  const hashParams = new URLSearchParams(src.hash.replace(/^#/, ''));
  return {
    publicKey: src.pathname
      .split('/')
      .find((segment) => segment.includes('-') && /^[\dA-F-]+$/i.test(segment)),
    blob: [src.searchParams, hashParams].map((params) => params.get('data')).find(Boolean),
    subdomain: src.origin,
  };
}

async function solveArkose(s, ark) {
  const { CaptchaSolver } = await import('../../../dist/captcha/solver.js');
  const token = await new CaptchaSolver().solveFuncaptcha(
    ark.publicKey,
    'https://x.com/i/flow/signup',
    ark.subdomain,
    ark.blob,
  );
  // Twitter's Arkose iframe posts the token to the page; the same message
  // shape injected from the page completes the challenge.
  await s.page.evaluate((tk) => {
    const message = JSON.stringify({
      eventId: 'challenge-complete',
      payload: { sessionToken: tk },
    });
    window.postMessage(message, '*');
    for (const iframe of document.querySelectorAll('iframe')) {
      if (iframe.src.includes('arkoselabs'))
        iframe.contentWindow?.postMessage(message, '*');
    }
  }, token);
  await pageSettled(s.page);
}

// Which input the flow's current step asks for: the first visible one of the
// fields the signup flow has, or null on a step with none (a prompt page).
async function step(page) {
  if (await field(page, 'password')) return 'password';
  if (
    (await autocompleteField(page, 'one-time-code')) ||
    (await field(page, 'verfication_code'))
  )
    return 'code';
  if (await field(page, 'email')) return 'email';
  if (await field(page, 'phone_number')) return 'phone';
  if (await field(page, 'name')) return 'name';
  return null;
}

// Clicks the first visible control of `selector` with a trusted click
// (Arkose-gated submits reject one dispatched from the page); false when none.
async function press(page, selector) {
  const found = page.locator(selector).first();
  if (!(await found.isVisible())) return false;
  await humanClickLocator(page, found);
  return true;
}

async function signup(s) {
  const id = await s.generateIdentity('twitter');
  const name = `${id.firstName} ${id.lastName}`;
  console.log(`[tw] identity: ${id.username} / ${id.email}`);
  const page = s.page;

  await s.ctx.addCookies([
    { name: 'lang', value: 'en', domain: '.x.com', path: '/' },
  ]);
  await s.goto(SIGNUP_URL);
  await pageSettled(page);

  if (await clickFirst(page, 'button', ['Refuse non-essential cookies']))
    await pageSettled(page);

  // A page that offers only a retry is Twitter's own error page.
  if (
    !(await control(page, 'button', 'Create account')) &&
    (await control(page, 'button', 'Retry'))
  ) {
    console.log('[tw] got error page, retrying...');
    throw new Error('page_error');
  }

  await s.click('Create account');
  await pageSettled(page);
  await s.fill('Name', name);
  await pageSettled(page);

  if (await clickFirst(page, 'button', ['Use email instead']))
    await pageSettled(page);

  const contact = await step(page);
  if (contact === 'email') {
    await s.fill('Email', id.email);
  } else if (contact === 'phone') {
    // Rented in the country the phone field is set to (../_shared/inputs/phone.mjs).
    await s.fill('Phone', await phoneForField(s, page, 'twitter'));
  } else {
    throw new Error(
      `signup form offers neither an email nor a phone field; step ${contact}`,
    );
  }
  await pageSettled(page);

  await s.select('Month', id.birthMonth);
  await s.select('Day', id.birthDay);
  await s.select('Year', id.birthYear);
  await pageSettled(page);

  if (!(await press(page, NEXT)))
    throw new Error('signup form offers no Next after the date of birth');
  console.log('[tw] clicked Next, waiting for page change...');

  // The flow's own steps (step()) after which it asks for something only
  // the new account holds: the code it sent, or the password it sets.
  const ASKS_FOR_SECRET = { code: true, password: true };

  // Each round reads what the page now offers and acts on it: the Arkose
  // frame, the Authenticate button, a prompt page with only Next, the
  // logged-out home, or the next input of the flow. Rounds continue until the
  // flow asks for the code or the password, or lands on the logged-out home.
  for (;;) {
    await pageSettled(page);
    const current = await step(page);
    console.log(`[tw] waiting: url=${page.url()} step=${current}`);

    const ark = arkose(page);
    if (ark) {
      if (!ark.publicKey) {
        console.log('[tw] Arkose frame without a public key; waiting');
        continue;
      }
      console.log(
        `[tw] Arkose detected, solving via FunCaptcha API: pk=${ark.publicKey}`,
      );
      await solveArkose(s, ark);
      continue;
    }
    if (Object.hasOwn(ASKS_FOR_SECRET, current)) break;
    if (await clickFirst(page, 'button', ['Authenticate'])) continue;
    if (current === null && (await press(page, NEXT))) continue;
    if (
      page.url() === 'https://x.com/' &&
      (await control(page, 'link', 'Sign in'))
    )
      throw new Error('flow_lost');
  }

  if ((await step(page)) === 'code') {
    const oneTime = await autocompleteField(page, 'one-time-code');
    const codeField = oneTime ? oneTime : await field(page, 'verfication_code');
    let code;
    if (contact === 'phone') {
      // The session's SMS read answers the code, or why it has none; only a
      // code is typed.
      code = await s.pollSmsCode();
      if (!/^\d+$/.test(code)) throw new Error(`twitter_sms_code_unread: ${code}`);
    } else {
      code = await mailedCode(id.email, 'x.com', await fieldCodeLength(codeField));
    }
    console.log(`[tw] ${contact} verification code received`);
    await s.fill('code', code);
    await pageSettled(page);
    await s.click('Next');
    await pageSettled(page);
    // A flow that still asks for the code did not accept it: Twitter rejected
    // the code or the challenge behind it.
    if ((await step(page)) === 'code') {
      console.log('[tw] code not accepted, retrying...');
      throw new Error('code_rejected');
    }
  }

  await pageSettled(page);
  if ((await step(page)) === 'password') {
    await s.fill('Password', id.password);
    await pageSettled(page);
    if (!(await press(page, SUBMIT))) await s.press('Enter');
    await pageSettled(page);
  }

  // Skip onboarding steps until the home feed: each step's own Skip control
  // first, its Next control when it has no Skip. A step offering neither
  // ends the walk, and the home feed is opened directly.
  for (;;) {
    const url = page.url();
    console.log(`[tw] onboarding: url=${url}`);
    if (url.includes('/home')) break;
    if (
      url === 'https://x.com/' ||
      !(
        (await press(page, ONBOARDING_SKIP)) ||
        (await press(page, ONBOARDING_NEXT))
      )
    ) {
      await s.goto(HOME);
      await pageSettled(page);
      break;
    }
    await pageSettled(page);
  }

  // Success is the session's auth cookies (the session token and its CSRF
  // pair), not what the page says.
  const cookies = await s.ctx.cookies();
  const onX = (c) => c.domain.includes('x.com') || c.domain.includes('twitter.com');
  const authToken = cookies.find((c) => onX(c) && c.name === 'auth_token');
  const csrf = cookies.find((c) => onX(c) && c.name === 'ct0');
  if (!authToken || !csrf)
    throw new Error(
      `no_auth_cookies: the signup ended on ${page.url()} without ${authToken ? '' : 'auth_token '}${csrf ? '' : 'ct0'}`,
    );

  const result = await s.saveAccount('twitter', {
    username: id.username,
    email: id.email,
    password: id.password,
    name,
  });
  console.log(`[tw] ${result}`);
  const bound = await autoBindCharacter(id.username, 'twitter');
  console.log(`[bind] ${JSON.stringify(bound)}`);
  return id.username;
}

// Chromium only: Weles's fill path needs its devtools session.
const s = await WSession.start({ label: 'twitter_register', proxy });
try {
  console.log(`PASS: ${await signup(s)}`);
} finally {
  await s.close();
}
