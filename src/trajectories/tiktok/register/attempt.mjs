// One TikTok email signup in a session: phone-or-email, the email tab, birth
// date, email and password, the code TikTok mails, Next, the username step.
// Every step is decided by TikTok's own answer to the call it sent (or the
// captcha it shows instead) and by its session cookie, never by page words.
// A failed step throws with its cause; a refusal TikTok gives the session
// itself (its captcha before the code is sent, or a refused code request)
// carries sessionRefused, since another identity on it would end the same way.
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { humanType } from '../../../../dist/human/keyboard.js';
import {
  pageSettled,
  responseAfterAction,
} from '../../_shared/page/settled.mjs';
import { clickOffered } from '../../_shared/page/judged/seen.mjs';
import {
  fieldCodeLength,
  mailedCode,
} from '../../_shared/inputs/mailed_code.mjs';
import {
  runUsernameStep,
  syncReactInputValue,
} from '../../lib/tiktok-register-helpers.mjs';

const HOME_URL = 'https://www.tiktok.com/';
const EXPLORE_URL = 'https://www.tiktok.com/explore';
const SIGNUP_URL = 'https://www.tiktok.com/signup';
// TikTok's own calls: the code request and the sign-up verification.
const SEND_CODE = /\/passport\/web\/email\/send_code\/?$/;
const REGISTER_VERIFY = /\/register_verify_login\/?$/;
// TikTok's captcha widget, as the page renders it.
const CAPTCHA_SHOWN = `Boolean(document.querySelector('.captcha-verify-container, .captcha_verify_container, [class*="captcha-"], iframe[src*="captcha"]'))`;
// The mssdk route TikTok pins in the page state; a TTP2 route makes the
// signup form's click handlers return without acting.
const VREGION = /"vregion":"(?<region>[A-Z\d-]+)"/;
const PASSWORD_FIELD = 'input[placeholder="Password"], input[type="password"]';
const CODE_FIELD = 'input[placeholder*="digit" i], input[name="code"]';
const SEND_CODE_BUTTON = '[data-e2e="send-code-button"]';
const USERNAME_PAGE = /\/signup\/create-username/;
const SUCCESS = 'success';

const pathOf = (request) => new URL(request.url()).pathname;

const refusal = (message, sessionRefused) =>
  Object.assign(new Error(message), { sessionRefused });

/**
 * TikTok's answer to the request `action` sends to `path`, or the captcha it
 * shows instead: a captcha widget holds the request back until it is solved.
 */
async function answerOrCaptcha(page, path, action) {
  let decided = false;
  const captcha = (async () => {
    while (!decided) {
      await pageSettled(page);
      if (await page.evaluate(CAPTCHA_SHOWN)) return { captcha: true };
    }
    return { captcha: false };
  })();
  const answered = responseAfterAction(
    page,
    (request) => path.test(pathOf(request)),
    action,
  ).then((response) => ({ response }));
  const first = await Promise.race([answered, captcha]);
  decided = true;
  return first;
}

/** TikTok's JSON answer to `what`; refused, with the status and address, when it is not JSON. */
async function readAnswer(response, what) {
  try {
    return await response.json();
  } catch (cause) {
    throw new Error(
      `TIKTOK_ANSWER_UNREADABLE: ${what} answered ${response.status()} ${response.url()}, not JSON: ${cause.message}`,
      { cause },
    );
  }
}

/** Opens the signup form on its email tab, refusing a session TikTok routes through TTP2. */
async function openEmailSignup(s) {
  const page = s.page;
  // The account is created from a session that has visited TikTok first, as a person's would.
  for (const url of [HOME_URL, EXPLORE_URL]) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await pageSettled(page);
  }
  await s.goto(SIGNUP_URL);
  await pageSettled(page);
  const region = (await page.content()).match(VREGION)?.groups.region;
  console.log(`[test] browser-time vregion=${region}`);
  if (region?.endsWith('-TTP2'))
    throw new Error(
      `TIKTOK_TTP2_ROUTED: the exit is routed through ${region}, whose signup form ignores clicks`,
    );
  if (
    await clickOffered(
      page,
      'the button that declines optional cookies, or accepts them when declining is not offered',
    )
  )
    await pageSettled(page);
  while (!page.url().includes('/phone-or-email')) {
    await s.click('Use phone or email');
    await pageSettled(page);
  }
  while (!page.url().includes('/email')) {
    await s.click('Sign up with email');
    await pageSettled(page);
  }
}

/** Fills birth date, email and password; the password is typed into the focused field, never clicked, since the field's show/hide control sits inside it. */
async function fillSignupForm(s, id, password) {
  const page = s.page;
  await s.select('month', id.birthMonth);
  await s.select('day', id.birthDay);
  await s.select('year', id.birthYear);
  await pageSettled(page);
  await s.fill('Email', id.email);
  const passwordField = page.locator(PASSWORD_FIELD).first();
  if (!(await passwordField.count()))
    throw new Error(
      `TIKTOK_PASSWORD_FIELD_MISSING: ${page.url()} shows no password field`,
    );
  await passwordField.focus();
  await pageSettled(page);
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Delete');
  await humanType(page, password);
  await pageSettled(page);
  await page.keyboard.press('Tab');
  await pageSettled(page);
  return passwordField;
}

/** Asks TikTok to mail the code; TikTok's own answer, or its captcha, decides. */
async function requestCode(s) {
  const page = s.page;
  const send = page.locator(SEND_CODE_BUTTON).first();
  if (!(await send.count()) || !(await send.isEnabled()))
    throw new Error(
      'TIKTOK_SEND_CODE_DISABLED: the form shows no enabled send-code control after the email and password',
    );
  const sent = await answerOrCaptcha(page, SEND_CODE, () =>
    s.click('Send code'),
  );
  if (sent.captcha)
    throw refusal(
      'TIKTOK_CAPTCHA_ON_SEND_CODE: TikTok showed its captcha before sending the code',
      true,
    );
  const body = await readAnswer(sent.response, 'send_code');
  if (body?.message !== SUCCESS)
    throw refusal(`TIKTOK_SEND_CODE_REFUSED: ${JSON.stringify(body)}`, true);
}

/** Types the mailed code, submits, and answers TikTok's verdict on the new account. */
async function verifyCode(s, id, password, passwordField) {
  const page = s.page;
  const codeField = page.locator(CODE_FIELD).first();
  if (!(await codeField.count()))
    throw new Error(
      `TIKTOK_CODE_FIELD_MISSING: ${page.url()} shows no code field after the code was sent`,
    );
  const code = await mailedCode(
    id.email,
    'tiktok',
    await fieldCodeLength(codeField),
  );
  await humanClickLocator(page, codeField);
  await humanType(page, code);
  // React reconciles the controlled fields only once send_code succeeded.
  await syncReactInputValue(passwordField, password);
  await syncReactInputValue(codeField, code);
  await page.keyboard.press('Tab');
  await pageSettled(page);
  const verified = await answerOrCaptcha(page, REGISTER_VERIFY, () =>
    s.click('Next'),
  );
  if (verified.captcha)
    throw new Error(
      'TIKTOK_CAPTCHA_ON_NEXT: TikTok showed its captcha when the code was submitted',
    );
  const body = await readAnswer(verified.response, 'register_verify_login');
  if (body?.message !== SUCCESS)
    throw new Error(`TIKTOK_ACCOUNT_NOT_CREATED: ${JSON.stringify(body)}`);
  await pageSettled(page);
}

/**
 * One signup of `id` with `password` in session `s`. Answers the username
 * TikTok kept once the context holds TikTok's session cookie.
 */
export async function registerOnce(s, id, password) {
  await openEmailSignup(s);
  const passwordField = await fillSignupForm(s, id, password);
  await requestCode(s);
  await verifyCode(s, id, password, passwordField);
  const username = USERNAME_PAGE.test(new URL(s.page.url()).pathname)
    ? await runUsernameStep(s, id)
    : id.username;
  // Signed in is TikTok's own session cookie on the context: it is HttpOnly,
  // and a /foryou or /@ address is shown to signed-out visitors too.
  const cookies = await s.ctx.cookies(HOME_URL);
  if (!cookies.some((cookie) => cookie.name === 'sessionid' && cookie.value))
    throw new Error(
      `TIKTOK_NOT_SIGNED_IN: the context holds no TikTok sessionid at ${s.page.url()}`,
    );
  return username;
}
