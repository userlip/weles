// The Microsoft account screens the password lifecycle walks besides the
// converged sign-in surfaces it shares with the Entra lifecycle
// (../entra_password_lifecycle/sign_in/surfaces.mjs): a passkey prompt left
// for the password or recovery route, the page's own configured addresses,
// and the email identity challenge whose code Microsoft mails to the
// account's address. Every step waits on the page; a read the page refuses
// raises with its cause.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runRecordingsDir } from '../../../../dist/session/run-recordings.js';
import { humanFill } from '../../../../dist/human/keyboard.js';
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { pageSettled } from '../../_shared/page/settled.mjs';
import { clickOffered, pageShows } from '../../_shared/page/judged/seen.mjs';
import {
  expectMail,
  fieldCodeLength,
} from '../../_shared/inputs/mailed_code.mjs';
import {
  answerStaySignedIn,
  IDENTITY_CHALLENGE,
  visible,
} from '../entra_password_lifecycle/sign_in/surfaces.mjs';
import { LOGIN_HOSTS } from './constants.mjs';

const CODE_INPUT =
  'input[autocomplete="one-time-code"], input[name*="otc" i], input[name*="code" i]';
// Microsoft's account-protection mail comes from a microsoft.com sender.
const MICROSOFT_SENDER = 'microsoft';

/** Wait for the field to be visible, then fill it through the humanized atoms. */
export async function fill(page, locator, value) {
  await locator.waitFor({ state: 'visible' });
  await humanFill(page, locator, value);
}

/** The address Microsoft's page configuration names under the first of `keys` it holds; null when it names none. */
export function configuredUrl(page, keys) {
  return page.evaluate((names) => {
    for (const source of [globalThis.$Config, globalThis.ServerData])
      for (const name of names) if (source?.[name]) return source[name];
    return null;
  }, keys);
}

/**
 * Leave a passkey prompt: Escape, then the resume address the page
 * configures (refused unless it stays on the login origin), else its Back
 * control.
 */
export async function leavePasskeyPrompt(page) {
  if (
    !(await pageShows(
      page,
      'Does the page ask to sign in with a passkey (face, fingerprint, PIN or security key)?',
    ))
  )
    return;
  await page.keyboard.press('Escape');
  await pageSettled(page);
  const resume = await configuredUrl(page, ['urlCancel', 'urlResume']);
  if (resume) {
    const target = new URL(resume, page.url());
    if (!LOGIN_HOSTS.includes(target.hostname))
      throw new Error(
        `Microsoft passkey resume URL ${target.origin} escaped the login origin`,
      );
    await page.goto(target.href, { waitUntil: 'domcontentloaded' });
    await pageSettled(page);
    return;
  }
  const back = page.locator('#idBtn_Back, button[aria-label="Back"]').first();
  if (await visible(back)) {
    await humanClickLocator(page, back);
    await pageSettled(page);
  }
}

/** Open the page's other ways to sign in when it offers them. */
export async function showOtherWays(page) {
  if (await clickOffered(page, 'the control that shows other ways to sign in'))
    await pageSettled(page);
}

/** Whether Microsoft asks the person to prove who they are, as the vision model reads the page in its language. */
export function hasIdentityChallenge(page) {
  return pageShows(page, IDENTITY_CHALLENGE);
}

/**
 * The page that shows the new-password form once the challenge is done, read
 * from every open page after the verification has settled; answers a "Stay
 * signed in?" prompt on the way. Null when no page shows the form.
 */
async function passwordFormPage(page) {
  await pageSettled(page);
  for (const candidate of page
    .context()
    .pages()
    .filter((open) => !open.isClosed())
    .reverse()) {
    const asked = await answerStaySignedIn(candidate);
    if (!asked.ok) throw new Error(`MICROSOFT_PAGE_UNJUDGED: ${asked.reason}`);
    // The new-password form is the page that shows a second password field.
    const [, second] = await candidate
      .locator('input[type="password"]')
      .filter({ visible: true })
      .all();
    if (second) return candidate;
  }
  return null;
}

/** What the page showed once the challenge ended, kept in the run's recordings. */
async function keepChallengeState(page, passwordReady) {
  writeFileSync(
    join(runRecordingsDir(), 'microsoft_identity_state.json'),
    JSON.stringify(
      {
        stage: 'email_challenge_complete',
        passwordReady,
        passwordCount: await page.locator('input[type="password"]').count(),
        pageCount: page.context().pages().length,
        url: page.url(),
        title: await page.title(),
        body: await page.locator('body').innerText(),
        inputs: await page.locator('input').evaluateAll((nodes) =>
          nodes.map((node) => ({
            type: node.getAttribute('type'),
            name: node.getAttribute('name'),
            id: node.id,
            ariaLabel: node.getAttribute('aria-label'),
            autocomplete: node.getAttribute('autocomplete'),
          })),
        ),
      },
      null,
      ' ',
    ),
  );
}

/**
 * Prove identity through the email code Microsoft sends to the account's
 * own address: choose the email option, confirm the address when asked,
 * enter the code from the mail that arrives after the request (read through
 * Skrzynka at the length the code field states), and answer the page that
 * then shows the password form. A page that offers no code to the address
 * answers null, so the caller turns to human approval; a code field that
 * does not show and a code Microsoft refuses fail naming the step.
 */
export async function completeEmailIdentityChallenge(page, email) {
  const emailOption = `the option to send a verification code to the email address ${email} (possibly shown partly masked)`;
  if (!(await pageShows(page, `Does the page show ${emailOption}?`)))
    await showOtherWays(page);
  if (!(await clickOffered(page, emailOption))) return null;
  const mail = await expectMail(email, MICROSOFT_SENDER);
  await clickOffered(page, 'the button that sends the verification code');
  await pageSettled(page);
  const addressField = page
    .locator(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"])',
    )
    .first();
  if (
    (await visible(addressField)) &&
    (await pageShows(
      page,
      'Does the page ask to type the full email address to confirm it before the code is sent?',
    ))
  ) {
    await fill(page, addressField, email);
    await addressField.press('Enter');
    await pageSettled(page);
  }
  const codeField = page.locator(CODE_INPUT).first();
  if (!(await visible(codeField)))
    throw new Error(
      `MICROSOFT_CODE_FIELD_MISSING: ${page.url()} shows no field for the mailed code`,
    );
  await fill(
    page,
    codeField,
    await mail.code(await fieldCodeLength(codeField)),
  );
  await codeField.press('Enter');
  const passwordPage = await passwordFormPage(page);
  await keepChallengeState(
    passwordPage ? passwordPage : page,
    Boolean(passwordPage),
  );
  if (
    !passwordPage &&
    (await pageShows(
      page,
      'Does the page say the verification code is wrong, invalid or expired?',
    ))
  )
    throw new Error(
      'MICROSOFT_CODE_REFUSED: Microsoft refused the mailed verification code',
    );
  return passwordPage;
}
