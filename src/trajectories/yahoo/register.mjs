import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { WSession } from '../../../dist/session/wsession.js';
import { humanFill, humanType } from '../../../dist/human/keyboard.js';
import {
  humanClickLocator,
  humanIdlePause,
} from '../../../dist/human/mouse.js';
import { pageSettled } from '../_shared/page/settled.mjs';
import { runRecordingsDir } from '../../../dist/session/run-recordings.js';

const LABEL = 'yahoo_register';
const SIGNUP_URL =
  'https://login.yahoo.com/account/create?specId=usernameregsimplified&done=https%3A%2F%2Ffinance.yahoo.com%2F';

function writeJson(name, value) {
  const dir = runRecordingsDir(LABEL);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), JSON.stringify(value, null, 2));
}

/** The identity's birth date, read from its own month name, day and year. A
 * date that does not parse is refused: a month guessed in its place would
 * register the account under a birth date nobody recorded. */
function birthDate(id) {
  const born = new Date(`${id.birthMonth} ${id.birthDay}, ${id.birthYear}`);
  if (Number.isNaN(born.getTime()))
    throw new Error(
      `birth_date_unreadable: ${id.birthMonth} ${id.birthDay} ${id.birthYear}`,
    );
  return born;
}

async function bodyText(page) {
  return await page
    .evaluate(() => document.body?.innerText || '')
    .catch(() => '');
}

async function fillFirst(page, selectors, value) {
  for (const selector of selectors) {
    const loc = page.locator(selector).filter({ visible: true }).first();
    if ((await loc.count()) && (await loc.isVisible())) {
      await humanClickLocator(page, loc);
      await humanFill(page, loc, '').catch(() => {});
      await humanType(page, value);
      return true;
    }
  }
  return false;
}

async function clickFirst(page, selectors, label) {
  for (const selector of selectors) {
    const loc = page.locator(selector).filter({ visible: true }).first();
    if ((await loc.count()) && (await loc.isVisible())) {
      await humanClickLocator(page, loc);
      return true;
    }
  }
  throw new Error(`${label}_not_found`);
}

async function checkbox(page) {
  const terms = page
    .locator(
      'input#checkTerms, input[name="checkTerms"], input[type="checkbox"]',
    )
    .filter({ visible: true })
    .first();
  if (await terms.count()) {
    const checked = await terms.isChecked().catch(() => false);
    if (!checked) await humanClickLocator(page, terms);
  }
}

async function submitNext(page) {
  await clickFirst(
    page,
    [
      'button[name="signup"]',
      'button[type="submit"]:has-text("Next")',
      'button:has-text("Next")',
      'button:has-text("Continue")',
      'button:has-text("Send code")',
      'button:has-text("Verify")',
    ],
    'next_button',
  );
}

async function fillSignupForm(s, id) {
  const page = s.page;
  const existingEmail = await page
    .locator('input#reg-email, input[name="email"]')
    .filter({ visible: true })
    .first()
    .count()
    .catch(() => 0);
  (await fillFirst(
    page,
    [
      'input#reg-firstName',
      'input[name="firstName"]',
      'input[autocomplete="given-name"]',
    ],
    id.firstName,
  )) ||
    (() => {
      throw new Error('first_name_input_not_found');
    })();
  (await fillFirst(
    page,
    [
      'input#reg-lastName',
      'input[name="lastName"]',
      'input[autocomplete="family-name"]',
    ],
    id.lastName,
  )) ||
    (() => {
      throw new Error('last_name_input_not_found');
    })();
  if (existingEmail) {
    (await fillFirst(
      page,
      ['input#reg-email', 'input[name="email"]'],
      id.email,
    )) ||
      (() => {
        throw new Error('email_input_not_found');
      })();
    (await fillFirst(
      page,
      [
        'input#reg-birthYear',
        'input[name="birthYear"]',
        'input[id*="birthYear" i]',
      ],
      String(id.birthYear),
    )) ||
      (() => {
        throw new Error('birth_year_input_not_found');
      })();
  } else {
    (await fillFirst(
      page,
      ['input#reg-userId', 'input[name="userId"]'],
      id.username,
    )) ||
      (() => {
        throw new Error('user_id_input_not_found');
      })();
    (await fillFirst(
      page,
      [
        'input#reg-password',
        'input[name="password"]',
        'input[type="password"]',
      ],
      id.password,
    )) ||
      (() => {
        throw new Error('password_input_not_found');
      })();
    (await fillFirst(
      page,
      ['input[name="mm"]', 'input[id$="-mm"]', 'input[placeholder*="Month" i]'],
      birthDate(id).toLocaleString('en', { month: '2-digit' }),
    )) ||
      (() => {
        throw new Error('birth_month_input_not_found');
      })();
    (await fillFirst(
      page,
      ['input[name="dd"]', 'input[id$="-dd"]', 'input[placeholder*="Day" i]'],
      birthDate(id).toLocaleString('en', { day: '2-digit' }),
    )) ||
      (() => {
        throw new Error('birth_day_input_not_found');
      })();
    (await fillFirst(
      page,
      [
        'input[name="yyyy"]',
        'input[id$="-yyyy"]',
        'input[placeholder*="Year" i]',
      ],
      String(id.birthYear),
    )) ||
      (() => {
        throw new Error('birth_year_input_not_found');
      })();
    await checkbox(page);
  }
  await submitNext(page);
  return existingEmail ? 'existing_email' : 'yahoo_address';
}

async function maybeHandlePhone(s) {
  const page = s.page;
  const phoneInput = page
    .locator('input[type="tel"], input[name*="phone" i], input[id*="phone" i]')
    .filter({ visible: true })
    .first();
  if (!(await phoneInput.count()) || !(await phoneInput.isVisible()))
    return false;

  // Yahoo's phone field keeps its United States country selector and takes
  // the national digits after +1 (stripped below), so only a US number fits;
  // a number from anywhere else would be typed in mangled.
  const phone = await s.checkSms('yahoo', 'US');
  if (phone.startsWith('error'))
    throw new Error(`yahoo_sms_unavailable: ${phone}`);
  const digits = s
    .resolveEnv('$YAHOO_NEW_PHONE')
    .replace(/^\+?1/, '')
    .replace(/\D/g, '');
  await humanClickLocator(page, phoneInput);
  await humanFill(page, phoneInput, '').catch(() => {});
  await humanType(page, digits);
  await submitNext(page);
  await humanIdlePause('long');
  return true;
}

/** Captcha frames by the vendor that serves them. */
const CAPTCHA_FRAME =
  /\/recaptcha\/|hcaptcha\.com|arkoselabs\.com|funcaptcha\.com/;

function captchaShown(page) {
  return page.frames().some((frame) => CAPTCHA_FRAME.test(frame.url()));
}

/**
 * The code Yahoo sent for this sign-up: to the e-mail address the form was
 * given when the sign-up registered an existing address, to the phone
 * otherwise. The form variant decides it, not words on the code page.
 */
async function maybeHandleCode(s, id, variant) {
  const page = s.page;
  const codeInput = page
    .locator(
      'input[name*="code" i], input[id*="code" i], input[autocomplete="one-time-code"], input[type="tel"][maxlength="6"], input[type="text"][maxlength="6"]',
    )
    .filter({ visible: true })
    .first();
  if (!(await codeInput.count()) || !(await codeInput.isVisible()))
    return false;
  let code;
  if (variant === 'existing_email') {
    code = await s.checkEmail(id.email, 'yahoo');
    if (!code || /^no (code|email)|^error/i.test(code))
      throw new Error(`yahoo_email_otp_failed: ${code}`);
  } else {
    code = await s.pollSmsCode();
    if (!code || /^no code|^error/i.test(code))
      throw new Error(`yahoo_sms_otp_failed: ${code}`);
  }
  await humanClickLocator(page, codeInput);
  await humanFill(page, codeInput, '').catch(() => {});
  await humanType(page, code);
  await submitNext(page);
  await humanIdlePause('long');
  return true;
}

async function maybeHandlePassword(page, password) {
  const passwordInput = page
    .locator(
      'input[name="password"], input[type="password"], input[id*="password" i]',
    )
    .filter({ visible: true })
    .first();
  if (!(await passwordInput.count()) || !(await passwordInput.isVisible()))
    return false;
  await humanClickLocator(page, passwordInput);
  await humanFill(page, passwordInput, '').catch(() => {});
  await humanType(page, password);
  const confirm = page
    .locator('input[name*="confirm" i], input[id*="confirm" i]')
    .filter({ visible: true })
    .first();
  if ((await confirm.count()) && (await confirm.isVisible())) {
    await humanClickLocator(page, confirm);
    await humanFill(page, confirm, '').catch(() => {});
    await humanType(page, password);
  }
  await submitNext(page);
  await humanIdlePause('long');
  return true;
}

async function maybeOpenPasswordSetup(page) {
  const change = page
    .locator(
      'a:has-text("Change password"), a:has-text("Create password"), button:has-text("Change password"), button:has-text("Create password")',
    )
    .filter({ visible: true })
    .first();
  if (!(await change.count()) || !(await change.isVisible())) return false;
  await humanClickLocator(page, change);
  await humanIdlePause('long');
  return true;
}

/** The cookies Yahoo sets on .yahoo.com for a signed-in account. */
const YAHOO_SESSION = { T: true, Y: true };

/**
 * Signed in is Yahoo's own session on the context, not words on whatever
 * page the flow ended on: a sign-up page that mentions "password" or a
 * finance page that says "Sign in" both misled the old reading.
 */
async function successState(s) {
  const held = (await s.ctx.cookies('https://login.yahoo.com'))
    .filter((cookie) => cookie.value !== '')
    .map((cookie) => cookie.name);
  return {
    ok: Object.keys(YAHOO_SESSION).every((name) => held.includes(name)),
    url: s.page.url(),
    cookies: held,
    sample: await bodyText(s.page),
  };
}

{
  const s = await WSession.start({
    label: LABEL,
    proxy: process.env.PROXY_URL || 'none',
    browser: 'chromium',
    platform: 'yahoo',
    headless: process.env.YAHOO_HEADLESS === '1',
  });
  try {
    const id = s.identity || (await s.generateIdentity('yahoo'));
    const accountEmail = id.email;
    console.log(`[yahoo] identity=${id.username} email=${accountEmail}`);

    await s.goto(SIGNUP_URL);
    await humanIdlePause('deliberate');
    const variant = await fillSignupForm(s, id);
    await humanIdlePause('long');

    // However many steps Yahoo shows are walked. A settled page that offers
    // none of the known steps and holds no Yahoo session is the failure,
    // named by its URL and text.
    for (;;) {
      await pageSettled(s.page);
      if (captchaShown(s.page)) {
        const solved = await s
          .solveCaptcha()
          .catch((e) => `captcha err: ${e.message}`);
        console.log(`[yahoo] captcha result=${solved}`);
        continue;
      }
      if (await maybeOpenPasswordSetup(s.page)) continue;
      if (await maybeHandlePhone(s)) continue;
      if (await maybeHandleCode(s, id, variant)) continue;
      if (await maybeHandlePassword(s.page, id.password)) continue;
      const state = await successState(s);
      if (state.ok) {
        await s.saveAccount('yahoo', {
          username: id.username,
          email: accountEmail,
          password: id.password,
          name: `${id.firstName} ${id.lastName}`,
          status: 'verified',
        });
        const payload = {
          ok: true,
          username: id.username,
          email: accountEmail,
          final_url: state.url,
          cookies: state.cookies,
          completed_at: new Date().toISOString(),
        };
        writeJson('yahoo_register_result.json', payload);
        writeJson('ban_signal.json', {
          action: LABEL,
          healthy: true,
          signal: 'healthy',
          details: { final_url: state.url },
          ts: new Date().toISOString(),
        });
        console.log(`PASS: yahoo ${accountEmail}`);
        await s.close();
        process.exit(0);
      }
      throw new Error(
        `yahoo_register_unrecognised_page final_url=${state.url} sample=${state.sample}`,
      );
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.log(`FAIL: ${message}`);
    writeJson('yahoo_register_result.json', {
      ok: false,
      error: message,
      completed_at: new Date().toISOString(),
    });
    writeJson('ban_signal.json', {
      action: LABEL,
      healthy: false,
      signal: 'register_failed',
      details: { error: message },
      ts: new Date().toISOString(),
    });
    await s.close();
    process.exit(1);
  }
}
