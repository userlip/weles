// Register a Yahoo account for the session's identity.
//
// The first form is filled (./register/steps.mjs), then every step Yahoo
// shows after it is walked: a captcha (found and solved by the session's own
// captcha solver; one it detects and does not solve fails the run),
// password setup, a phone, a code, a password. The account is registered
// once Yahoo's own session cookies are on the context; it is then saved to
// the accounts store. A settled page that offers none of these steps and
// holds no Yahoo session is the failure, named by its URL and text. The
// proxy is PROXY_URL ('direct' for none). The result is kept in
// yahoo_register_result.json and the verdict through the shared verdict
// writer; a failure is thrown.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { WSession } from '../../../dist/session/wsession.js';
import { runRecordingsDir } from '../../../dist/session/run-recordings.js';
import { pageSettled } from '../_shared/page/settled.mjs';
import { statedProxy } from '../_shared/inputs/stated.mjs';
import { keepVerdict } from '../_shared/action/verdict.mjs';
import {
  fillSignupForm,
  maybeHandleCode,
  maybeHandlePassword,
  maybeHandlePhone,
  maybeOpenPasswordSetup,
} from './register/steps.mjs';

const LABEL = 'yahoo_register';
const SIGNUP_URL =
  'https://login.yahoo.com/account/create?specId=usernameregsimplified&done=https%3A%2F%2Ffinance.yahoo.com%2F';
// The session solver's answers: none on the page, or one it solved.
const NO_CAPTCHA = 'no supported captcha detected';
const CAPTCHA_SOLVED = 'captcha solved';
// The cookies Yahoo sets for a signed-in account.
const YAHOO_SESSION = ['T', 'Y'];

function writeResult(value) {
  const dir = runRecordingsDir(LABEL);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'yahoo_register_result.json'), JSON.stringify(value, null, '  '));
}

/**
 * Signed in is Yahoo's own session on the context, not words on whatever
 * page the flow ended on.
 */
async function successState(s) {
  const held = (await s.ctx.cookies('https://login.yahoo.com'))
    .filter((cookie) => cookie.value)
    .map((cookie) => cookie.name);
  return {
    ok: YAHOO_SESSION.every((name) => held.includes(name)),
    url: s.page.url(),
    cookies: held,
  };
}

const s = await WSession.start({
  label: LABEL,
  proxy: statedProxy('the Yahoo signup'),
  browser: 'chromium',
  platform: 'yahoo',
  headless: process.env.YAHOO_HEADLESS === '1',
});
let verdict;
let failure;
try {
  const id = s.identity ? s.identity : await s.generateIdentity('yahoo');
  console.log(`[yahoo] identity=${id.username} email=${id.email}`);
  await s.goto(SIGNUP_URL);
  await pageSettled(s.page);
  const variant = await fillSignupForm(s.page, id);
  for (;;) {
    await pageSettled(s.page);
    const captcha = await s.solveCaptcha();
    if (captcha !== NO_CAPTCHA && captcha !== CAPTCHA_SOLVED)
      throw Object.assign(new Error(`YAHOO_CAPTCHA_UNPASSED: ${captcha}`), {
        banSignal: { signal: 'captcha_challenge', healthy: false, details: { final_url: s.page.url(), reason: captcha } },
      });
    if (captcha === CAPTCHA_SOLVED) continue;
    if (await maybeOpenPasswordSetup(s.page)) continue;
    if (await maybeHandlePhone(s)) continue;
    if (await maybeHandleCode(s, id, variant)) continue;
    if (await maybeHandlePassword(s.page, id.password)) continue;
    break;
  }
  const state = await successState(s);
  if (!state.ok)
    throw new Error(
      `yahoo_register_unrecognised_page: ${state.url} shows no signup step and holds no Yahoo session: ${await s.page.locator('body').innerText()}`,
    );
  await s.saveAccount('yahoo', {
    username: id.username,
    email: id.email,
    password: id.password,
    name: `${id.firstName} ${id.lastName}`,
    status: 'verified',
  });
  writeResult({
    ok: true,
    username: id.username,
    email: id.email,
    final_url: state.url,
    cookies: state.cookies,
    completed_at: new Date().toISOString(),
  });
  verdict = { signal: 'healthy', healthy: true, details: { final_url: state.url } };
  console.log(`PASS: yahoo ${id.email}`);
} catch (error) {
  failure = error;
  writeResult({ ok: false, error: error.message, completed_at: new Date().toISOString() });
  verdict = error.banSignal
    ? error.banSignal
    : { signal: 'register_failed', healthy: false, details: { final_url: s.page.url(), error: error.message } };
  console.log(`FAIL: ${error.message}`);
} finally {
  try {
    await keepVerdict(LABEL, null, verdict);
  } catch (keepError) {
    failure = failure
      ? new AggregateError([failure, keepError], `${failure.message}; and its verdict was not kept: ${keepError.message}`)
      : keepError;
  }
  await s.close();
}
if (failure) throw failure;
