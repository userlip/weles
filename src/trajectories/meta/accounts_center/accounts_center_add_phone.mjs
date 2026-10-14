// Add a phone contact in Accounts Center for Meta developer verification.
// Requires META_VERIFY_PHONE. If META_VERIFY_CODE is provided, submits the SMS code too.
// Phone and code values are not printed.

import { WSession } from '../../../../dist/session/wsession.js';
import {
  CODE_ONLY,
  USER_DATA_DIR,
  VERIFY_CODE,
} from './accounts_center_add_phone/settings.mjs';
import {
  asksForCode,
  bringBrowserToFront,
  offersPhoneForm,
  snapshot,
  stableProfilePersona,
} from './accounts_center_add_phone/page.mjs';
import {
  clickControl,
  clickWhenShown,
  fillCode,
  fillPhone,
  SUBMIT_FORM,
  selectPhoneAssociationAccount,
} from './accounts_center_add_phone/steps.mjs';
import { statedProxy } from '../../_shared/inputs/stated.mjs';

const PASSKEY_OFFERED =
  'Does the page offer to create a passkey, with a way to decline it for now?';
const DECLINE_PASSKEY =
  'the button that declines creating a passkey for now (not the one that creates it)';

const s = await WSession.start({
  label: 'meta_accounts_center_add_phone',
  browser: process.env.BROWSER || 'chromium',
  proxy: statedProxy('the Accounts Center phone step'),
  persona: stableProfilePersona(),
  userDataDir: USER_DATA_DIR,
  headless: process.env.META_VERIFY_HEADLESS === '1',
  pageDiagnostics: process.env.WELES_PAGE_DIAGNOSTICS === '1',
});

let exitCode = 0;
try {
  await bringBrowserToFront(s);
  await s.page.goto(
    'https://accountscenter.facebook.com/youraccount/contact_points/',
    {
      waitUntil: 'domcontentloaded',
    },
  );
  await snapshot(s.page, 'contact_points_initial');
  if (CODE_ONLY) {
    if (!VERIFY_CODE)
      throw new Error(
        'META_VERIFY_CODE is required when META_VERIFY_CODE_ONLY=1',
      );
    if (!(await asksForCode(s.page))) {
      await clickControl(
        s.page,
        'open_pending_contact',
        'the phone number contact that is waiting for confirmation',
      );
    }
    await snapshot(s.page, 'code_only_screen');
    if (!(await asksForCode(s.page))) {
      await clickControl(
        s.page,
        'confirm_pending_contact',
        'the button that confirms the pending phone number',
      );
      await snapshot(s.page, 'code_only_confirm_screen');
    }
    if (!(await asksForCode(s.page)) && (await offersPhoneForm(s.page))) {
      await fillPhone(s.page);
      await selectPhoneAssociationAccount(s.page);
      await snapshot(s.page, 'code_only_phone_form_ready');
      await clickControl(s.page, 'submit_code_only_phone_form', SUBMIT_FORM);
      await snapshot(s.page, 'code_only_after_phone_submit');
    }
    if (!(await asksForCode(s.page)))
      throw new Error(
        'No confirmation code screen found for META_VERIFY_CODE_ONLY=1',
      );
    if (!(await fillCode(s.page)))
      throw new Error('No confirmation code input found');
    await snapshot(s.page, 'code_only_filled');
    await clickControl(s.page, 'submit_code_only', SUBMIT_FORM);
    await snapshot(s.page, 'after_code_only_submit');
    await clickWhenShown(
      s.page,
      'skip_passkey',
      PASSKEY_OFFERED,
      DECLINE_PASSKEY,
    );
    await snapshot(s.page, 'after_code_only_passkey_skip');
    await bringBrowserToFront(s);
  } else {
    await clickControl(
      s.page,
      'add_new_contact',
      'the control that adds a new contact point',
    );
    await snapshot(s.page, 'after_add_new_contact');
    await clickControl(
      s.page,
      'choose_phone',
      'the option that adds a mobile phone number as the new contact',
    );
    await snapshot(s.page, 'phone_form');
    if (!(await fillPhone(s.page))) throw new Error('No phone input found');
    await snapshot(s.page, 'phone_filled');
    await selectPhoneAssociationAccount(s.page);
    await snapshot(s.page, 'after_select_account');
    await clickControl(s.page, 'submit_phone', SUBMIT_FORM);
    await snapshot(s.page, 'after_submit');
    if (await asksForCode(s.page)) {
      if (!VERIFY_CODE) {
        console.log(
          'NEED_CODE: META_VERIFY_CODE is required to submit the confirmation code',
        );
      } else if (await fillCode(s.page)) {
        await snapshot(s.page, 'code_filled');
        await clickControl(s.page, 'submit_code', SUBMIT_FORM);
        await snapshot(s.page, 'after_code_submit');
        await clickWhenShown(
          s.page,
          'skip_passkey',
          PASSKEY_OFFERED,
          DECLINE_PASSKEY,
        );
        await snapshot(s.page, 'after_passkey_skip');
      } else {
        throw new Error('No confirmation code input found');
      }
    } else {
      await bringBrowserToFront(s);
    }
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
