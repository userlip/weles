// Google-SSO sub-flow for the OpenAI/Codex device-auth login trajectory.
//
// ROOT CAUSE: auth.openai.com's "Continue with Google" is a Google Identity
// Services (GIS) button. Clicking it with no Google session logs "Provider's
// accounts list is empty." and does nothing. So we establish a Google session
// at accounts.google.com FIRST, then reload the OpenAI device-auth URL — GIS
// then has an account and the handoff completes.
//
// This file holds that handoff. The controls it clicks, the Google credential
// entry it starts from, the authenticator code that entry answers 2FA with, the
// two mailbox steps OpenAI demands of a new identity, and the Codex consent page
// are modules beside it.
import { fillAndVerify } from '../_shared/page/confirmed-fill.mjs';
import { navEval } from '../_shared/page/navigation/read.mjs';
import { clickDescribed } from '../_shared/page/judged/seen.mjs';
import { establishGoogleSession } from './google_sso/google_credentials.mjs';
import {
  acceptPendingWorkspaceInvite,
  completeEmailVerification,
} from './google_sso/openai_mailbox.mjs';
import {
  handleCodexConsentPage,
  isTerminalHost,
} from './google_sso/openai_consent.mjs';
import { pageSettled, urlMatching } from '../_shared/page/settled.mjs';
import { gotoAuthorize } from './google_sso/navigation/authorize.mjs';
import { observeGisPage } from '../claude/google_sso/gis_state/page_reading.mjs';
import { googleChooser } from './google_sso/chooser.mjs';
import { GOOGLE_ACCOUNTS_HOST } from '../_shared/profile/google_session.mjs';

export { establishGoogleSession } from './google_sso/google_credentials.mjs';

export async function doGoogleSso({
  page,
  login,
  authorizeUrl,
  mark,
  humanFill,
  humanClickLocator,
  humanType,
}) {
  // WSession may reuse a provider profile. A pre-existing Google session can
  // make GIS silently authorize its default account even after we authenticated
  // the requested email in another tab. Start with no provider cookies so the
  // only Google identity available to the handoff is `login.email`.
  await page.context().clearCookies();
  mark('google_session_cleared');
  await establishGoogleSession({
    page,
    login,
    mark,
    humanFill,
    humanClickLocator,
    humanType,
  });

  mark('goto_authorize');
  await gotoAuthorize(page, authorizeUrl, mark);

  mark('gis_continue');
  // GIS handoff is non-deterministic (popup | in-page consent |
  // Loading | blank). Bounded state machine: poll for a terminal
  // marker; if none, reload authorizeUrl and retry.
  const popupPages = new Set();
  let inviteTried = false;
  const onPopup = (p) => {
    if (popupPages.has(p)) return;
    popupPages.add(p);
    p.on('popup', onPopup);
  };
  page.on('popup', onPopup);
  // Where the handoff actually went. The failure below used to carry only the
  // page it ended on, and an operator reading "no consent/code after 4
  // attempts" at auth.openai.com/log-in could not tell a Google button that
  // was never found from one that was clicked and did nothing, nor see the
  // pages walked in between. Hosts and paths only — no query strings, which
  // is where OAuth puts codes and tokens.
  const trail = [];
  let lastStep;
  const step = (label) => {
    if (label !== lastStep) trail.push(label);
    lastStep = label;
  };
  const chooser = googleChooser({ login, mark, humanFill, humanClickLocator, humanType, step });
  const clickTagged = chooser.clickTagged;
  const advanceGoogleChooser = chooser.advance;
  try {
    // Two ways in, in order: OpenAI's "Continue with Google" GIS button, then
    // naming the account in OpenAI's own email field. Each runs until the page
    // reaches a terminal state or stops offering anything new.
    for (const strategy of ['gis_button', 'email_first']) {
      // "Continue with Google" is a GIS button: when it has no usable session
      // in this context it silently does nothing, and reloading the authorize
      // URL repeats that. Naming the account in OpenAI's own email field makes
      // the handoff explicit, and the Google session established above then
      // completes it without a chooser.
      if (strategy === 'email_first') {
        const emailField = page
          .locator(
            'input[type="email"], input[name="username"], input[name="email"], input[autocomplete="username"]',
          )
          .filter({ visible: true })
          .first();
        if ((await emailField.count()) > 0 && (await emailField.isVisible())) {
          mark('openai_email_first');
          await fillAndVerify(
            page,
            emailField,
            login.email,
            humanClickLocator,
            humanType,
          );
          await emailField.press('Enter');
          await pageSettled(page);
        }
      }
      const gate = await observeGisPage(page, login.email);
      if (gate?.gisButton) {
        await clickTagged(page, 'gis_button');
        step(`${strategy}:clicked-continue-with-google`);
      } else {
        step(`${strategy}:continue-with-google-not-offered`);
      }
      let lastHref = null;
      for (;;) {
        let popupActed = false;
        for (const popupPage of popupPages) {
          if (popupPage.isClosed()) continue;
          try {
            await popupPage.waitForLoadState('domcontentloaded');
          } catch (error) {
            if (popupPage.isClosed()) continue;
            throw error;
          }
          if (await handleCodexConsentPage(popupPage, mark)) {
            mark('openai_callback');
            return popupPage;
          }
          const current = new URL(popupPage.url());
          if (isTerminalHost(current.host, current.href)) {
            mark('openai_callback');
            return popupPage;
          }
          if (await advanceGoogleChooser(popupPage)) popupActed = true;
        }
        // Google asks for consent on its own OAuth consent routes.
        const st = await navEval(
          page,
          (googleHost) => ({
            host: location.host,
            pathname: location.pathname,
            href: location.href,
            consent:
              location.hostname === googleHost &&
              ['/signin/oauth/consent', '/signin/oauth/id'].some((route) =>
                location.pathname.includes(route),
              ),
          }),
          { host: '', pathname: '', href: '', consent: false },
          GOOGLE_ACCOUNTS_HOST,
        );
        step(`${st.host}${st.pathname}`);
        if (
          login.code &&
          st.host === 'auth.openai.com' &&
          st.pathname.startsWith('/codex/device')
        ) {
          const codeField = page
            .locator(
              'input[name="user_code"],input[name="usercode"],input[autocomplete="one-time-code"]',
            )
            .filter({ visible: true })
            .first();
          if (await codeField.isVisible()) {
            mark('device_code_ready');
            return page;
          }
        }
        if (await handleCodexConsentPage(page, mark)) {
          mark('openai_callback');
          return page;
        }
        if (isTerminalHost(st.host, st.href)) {
          mark('openai_callback');
          return page;
        }
        // OpenAI issues Codex credentials only to an identity that already has a
        // ChatGPT account, and says otherwise by parking on personal signup:
        // /add-phone, an account-creation page, or a password page for a
        // password this account never had. An invited seat gets its account by
        // accepting the invitation, so accept it once and retry the authorize
        // URL instead of reloading a page that cannot proceed.
        if (
          !inviteTried &&
          st.host === 'auth.openai.com' &&
          /\/add-phone|\/create-account|\/log-in\/password/.test(st.pathname)
        ) {
          inviteTried = true;
          const landed = await acceptPendingWorkspaceInvite(page, login, mark);
          if (
            typeof landed === 'string' &&
            /email-verification|verify-email/i.test(landed)
          ) {
            await completeEmailVerification(page, login, mark);
          }
          await gotoAuthorize(page, authorizeUrl, mark);
          continue;
        }
        // An identifier field, an exact account row and an affirmative control
        // are different offers. Absence of a row is not a failed timed search.
        if (await advanceGoogleChooser(page)) {
          await pageSettled(page);
          continue;
        }
        if (st.consent) {
          mark('oauth_consent_click');
          await clickDescribed(
            page,
            'the enabled button on the Google consent screen that allows the sign-in and continues',
          );
          // Consent granted: Google redirects to auth.openai.com, which then
          // redirects to platform.openai.com/chatgpt.com. Wait for any OpenAI
          // terminal host; do NOT reload authorizeUrl (it would re-trigger the
          // consent flow). Single bounded wait.
          const landed = await urlMatching(page, (u) =>
            isTerminalHost(new URL(u).host, ''),
          );
          mark('openai_callback');
          console.log(`[google_sso] consent landed on ${landed}`);
          return page;
        }
        // A round in which no popup is open or moved and the page stayed on
        // the same address with nothing to act on ends this strategy.
        const popupOpen = [...popupPages].some(
          (popupPage) => !popupPage.isClosed(),
        );
        if (!popupActed && !popupOpen && st.href === lastHref) break;
        lastHref = st.href;
        await pageSettled(page); // allow-raw-playwright: terminal-state poll
      }
      const where = await navEval(page, () => location.href, '?');
      console.log(
        `[google_sso] no terminal state after ${strategy} at ${where}; reloading authorizeUrl`,
      );
      await gotoAuthorize(page, authorizeUrl, mark);
    }
    const d = await navEval(
      page,
      () => ({
        url: location.href,
        body: document.body.innerText.replace(/\s+/g, ' '),
      }),
      { url: '?', body: 'context destroyed' },
    );
    d.trail = trail;
    throw new Error(
      `gis_continue: no consent/code after the GIS button and email-first ways in diag=${JSON.stringify(d)}`,
    );
  } finally {
    page.off('popup', onPopup);
    for (const popupPage of popupPages) popupPage.off('popup', onPopup);
  }
}
