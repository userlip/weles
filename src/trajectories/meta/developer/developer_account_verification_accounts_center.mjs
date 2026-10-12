// Continue Meta developer account verification by opening the Accounts Center
// link required for SMS confirmation. Does not accept legal terms or submit
// phone/card details.

import { WSession } from '../../../../dist/session/wsession.js';
import {
  CODE_ONLY,
  OPEN_UPDATE_PHONE,
  USER_DATA_DIR,
  VERIFY_CODE,
  VERIFY_PHONE,
  VERIFY_PHONE_FROM_ACCOUNT_COUNTRY,
  setVerifyPhone,
} from './developer_account_verification_accounts_center/settings.mjs';
import {
  bringBrowserToFront,
  snapshot,
  stableProfilePersona,
  verificationState,
} from './developer_account_verification_accounts_center/page.mjs';
import {
  clickAccountsCenter,
  loadAccountPhone,
} from './developer_account_verification_accounts_center/navigation.mjs';
import {
  clickUpdateMobileNumber,
  fillCodeAndContinue,
  fillPhoneAndSend,
} from './developer_account_verification_accounts_center/phone_steps.mjs';

const s = await WSession.start({
  label: 'meta_developer_account_verification_accounts_center',
  browser: process.env.BROWSER || 'chromium',
  proxy: process.env.PROXY_URL || 'direct',
  persona: stableProfilePersona(),
  userDataDir: USER_DATA_DIR,
  headless: process.env.META_VERIFY_HEADLESS === '1',
  pageDiagnostics: process.env.WELES_PAGE_DIAGNOSTICS === '1',
});

let exitCode = 0;
try {
  let finishedDeveloperCode = false;
  await bringBrowserToFront(s);
  if (!VERIFY_PHONE && VERIFY_PHONE_FROM_ACCOUNT_COUNTRY) {
    setVerifyPhone(
      (await loadAccountPhone(s.page, VERIFY_PHONE_FROM_ACCOUNT_COUNTRY)) || '',
    );
  }
  await s.page.goto(
    'https://developers.facebook.com/async/developer/account/verification/',
    { waitUntil: 'domcontentloaded' },
  );
  await snapshot(s.page, 'initial');
  const initial = await verificationState(s.page);
  if (initial.termsOnly) {
    throw new Error(
      'Meta is on the terms/registration screen; explicit user acceptance is required before continuing',
    );
  }
  if (OPEN_UPDATE_PHONE) {
    await clickUpdateMobileNumber(s.page);
    await snapshot(s.page, 'after_update_mobile_number');
    if (VERIFY_PHONE && (await verificationState(s.page)).phoneStep) {
      const phoneResult = await fillPhoneAndSend(s.page);
      console.log(
        JSON.stringify(
          {
            stage: 'phone_submit_attempted',
            filled: phoneResult.filled,
            clicked: phoneResult.clicked,
          },
          null,
          2,
        ),
      );
      await snapshot(s.page, 'after_updated_phone_submit');
    }
    await bringBrowserToFront(s);
    finishedDeveloperCode = true;
  }
  if (!finishedDeveloperCode && (initial.smsCode || CODE_ONLY)) {
    if (!initial.smsCode)
      throw new Error(
        'No developer verification code screen found for META_VERIFY_CODE_ONLY=1',
      );
    if (!VERIFY_CODE) {
      console.log(
        'NEED_CODE: META_VERIFY_CODE is required to submit the developer verification code',
      );
      await bringBrowserToFront(s);
      throw new Error('Developer verification code required');
    }
    const codeResult = await fillCodeAndContinue(s.page);
    console.log(
      JSON.stringify(
        {
          stage: 'developer_code_submit_attempted',
          filled: codeResult.filled,
          clicked: codeResult.clicked,
        },
        null,
        2,
      ),
    );
    await snapshot(s.page, 'after_developer_code_submit');
    await bringBrowserToFront(s);
    finishedDeveloperCode = true;
  }
  if (
    !finishedDeveloperCode &&
    initial.phoneStep &&
    !initial.accountsCenterRequired
  ) {
    const phoneResult = await fillPhoneAndSend(s.page);
    console.log(
      JSON.stringify(
        {
          stage: 'phone_submit_attempted',
          filled: phoneResult.filled,
          clicked: phoneResult.clicked,
        },
        null,
        2,
      ),
    );
    await snapshot(s.page, 'after_phone_submit');
    if ((await verificationState(s.page)).smsCode) {
      if (!VERIFY_CODE) {
        console.log(
          'NEED_CODE: META_VERIFY_CODE is required to submit the developer verification code',
        );
        await bringBrowserToFront(s);
        throw new Error('Developer verification code required');
      }
      const codeResult = await fillCodeAndContinue(s.page);
      console.log(
        JSON.stringify(
          {
            stage: 'developer_code_submit_attempted',
            filled: codeResult.filled,
            clicked: codeResult.clicked,
          },
          null,
          2,
        ),
      );
      await snapshot(s.page, 'after_developer_code_submit');
      await bringBrowserToFront(s);
      finishedDeveloperCode = true;
    }
  }
  if (!finishedDeveloperCode) {
    await clickAccountsCenter(s.page);
    await snapshot(s.page, 'after_accounts_center_click');
    await bringBrowserToFront(s);
  }
} catch (error) {
  exitCode = 1;
  console.log(`FAIL: ${error.message || String(error)}`);
} finally {
  await s
    .close()
    .catch((e) => console.log(`[session] close failed: ${e.message}`));
}

if (exitCode) process.exit(exitCode);
