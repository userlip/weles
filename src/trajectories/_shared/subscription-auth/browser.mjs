import { pageCondition, pageSettled } from '../page/settled.mjs';
import {
  clickDescribed,
  clickOffered,
  pageShows,
} from '../page/judged/seen.mjs';
import { WSession } from '../../../../dist/session/wsession.js';
import { humanFill, humanType } from '../../../../dist/human/keyboard.js';
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import {
  doGoogleSso as codexGoogle,
  establishGoogleSession,
} from '../../codex/google_sso.mjs';
import { doGoogleSso as claudeGoogle } from '../../claude/google_sso.mjs';
import { enterGoogleCredentials } from '../../codex/google_sso/google_credentials.mjs';
import {
  clickGisTarget,
  observeGisPage,
} from '../../claude/google_sso/gis_state/page_reading.mjs';
import { AuthenticationFailure } from './oauth.mjs';
import { emailCodeSignIn, grantConsent } from './email_code.mjs';
import { captureRedirect } from './redirect.mjs';
import {
  GOOGLE_ACCOUNTS_HOST,
  onGoogleSignIn,
} from '../profile/google_session.mjs';

const controls = { humanFill, humanType, humanClickLocator };

// The authorization code the provider page shows (`<code>#<state>`), read on
// every animation frame until a field holds it, or a line of the page is it,
// whole.
async function displayedCode(page) {
  return pageCondition(page, () => {
    const code = /^[\w-]+#[\w-]+$/;
    for (const input of document.querySelectorAll('input,textarea')) {
      if (code.test(input.value.trim())) return input.value.trim();
    }
    const line = document.body.innerText
      .split('\n')
      .map((text) => text.trim())
      .find((text) => code.test(text));
    return line ? line : false;
  });
}

async function emailPassword(session, login) {
  const page = session.page;
  const email = page
    .locator('input[type="email"],input[autocomplete="username"]')
    .filter({ visible: true })
    .first();
  await humanFill(page, email, login.email);
  await session.press('Enter');
  const password = page
    .locator('input[type="password"]')
    .filter({ visible: true })
    .first();
  await password.waitFor({ state: 'visible' });
  await humanFill(page, password, login.password);
  await session.press('Enter');
}

// The provider hosts whose device or consent pages this walk answers.
const PROVIDER_HOSTS = new Set([
  'auth.openai.com',
  'chatgpt.com',
  'www.kimi.com',
  'kimi.com',
  'auth.kimi.com',
]);

/**
 * Walk the device approval across every page of the session until the
 * provider ends it: consent granted, a success page, or a refusal (including
 * an expired device code) that it states on the page. Each step is answered
 * once per page address; a step still shown at the same address after its
 * answer settled is refused, and so is a settled pass over all pages that
 * shows no step this walk answers.
 */
async function approveDevice(session, transaction, login, mark) {
  const context = session.page.context();
  let codeSubmitted = false;
  const answered = new Set();
  const answerOnce = (step, address) => {
    if (answered.has(`${step} ${address}`))
      throw new AuthenticationFailure(
        'step_repeated',
        step,
        `The ${step} step is still shown at ${address} after it was answered`,
      );
    answered.add(`${step} ${address}`);
  };
  for (;;) {
    await pageSettled(session.page);
    let acted = false;
    for (const page of context.pages()) {
      if (page.isClosed()) continue;
      const address = page.url();
      if (onGoogleSignIn(address)) {
        const emailField = page
          .locator('input[name="identifier"],input[type="email"]')
          .filter({ visible: true })
          .first();
        if (await emailField.isVisible()) {
          answerOnce('google_credentials', address);
          await enterGoogleCredentials({
            page,
            login,
            mark,
            humanFill,
            humanClickLocator,
            humanType,
          });
          acted = true;
        } else {
          const view = await observeGisPage(page, login.email);
          if (view?.host === GOOGLE_ACCOUNTS_HOST && view.accountRow) {
            answerOnce('google_account_chooser', address);
            const hit = await clickGisTarget(page, 'account_row');
            if (!hit.clicked) {
              throw new AuthenticationFailure(
                'gis_control_unavailable',
                'google_account_chooser',
                `The requested Google account row was not clicked: ${hit.reason}`,
              );
            }
            acted = true;
          }
        }
        continue;
      }
      if (!PROVIDER_HOSTS.has(new URL(address).hostname)) continue;
      const codeField = page
        .locator(
          'input[name="user_code"],input[name="usercode"],input[autocomplete="one-time-code"]',
        )
        .filter({ visible: true })
        .first();
      if (transaction.code && !codeSubmitted && (await codeField.isVisible())) {
        mark('device_code');
        await humanFill(page, codeField, transaction.code);
        codeSubmitted = true;
        await page.keyboard.press('Enter');
        await pageSettled(page);
        acted = true;
      }
      if (
        !answered.has(`google_dispatch ${page.url()}`) &&
        (await pageShows(page, 'Does the page offer to continue with Google?'))
      ) {
        answerOnce('google_dispatch', page.url());
        await clickDescribed(page, 'the button to continue with Google');
        acted = true;
        continue;
      }
      if (
        await clickOffered(
          page,
          'the button that approves this sign-in or continues with the current login',
        )
      ) {
        mark('provider_consent');
        return;
      }
      if (
        await pageShows(
          page,
          'Does the page say the authorization succeeded or that the window can be closed?',
        )
      )
        return;
      if (
        await pageShows(
          page,
          'Does the page say the sign-in was refused (an account locked, too many attempts, or a wrong or expired code)?',
        )
      ) {
        throw new AuthenticationFailure(
          'provider_challenge_refused',
          'provider_consent',
          'The provider refused authentication; the recorded DOM contains its response',
        );
      }
    }
    if (!acted)
      throw new AuthenticationFailure(
        'provider_state_unanswered',
        'provider_consent',
        `No page shows a step this walk answers: ${context
          .pages()
          .filter((page) => !page.isClosed())
          .map((page) => page.url())
          .join(', ')}`,
      );
  }
}

/** The session is owned by Weles on its selected host; no OS browser opener runs.
 *
 * `transaction.redirectUri`, when set, is a harness's own callback listener:
 * the provider's redirect to it is caught in the browser and its URL is the
 * answer instead of the code a console page shows. `reuse` is a session an
 * acquisition already signed in; it is driven and left open for its owner. */
export async function authorizeInBrowser(
  account,
  login,
  transaction,
  mark,
  reuse = null,
) {
  const session =
    reuse ??
    (await WSession.start({
      label: `subscription-${account.subscriptionId}`,
      browser: 'chromium',
      headless: false,
    }));
  try {
    mark('browser_started');
    if (transaction.provider === 'claude') {
      const redirected = transaction.redirectUri
        ? await captureRedirect(session.page.context(), transaction.redirectUri)
        : null;
      const signedIn =
        login.loginMethod === 'google_sso'
          ? claudeGoogle({
              page: session.page,
              login,
              authorizeUrl: transaction.url,
              mark,
              ...controls,
            })
          : (async () => {
              await session.goto(transaction.url);
              if (login.loginMethod === 'email_code') {
                if (!reuse)
                  await emailCodeSignIn(session, login, 'anthropic', mark);
                await grantConsent(session.page, mark);
              } else {
                await emailPassword(session, login);
              }
              return session.page;
            })();
      if (redirected) {
        // The redirect ends the walk whichever way the page got there. A
        // sign-in step that fails after the redirect was caught is moot, and
        // one that fails before it is the failure.
        const walked = signedIn.then(
          () => ({ failed: false }),
          (error) => ({ failed: true, error }),
        );
        const url = await Promise.race([
          redirected.captured,
          walked.then((walk) =>
            walk.failed ? Promise.reject(walk.error) : redirected.captured,
          ),
        ]);
        mark('oauth_redirect');
        return url;
      }
      const page = await signedIn;
      mark('oauth_callback');
      return await displayedCode(page);
    }
    if (
      transaction.provider === 'codex' &&
      login.loginMethod === 'google_sso'
    ) {
      await codexGoogle({
        page: session.page,
        login: { ...login, code: transaction.code },
        authorizeUrl: transaction.url,
        mark,
        ...controls,
      });
    } else {
      if (login.loginMethod === 'google_sso') {
        await establishGoogleSession({
          page: session.page,
          login,
          mark,
          humanFill,
          humanClickLocator,
          humanType,
        });
      }
      await session.goto(transaction.url);
      if (login.loginMethod === 'email_password')
        await emailPassword(session, login);
    }
    await approveDevice(session, transaction, login, mark);
    return null;
  } finally {
    if (!reuse) await session.close();
  }
}
