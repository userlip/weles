// Recover a GitHub account locked out of its password: request GitHub's
// password reset, open the reset link from the mail GitHub sends (read from
// Skrzynka), set a new password, and store it in the account's Skarbiec
// item.
//
// The run does not wait for the mail. When it requests a reset, it records
// the moment in the account (reset_requested_at); a reset mail that arrived
// after that moment is used, by this run or the next one. A run that finds
// none yet says so and leaves the request in place, so running it again
// once the mail is in the inbox completes the reset without a second
// request. The proxy is the account's pinned one, or PROXY_URL ('direct' for
// none). Every outcome is kept as the run's verdict; a failure is thrown.
import { getSocialAccount } from '../../../../dist/utils/credentials.js';
import { resolveAccountSession } from '../../../../dist/account/session.js';
import { WSession } from '../../../../dist/session/wsession.js';
import { humanFill } from '../../../../dist/human/keyboard.js';
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { registrationPassword } from '../../../../dist/utils/identity/password.js';
import { detectGitHubBanSignals } from '../../../../dist/platforms/github/ban_signals.js';
import {
  findAccount,
  updateAccountMetadata,
  updateAccountPassword,
} from '../../_shared/skarbiec/accounts.mjs';
import { keepVerdict, verdictAfterFailure } from '../../_shared/action/verdict.mjs';
import { banSignalOf } from '../../_shared/auth/ban-signal.mjs';
import { statedProxy } from '../../_shared/inputs/stated.mjs';
import { pageSettled, submitAnswered } from '../../_shared/page/settled.mjs';
import { messagesTo } from '../../../_shared/mail/skrzynka-inbox.mjs';

const LABEL = 'github_reset_password';
const RESET_ROUTE = '/password_reset';
const RESET_LINK = /https:\/\/github\.com\/password_reset\/[\w-]+/;

const acct = await getSocialAccount('github');
if (!acct) throw new Error('GITHUB_ACCOUNT_UNAVAILABLE: no active GitHub account in Skarbiec');
const email = acct.metadata?.email;
if (!email) throw new Error(`GITHUB_EMAIL_UNAVAILABLE: GitHub account ${acct.username} has no email to reset through`);
const vaultAccount = findAccount('github', acct.username);
if (!vaultAccount)
  throw new Error(`GITHUB_ACCOUNT_UNRECORDED: ${acct.username} has no Skarbiec item to store the new password in`);
const accountSession = await resolveAccountSession(acct);
const pinned = accountSession.proxyUrl && !process.env.PROXY_URL?.trim();
const proxyUrl = pinned
  ? accountSession.proxyUrl
  : statedProxy('the GitHub password reset, whose account has no proxy pin,');

/** The reset link of a mail GitHub sent after `since`, if one has arrived. */
async function resetLinkSince(since) {
  if (!since) return undefined;
  const mails = await messagesTo(email, 'github.com');
  return mails
    .filter((m) => Date.parse(m.received_at) > Date.parse(since))
    .map((m) => m.body_text.match(RESET_LINK)?.shift())
    .find(Boolean);
}

const s = await WSession.start({ label: LABEL, proxy: proxyUrl, persona: accountSession.persona });
let banSignal;
let failure;
try {
  let resetUrl = await resetLinkSince(vaultAccount.metadata?.reset_requested_at);
  if (!resetUrl) {
    const requestedAt = new Date().toISOString();
    await s.goto(`https://github.com${RESET_ROUTE}`);
    await pageSettled(s.page);
    const field = s.page.locator('input#email_field, input[name="email"]').first();
    if (!(await field.count()))
      throw new Error(`GITHUB_RESET_FORM_MISSING: ${s.page.url()} shows no email field`);
    await humanFill(s.page, field, email);
    // The submit stays disabled until GitHub's own check of the form clears.
    const submit = s.page
      .locator('form[action*="password_reset"] input[type="submit"]:not([disabled]), form[action*="password_reset"] button[type="submit"]:not([disabled])')
      .first();
    await submit.waitFor({ state: 'visible' });
    await humanClickLocator(s.page, submit);
    await pageSettled(s.page);
    updateAccountMetadata(vaultAccount.id, { reset_requested_at: requestedAt });
    resetUrl = await resetLinkSince(requestedAt);
    if (!resetUrl)
      throw new Error(
        `GITHUB_RESET_MAIL_PENDING: the reset is requested for ${email} and its mail is not in the inbox yet; run the reset again once it is, and the run uses it`,
      );
  }
  const newPassword = registrationPassword();
  await s.goto(resetUrl);
  await pageSettled(s.page);
  const password = s.page.locator('input#password').first();
  const confirmation = s.page.locator('input#password_confirmation').first();
  if (!(await password.count()) || !(await confirmation.count()))
    throw new Error(
      `GITHUB_RESET_LINK_UNUSABLE: ${s.page.url()} shows no new-password form; the link may have expired`,
    );
  await humanFill(s.page, password, newPassword);
  await humanFill(s.page, confirmation, newPassword);
  await humanClickLocator(s.page, password.locator('xpath=ancestor::form[1]').locator('button[type="submit"], input[type="submit"]').first());
  const banner = s.page.locator('.flash-error, [role="alert"]').filter({ hasText: /\S/ }).first();
  await submitAnswered(s.page, (url) => new URL(url).pathname.startsWith(`${RESET_ROUTE}/`), banner);
  // Still on the reset form means GitHub did not take the password: storing
  // it would replace a working password in Skarbiec with one GitHub never set.
  if (new URL(s.page.url()).pathname.startsWith(`${RESET_ROUTE}/`))
    throw new Error(
      `GITHUB_PASSWORD_NOT_CHANGED: still on the reset form${(await banner.count()) ? `; GitHub said: ${(await banner.innerText()).trim()}` : ''}`,
    );
  updateAccountPassword(acct.id, newPassword, {
    password_recorded_at: new Date().toISOString(),
    reset_via: LABEL,
    reset_requested_at: null,
  });
  banSignal = await banSignalOf(detectGitHubBanSignals, s, 'after the reset');
  console.log(`PASS: password reset for ${acct.username}`);
} catch (error) {
  failure = error;
  banSignal = await verdictAfterFailure(s, { banDetector: detectGitHubBanSignals }, error, banSignal);
  console.log(`[ban-signal] ${banSignal.signal}  FAIL: ${error.message}`);
} finally {
  try {
    await keepVerdict(LABEL, acct, banSignal);
  } catch (keepError) {
    failure = failure
      ? new AggregateError([failure, keepError], `${failure.message}; and its verdict was not kept: ${keepError.message}`)
      : keepError;
  }
  await s.close();
}
if (failure) throw failure;
