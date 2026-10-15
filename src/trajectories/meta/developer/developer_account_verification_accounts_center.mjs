// Continue Meta developer account verification: send the stated phone (or the
// one the account lists in the stated country) and the stated SMS code when
// Meta asks for them, or open the Accounts Center link Meta requires for SMS
// confirmation. Does not accept legal terms or submit card details. Each
// step's page state is kept with the run (`_shared/diagnostics/page_state.mjs`);
// a step Meta asks for that the run cannot answer is thrown by name.

import { WSession } from '../../../../dist/session/wsession.js';
import {
  CODE_ONLY,
  OPEN_UPDATE_PHONE,
  PHONE_FROM_ACCOUNT_COUNTRY,
  STATED_PHONE,
  USER_DATA_DIR,
  VERIFY_CODE,
} from './developer_account_verification_accounts_center/settings.mjs';
import { verificationState } from './developer_account_verification_accounts_center/page.mjs';
import {
  clickAccountsCenter,
  loadAccountPhone,
} from './developer_account_verification_accounts_center/navigation.mjs';
import {
  RUN,
  clickUpdateMobileNumber,
  fillCodeAndContinue,
  fillPhoneAndSend,
} from './developer_account_verification_accounts_center/phone_steps.mjs';
import { statedProxy } from '../../_shared/inputs/stated.mjs';
import { stableProfilePersona } from '../../_shared/profile/persona.mjs';
import { bringBrowserToFront } from '../../_shared/action/window.mjs';
import { recordPageState } from '../../_shared/diagnostics/page_state.mjs';

const s = await WSession.start({
  label: RUN,
  proxy: statedProxy('the developer verification through Accounts Center'),
  persona: stableProfilePersona(USER_DATA_DIR),
  userDataDir: USER_DATA_DIR,
  headless: process.env.META_VERIFY_HEADLESS === '1',
  pageDiagnostics: process.env.WELES_PAGE_DIAGNOSTICS === '1',
});

/** Submit the stated code, refusing when Meta asks for it and none is stated. */
async function submitCode(step) {
  if (!VERIFY_CODE) {
    await bringBrowserToFront(s, RUN);
    throw new Error(
      'META_VERIFY_CODE_REQUIRED: Meta asks for the developer verification code and the run states none (META_VERIFY_CODE)',
    );
  }
  await fillCodeAndContinue(s.page);
  await recordPageState(s.page, RUN, step);
  await bringBrowserToFront(s, RUN);
}

try {
  await bringBrowserToFront(s, RUN);
  const phone = STATED_PHONE
    ? STATED_PHONE
    : PHONE_FROM_ACCOUNT_COUNTRY
      ? await loadAccountPhone(s.page, PHONE_FROM_ACCOUNT_COUNTRY)
      : null;
  await s.page.goto(
    'https://developers.facebook.com/async/developer/account/verification/',
    { waitUntil: 'domcontentloaded' },
  );
  await recordPageState(s.page, RUN, 'initial');
  const initial = await verificationState(s.page);
  if (initial.termsOnly)
    throw new Error(
      'Meta is on the terms/registration screen; explicit user acceptance is required before continuing',
    );

  if (OPEN_UPDATE_PHONE) {
    await clickUpdateMobileNumber(s.page);
    await recordPageState(s.page, RUN, 'after_update_mobile_number');
    if (phone && (await verificationState(s.page)).phoneStep) {
      await fillPhoneAndSend(s.page, phone);
      await recordPageState(s.page, RUN, 'after_updated_phone_submit');
    }
    await bringBrowserToFront(s, RUN);
  } else if (initial.smsCode || CODE_ONLY) {
    if (!initial.smsCode)
      throw new Error(
        'No developer verification code screen found for META_VERIFY_CODE_ONLY=1',
      );
    await submitCode('after_developer_code_submit');
  } else if (initial.phoneStep && !initial.accountsCenterRequired) {
    if (!phone)
      throw new Error(
        'META_VERIFY_PHONE_REQUIRED: Meta asks for a mobile number and the run states none (META_VERIFY_PHONE with META_VERIFY_PHONE_COUNTRY_CODE, or META_VERIFY_PHONE_FROM_ACCOUNT_COUNTRY)',
      );
    await fillPhoneAndSend(s.page, phone);
    await recordPageState(s.page, RUN, 'after_phone_submit');
    if ((await verificationState(s.page)).smsCode)
      await submitCode('after_developer_code_submit');
    else {
      await clickAccountsCenter(s.page);
      await recordPageState(s.page, RUN, 'after_accounts_center_click');
      await bringBrowserToFront(s, RUN);
    }
  } else {
    await clickAccountsCenter(s.page);
    await recordPageState(s.page, RUN, 'after_accounts_center_click');
    await bringBrowserToFront(s, RUN);
  }
} finally {
  await s.close();
}
