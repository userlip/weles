import {
  existsSync,
  readFileSync,
  statSync,
  unlinkSync,
  watch,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { runRecordingsDir } from '../../../../dist/session/run-recordings.js';
import { humanFill } from '../../../../dist/human/keyboard.js';
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { pageSettled } from '../../_shared/page/settled.mjs';
import { clickOffered, pageShows } from '../../_shared/page/judged/seen.mjs';
import {
  CODE_FILE_MODE,
  CODE_FILE_MODE_MASK,
  LOGIN_HOSTS,
  SECOND_PASSWORD_INPUT,
} from './constants.mjs';

const CODE_INPUT =
  'input[type="tel"], input[type="number"], input[inputmode="numeric"], input[name*="otc" i], input[name*="code" i], input[type="text"]';

/** Whether the locator resolves to at least one visible element. */
export async function visible(locator) {
  const count = await locator.count().catch(() => false);
  return (
    count > 0 &&
    locator
      .first()
      .isVisible()
      .catch(() => false)
  );
}

/** The page's text, or '' with a log line when the page refused to give it. */
export async function bodyText(page) {
  try {
    return await page.locator('body').innerText();
  } catch (error) {
    console.log(
      `[microsoft] page text unreadable: ${String(error?.message ?? error)}`,
    );
    return '';
  }
}

/** A key press the page refuses is logged; the step decides what it means. */
export async function press(page, key) {
  try {
    await page.keyboard.press(key);
  } catch (error) {
    console.log(
      `[microsoft] key ${key} not delivered: ${String(error?.message ?? error)}`,
    );
  }
}

/** A value from the page's own config object; false when the page has none. */
export function pageConfig(page, read) {
  return page.evaluate(read).catch(() => false);
}

/** Wait for the field to be visible, then fill it through the humanized atoms. */
export async function fill(page, locator, value) {
  await locator.waitFor({ state: 'visible' });
  await humanFill(page, locator, value);
}

/** Leave a passkey prompt for the password sign-in, on the login origin only. */
export async function choosePasswordSignIn(page, selectPassword = true) {
  if (
    await pageShows(
      page,
      'Does the page ask to sign in with a passkey (face, fingerprint, PIN or security key)?',
    )
  ) {
    await press(page, 'Escape');
    await pageSettled(page);
    const resume = await pageConfig(
      page,
      () =>
        globalThis.$Config?.urlCancel ?? globalThis.$Config?.urlResume ?? '',
    );
    if (resume) {
      const target = new URL(resume, page.url());
      if (!LOGIN_HOSTS.includes(target.hostname)) {
        throw new Error(
          'Microsoft passkey resume URL escaped the login origin',
        );
      }
      await page.goto(target.href, { waitUntil: 'domcontentloaded' });
      await pageSettled(page);
    } else {
      const back = page
        .locator('#idBtn_Back, button[aria-label="Back"]')
        .first();
      if (await visible(back)) {
        await humanClickLocator(page, back);
        await pageSettled(page);
      }
    }
  }
  if (await clickOffered(page, 'the control that shows other ways to sign in'))
    await pageSettled(page);
  if (
    selectPassword &&
    (await clickOffered(page, 'the option to sign in with a password'))
  )
    await pageSettled(page);
}

// Whether Microsoft asks the person to prove who they are (a code, an
// approval, a passkey), as the vision model reads the page in its language.
export function hasIdentityChallenge(page) {
  return pageShows(
    page,
    'Does the page ask to verify identity with a code, an approval on another device, a passkey or a security key?',
  );
}

/**
 * The verification code the operator drops into the named file: owner-only,
 * small, digits only, consumed once. False when no file is configured. The
 * file's appearance is awaited as a filesystem event, not on a clock.
 */
async function waitForVerificationCode() {
  const codeFile = process.env.MICROSOFT_VERIFICATION_CODE_FILE?.trim() ?? '';
  if (!codeFile) return false;
  if (
    !isAbsolute(codeFile) ||
    basename(codeFile) !== 'microsoft-verification-code'
  ) {
    throw new Error('invalid Microsoft verification-code file path');
  }
  if (!existsSync(codeFile)) {
    console.log(
      `[microsoft] waiting for the operator to write the verification code to ${codeFile}`,
    );
    const { promise, resolve, reject } = Promise.withResolvers();
    const watcher = watch(dirname(codeFile), (event, name) => {
      if (name === basename(codeFile) && existsSync(codeFile)) resolve();
    });
    watcher.once('error', reject);
    try {
      if (!existsSync(codeFile)) await promise;
    } finally {
      watcher.close();
    }
  }
  const metadata = statSync(codeFile);
  if (
    !metadata.isFile() ||
    metadata.uid !== process.getuid() ||
    (metadata.mode & CODE_FILE_MODE_MASK) !== CODE_FILE_MODE
  ) {
    throw new Error(
      'Microsoft verification-code file failed owner or mode validation',
    );
  }
  const code = readFileSync(codeFile, 'utf8').trim();
  if (!/^\d{4,8}$/.test(code)) {
    throw new Error(
      'Microsoft verification-code file contains an invalid code',
    );
  }
  unlinkSync(codeFile);
  return code;
}

/**
 * The page that shows the new-password form once the challenge is done, read
 * from every open page after the verification has settled; answers a "Stay
 * signed in?" prompt on the way.
 */
async function findPasswordPage(page) {
  await pageSettled(page);
  let statePage = page;
  const pages = page
    .context()
    .pages()
    .filter((candidate) => !candidate.isClosed())
    .reverse();
  for (const candidate of pages) {
    if (/account\.live\.com\/password\/Change/i.test(candidate.url()))
      statePage = candidate;
    if (
      await pageShows(candidate, 'Does the page ask whether to stay signed in?')
    ) {
      await clickOffered(
        candidate,
        'the button that declines staying signed in',
      );
      await pageSettled(candidate);
    }
    if (
      await visible(
        candidate.locator('input[type="password"]').nth(SECOND_PASSWORD_INPUT),
      )
    ) {
      return { passwordPage: candidate, statePage: candidate };
    }
  }
  return { passwordPage: false, statePage };
}

/**
 * Prove identity through the email code Microsoft sends: choose the email
 * option, confirm the address when asked, enter the code the operator
 * supplied, and return the page that then shows the password form (or false
 * when the challenge could not be completed).
 */
export async function completeEmailIdentityChallenge(page, email) {
  const emailOption = `the option to send a verification code to the email address ${email} (possibly shown partly masked)`;
  if (
    !(await pageShows(page, `Does the page show ${emailOption}?`)) &&
    (await clickOffered(
      page,
      'the control that shows other ways to verify identity',
    ))
  )
    await pageSettled(page);
  if (!(await clickOffered(page, emailOption))) return false;
  await clickOffered(page, 'the button that sends the verification code');
  await pageSettled(page);

  let visibleInput = page
    .locator(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"])',
    )
    .first();
  if (
    (await visible(visibleInput)) &&
    (await pageShows(
      page,
      'Does the page ask to type the full email address to confirm it before the code is sent?',
    ))
  ) {
    await fill(page, visibleInput, email);
    await visibleInput.press('Enter');
    await pageSettled(page);
  }

  visibleInput = page.locator(CODE_INPUT).first();
  if (!(await visible(visibleInput))) return false;
  const code = await waitForVerificationCode();
  if (!code) return false;
  visibleInput = page.locator(CODE_INPUT).first();
  await fill(page, visibleInput, code);
  await visibleInput.press('Enter');
  const { passwordPage, statePage } = await findPasswordPage(page);
  const passwordReady = Boolean(passwordPage);
  const resultBody = await bodyText(statePage);
  if (
    !passwordReady &&
    (await pageShows(
      statePage,
      'Does the page say the verification code is wrong, invalid or expired?',
    ))
  ) {
    throw new Error('Microsoft email verification code was rejected');
  }
  writeFileSync(
    join(runRecordingsDir(), 'microsoft_identity_state.json'),
    JSON.stringify(
      {
        stage: 'email_challenge_complete',
        passwordReady,
        passwordCount: await statePage
          .locator('input[type="password"]')
          .count(),
        pageCount: page.context().pages().length,
        url: statePage.url(),
        title: await statePage
          .title()
          .catch((error) => `unreadable: ${error.message}`),
        body: resultBody,
        inputs: await statePage
          .locator('input')
          .evaluateAll((nodes) =>
            nodes.map((node) => ({
              type: node.getAttribute('type'),
              name: node.getAttribute('name'),
              id: node.id,
              ariaLabel: node.getAttribute('aria-label'),
              autocomplete: node.getAttribute('autocomplete'),
              outerHTML: node.outerHTML,
            })),
          )
          .catch((error) => [{ unreadable: error.message }]),
      },
      null,
      2,
    ),
  );
  return passwordPage;
}
