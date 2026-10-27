// Steps of the TikTok email signup that tiktok/register/attempt.mjs runs:
// the React-aware value sync, the passport traffic log kept for diagnosis,
// and the username step. A failed step throws with its cause.
import { humanType } from '../../../dist/human/keyboard.js';
import { pageSettled, urlMatching } from '../_shared/page/settled.mjs';
import { clickDescribed } from '../_shared/page/judged/seen.mjs';

/**
 * React-aware input value sync. React keeps a private value tracker and
 * ignores input events if it believes the value did not change; the tracker
 * is reset before input/change are dispatched, so the controlled input
 * picks up the value set through the descriptor setter.
 */
export async function syncReactInputValue(locator, value) {
  await locator.evaluate((el, v) => {
    const proto = Object.getPrototypeOf(el);
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, v);
    else el.value = v;
    el._valueTracker?.setValue('');
    el.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: v,
      }),
    );
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

// TikTok's own passport and verification calls, by the paths it serves them on.
const PASSPORT_TRAFFIC =
  /send_code|check_code|passport\/web\/region|passport\/web\/email|passport\/web\/user\/register|passport\/web\/register|verification\/age|captcha|verify/;
// The request headers TikTok signs its passport calls with.
const SIGNING_HEADERS = /tt-|ticket|passport|csrf|x-ms|x-bogus|signature/i;

/**
 * Log TikTok's passport traffic on the session's page: each request's
 * signing headers and body, each response's status, headers and body. The
 * flow reads every answer it needs from the call its own action sent; this
 * log is the record of the rest.
 */
export function installNetworkLogger(s) {
  s.page.on('request', (req) => {
    const url = req.url();
    if (!PASSPORT_TRAFFIC.test(url)) return;
    const headers = req.headers();
    const signing = Object.keys(headers).filter((k) => SIGNING_HEADERS.test(k));
    console.log(`[req] ${req.method()} ${url}`);
    console.log(
      signing.length
        ? `[req-tt-hdrs] ${signing.map((k) => `${k}=${headers[k]}`).join(' | ')}`
        : `[req-tt-hdrs] none; header keys: ${Object.keys(headers).join(',')}`,
    );
    const body = req.postData();
    if (body) console.log(`[req-body] ${body}`);
  });
  s.page.on('response', async (resp) => {
    const url = resp.url();
    if (!PASSPORT_TRAFFIC.test(url)) return;
    console.log(`[res] ${resp.status()} ${url}`);
    console.log(`[res-hdrs] ${JSON.stringify(resp.headers())}`);
    // A body the browser no longer holds (a redirect, a closed page) is
    // logged as such with its cause.
    const body = await resp.text().then(
      (text) => text.replace(/\s+/g, ' '),
      (error) => `unreadable: ${error.message}`,
    );
    console.log(`[res-body] ${body}`);
  });
}

const USERNAME_FIELD =
  'input[placeholder*="username" i], input[name*="username" i]';
const USERNAME_PAGE = '/signup/create-username';

/**
 * Username-creation step: type the identity's username, read back the value
 * TikTok kept (it may prefix, truncate or append digits), and submit through
 * the step's own button. Answers the username TikTok kept; the step is done
 * when TikTok leaves the create-username page.
 */
export async function runUsernameStep(s, id) {
  const field = s.page.locator(USERNAME_FIELD).first();
  if (!(await field.count()))
    throw new Error(
      `TIKTOK_USERNAME_FIELD_MISSING: ${s.page.url()} shows no username field`,
    );
  await field.focus();
  await pageSettled(s.page);
  await s.page.keyboard.press('ControlOrMeta+A');
  await s.page.keyboard.press('Delete');
  await humanType(s.page, id.username);
  await pageSettled(s.page);

  const kept = await field.inputValue();
  if (!kept)
    throw new Error(
      `TIKTOK_USERNAME_NOT_KEPT: the username field is empty after typing ${id.username}`,
    );
  console.log(
    `[test] username typed=${JSON.stringify(id.username)} kept=${JSON.stringify(kept)}`,
  );

  await clickDescribed(s.page, 'the button that submits the chosen username');
  await urlMatching(
    s.page,
    (url) => !new URL(url).pathname.includes(USERNAME_PAGE),
  );
  console.log(`[test] left create-username: ${s.page.url()}`);
  return kept;
}
