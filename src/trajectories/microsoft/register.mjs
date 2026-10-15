// Microsoft account signup. Creates a new Outlook/Live account at
// signup.live.com so the cross_login flow can inject Microsoft cookies into
// linkedin for `Sign in with Microsoft` SSO.
//
// Flow: pick existing-email-or-new-outlook → fill email → password → name →
// country + DOB → captcha (Arkose enforced inline) → phone-OTP → land on
// account.microsoft.com.
//
// We always pick "Get a new email address" so the resulting handle matches
// the wisentmedia identity and we don't depend on an external email loop.

import { WSession } from '../../../dist/session/wsession.js';
import { humanType } from '../../../dist/human/keyboard.js';
import {
  humanClickLocator,
  humanIdlePause,
} from '../../../dist/human/mouse.js';
import { statedProxy } from '../_shared/inputs/stated.mjs';
import { phoneForField } from '../_shared/inputs/phone.mjs';

const URL = 'https://signup.live.com';
// Where a finished signup lands: the account, the OAuth hand-off, the mailbox
// or the signup's own welcome page.
const LANDINGS = [
  'account.microsoft.com',
  'login.live.com/oauth20',
  'outlook.live.com',
  'signup.live.com/welcome',
];
const landed = (url) => LANDINGS.some((route) => url.includes(route));

{
  const s = await WSession.start({
    label: 'microsoft_register',
    proxy: statedProxy('the Microsoft signup'),
  });
  try {
    const id = await s.generateIdentity('microsoft');
    console.log(`[ms] identity: ${id.username} <${id.username}@outlook.com>`);

    await s.goto(URL);
    await humanIdlePause('deliberate');

    // 1. The first step asks "Create account" — there's a prefix-suffix combo.
    // The default suffix is @outlook.com; we just type the local part.
    const memberIn = s.page
      .locator(
        'input[name="MemberName"], input[name="MemberNameHandle"], input#MemberName',
      )
      .first();
    await memberIn.waitFor({ state: 'visible' });
    await humanClickLocator(s.page, memberIn);
    await humanType(s.page, id.username);
    await humanClickLocator(
      s.page,
      s.page
        .locator('input[type="submit"], button[type="submit"]')
        .filter({ visible: true })
        .first(),
    );
    await humanIdlePause('deliberate');

    // 2. Password
    const pwIn = s.page
      .locator(
        'input[name="Password"], input[name="PasswordInput"], input[type="password"]',
      )
      .filter({ visible: true })
      .first();
    await pwIn.waitFor({ state: 'visible' });
    await humanClickLocator(s.page, pwIn);
    await humanType(s.page, id.password);
    await humanClickLocator(
      s.page,
      s.page
        .locator('input[type="submit"], button[type="submit"]')
        .filter({ visible: true })
        .first(),
    );
    await humanIdlePause('deliberate');

    // 3. Name (first / last)
    const firstIn = s.page
      .locator(
        'input[name="FirstName"], input#firstName, input[autocomplete="given-name"]',
      )
      .filter({ visible: true })
      .first();
    if (await firstIn.count()) {
      await humanClickLocator(s.page, firstIn);
      await humanType(s.page, id.firstName);
      const lastIn = s.page
        .locator(
          'input[name="LastName"], input#lastName, input[autocomplete="family-name"]',
        )
        .filter({ visible: true })
        .first();
      if (await lastIn.count()) {
        await humanClickLocator(s.page, lastIn);
        await humanType(s.page, id.lastName);
      }
      await humanClickLocator(
        s.page,
        s.page
          .locator('input[type="submit"], button[type="submit"]')
          .filter({ visible: true })
          .first(),
      );
      await humanIdlePause('deliberate');
    }

    // 4. DOB. The country select keeps the country Microsoft set for the
    // connection; the run names none of its own.
    const monthSel = s.page
      .locator('select#BirthMonth, select[name="BirthMonth"]')
      .first();
    if (await monthSel.count())
      await monthSel.selectOption(String(id.birthMonth));
    const daySel = s.page
      .locator('select#BirthDay, select[name="BirthDay"]')
      .first();
    if (await daySel.count()) await daySel.selectOption(String(id.birthDay));
    const yearIn = s.page
      .locator('input#BirthYear, input[name="BirthYear"]')
      .first();
    if (await yearIn.count()) {
      await humanClickLocator(s.page, yearIn);
      await humanType(s.page, String(id.birthYear));
    }
    await humanClickLocator(
      s.page,
      s.page
        .locator('input[type="submit"], button[type="submit"]')
        .filter({ visible: true })
        .first(),
    );
    await humanIdlePause('long');

    // 5. Arkose / "Press and Hold" captcha, through the session's solver; a
    // challenge it does not solve fails the signup with the solver's answer.
    const arkose = await s.page
      .locator(
        'iframe[src*="arkoselabs.com"], iframe[src*="enforcement.arkoselabs"], #enforcementFrame',
      )
      .first()
      .isVisible();
    if (arkose) {
      const solved = await s.solveCaptcha();
      if (solved !== 'captcha solved')
        throw new Error(`microsoft_arkose_unsolved: ${solved}`);
      await humanIdlePause('deliberate');
    }

    // 6. Phone verification, rented in the country the phone field is set to
    // (../_shared/inputs/phone.mjs).
    const phoneIn = s.page
      .locator(
        'input[name="phoneNumber"], input[type="tel"], input#phoneNumber',
      )
      .filter({ visible: true })
      .first();
    if (await phoneIn.count()) {
      const digits = await phoneForField(s, s.page, 'microsoft');
      await humanClickLocator(s.page, phoneIn);
      await humanType(s.page, digits);
      await humanClickLocator(
        s.page,
        s.page
          .locator('input[type="submit"], button[type="submit"]')
          .filter({ visible: true })
          .first(),
      );
      await humanIdlePause('deliberate');
      // The code Microsoft texted to the rented number goes into its code
      // field; a code field that does not show fails the signup.
      const smsCode = await s.pollSmsCode();
      if (!/^\d+$/.test(smsCode)) throw new Error(`microsoft_sms_otp_failed: ${smsCode}`);
      const codeIn = s.page
        .locator(
          'input[name="otc"], input[name="VerificationCode"], input[type="tel"][maxlength], input[autocomplete="one-time-code"]',
        )
        .filter({ visible: true })
        .first();
      await codeIn.waitFor({ state: 'visible' });
      await humanClickLocator(s.page, codeIn);
      await humanType(s.page, smsCode);
      await humanClickLocator(
        s.page,
        s.page.locator('input[type="submit"], button[type="submit"]').filter({ visible: true }).first(),
      );
      await humanIdlePause('long');
    }

    // 7. Land on one of LANDINGS; a "save your login" interstitial may stand
    // in front of it until the page settles.
    if (!landed(s.page.url())) {
      await humanIdlePause('deliberate');
      if (!landed(s.page.url()))
        throw new Error(`microsoft_register_no_landing: ${s.page.url()}`);
    }

    const email = `${id.username}@outlook.com`;
    await s.saveAccount('microsoft', {
      username: id.username,
      email,
      password: id.password,
      name: `${id.firstName} ${id.lastName}`,
      status: 'verified',
    });
    console.log(`PASS: microsoft ${email}`);
  } finally {
    await s.close();
  }
}
