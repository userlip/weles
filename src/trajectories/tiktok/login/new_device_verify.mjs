// TikTok's new-device verification: when a login comes from another address
// or browser than the account was made on, TikTok asks the owner to verify
// with a code mailed to the account's email. Whether the dialog is open, and
// each of its controls, is found by the vision model in whatever language the
// page renders; the code is read from the account's mailbox by the shared
// mailed-code reader, with the length TikTok's code field states.
import { humanType } from '../../../../dist/human/keyboard.js';
import { screenshotIfPossible } from '../../_shared/runner/evidence.mjs';
import { statedText } from '../../_shared/inputs/stated.mjs';
import {
  fieldCodeLength,
  mailedCode,
} from '../../_shared/inputs/mailed_code.mjs';
import {
  clickDescribed,
  clickOffered,
  pageShows,
} from '../../_shared/page/judged/seen.mjs';
import { pageSettled } from '../../_shared/page/settled.mjs';

/** Whether TikTok's new-device verification dialog is open on the page. */
export function verifyDialogPresent(page) {
  return pageShows(
    page,
    'Is a dialog open that asks the account owner to verify that it is really them before the login continues?',
  );
}

/** The mailbox TikTok mails the code to: the account's recorded email, else its username at the stated agent domain. */
function accountMailbox(acct) {
  if (acct.metadata.email) return acct.metadata.email;
  return `${acct.username}@${statedText(['AGENT_DOMAIN'], 'the agent mail domain of an account that records no email')}`;
}

/** Complete the new-device verification by the code TikTok mails to the account. */
export async function completeNewDeviceVerification(s, acct) {
  console.log(
    '[tiktok_login] new-device verification dialog open; verifying by email',
  );
  await screenshotIfPossible(s, 'verify_dialog');
  await clickDescribed(
    s.page,
    "the verification dialog's option that sends a code to the account's email",
  );
  if (await clickOffered(s.page, 'the button that sends the verification code'))
    await pageSettled(s.page);
  const codeInput = s.page
    .locator(
      'input[autocomplete="one-time-code"], input[name*="code" i], input[placeholder*="code" i]',
    )
    .filter({ visible: true })
    .first();
  await codeInput.waitFor({ state: 'visible' });
  const mailbox = accountMailbox(acct);
  console.log(
    `[tiktok_login] reading the verification code mailed to ${mailbox}`,
  );
  const code = await mailedCode(
    mailbox,
    'tiktok',
    await fieldCodeLength(codeInput),
  );
  await codeInput.focus();
  await humanType(s.page, code);
  await clickDescribed(s.page, 'the button that submits the verification code');
  await pageSettled(s.page);
  await screenshotIfPossible(s, 'verify_after_code_submit');
}
