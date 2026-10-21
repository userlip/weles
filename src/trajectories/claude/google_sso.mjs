// Google-SSO sub-flow for the claude login trajectory.
//
// claude.ai's "Continue with Google" is a Google Identity Services (GIS)
// button, not a classic OAuth redirect. Clicking it with no Google session
// logs "Provider's accounts list is empty." and does nothing (no popup, no
// nav). So the run establishes a Google session on Google's own sign-in page
// FIRST, then loads claude.ai's authorize URL: GIS then has an account and the
// click completes.
//
// This file holds that handoff's state machine. Reading a page and clicking
// what that read tagged, naming the state a page is in, the waits on pending
// states, entering the Google credentials, and writing the DOM of a failed
// run are modules beside it.
import {
  enterGoogleCredentials,
  establishGoogleSession,
} from './google_sso/google_credentials.mjs';
import { observeGisPage } from './google_sso/gis_state/page_reading.mjs';
import {
  classifyGisState,
  gisVariantRank,
} from './google_sso/gis_state/variants.mjs';
import {
  dumpGisFailureDom,
  unhandledVariantError,
} from './google_sso/failure_dom.mjs';
import {
  awaitPendingVariant,
  clickOfferedControl,
  stateChange,
} from './google_sso/handoff_waits.mjs';
import { pageSettled } from '../_shared/page/settled.mjs';
import { clickDescribed } from '../_shared/page/judged/seen.mjs';
import { onGoogleSignIn } from '../_shared/profile/google_session.mjs';

export { readGisState } from './google_sso/gis_state/page_reading.mjs';
export {
  classifyGisState,
  gisVariantRank,
} from './google_sso/gis_state/variants.mjs';

// The GIS handoff is governed by what the pages report, never by a clock or a
// count of attempts: a fixed loop of attempts clicked the button again while
// Google's chooser was still sitting in a popup nobody was driving. A state
// is acted on once; until it changes the loop waits for the event that can
// change it (a navigation of the acting page, a new page, the page closing).
// A state this step does not drive, still shown once its page has settled, is
// reported by name with its DOM.
//
// When claude.ai answers the authorize URL with the app instead of the consent
// screen, the URL is re-driven once: once the Google half succeeds the session
// exists, and claude.ai consumed the CLI's authorize request and landed on
// /new; re-issuing it in the same session is what produces the consent screen
// and the callback page. The app answering the re-driven URL as well means the
// authorize request is spent, and that fails as itself.

// Variants this step drives; any other state that holds still is a failure.
const DRIVEN_VARIANTS = new Set([
  'code_page',
  'claude_gis_gate',
  'claude_gis_gate_pending',
  'google_rejected',
  'google_account_chooser',
  'google_chooser_without_account',
  'google_identifier',
  'google_confirm_continue',
  'oauth_consent',
  'oauth_consent_pending',
  'claude_app_authenticated',
  'claude_app_loading',
  'claude_captcha',
]);

// Every live page of the context, read and named, the page most advanced in
// the handoff first. Google closes its popup once the account is confirmed,
// and a read that started a moment before ends with 'Target page, context or
// browser has been closed': a page closed after its read failed is simply
// gone; any other failure stands. The caller's login is matched to Google's
// data-identifier, never a row position or label.
async function readViews(page, email) {
  const views = [];
  for (const p of page.context().pages()) {
    if (p.isClosed()) continue;
    let st;
    try {
      st = await observeGisPage(p, email);
    } catch (error) {
      if (p.isClosed()) continue;
      throw error;
    }
    views.push({ p, st, variant: classifyGisState(st) });
  }
  return views.sort(
    (a, b) => gisVariantRank(a.variant) - gisVariantRank(b.variant),
  );
}

export async function doGoogleSso({
  page,
  login,
  authorizeUrl,
  mark,
  humanFill,
  humanClickLocator,
  humanType,
}) {
  const entry = { login, mark, humanFill, humanClickLocator, humanType };
  await establishGoogleSession({ page, ...entry });

  // Session established. Now load claude.ai's OAuth: GIS sees the account.
  mark('goto_authorize');
  await page.goto(authorizeUrl, { waitUntil: 'commit' });
  await pageSettled(page);

  mark('gis_continue');
  // GIS can place account selection in a popup while the parent still shows
  // its sign-in gate. Every live page is inspected and the intended account
  // selected by data-identifier, not localized text; the popup stays
  // available to finish.
  const seen = new WeakSet();
  const onPopup = (p) => {
    if (!seen.has(p)) {
      seen.add(p);
      mark('gis_popup');
    }
  };
  page.context().on('page', onPopup);
  let freshEntryTried = false;
  const lastActions = new WeakMap();
  let views = [];
  let authorizeRedriven = false;
  let stuck = null;
  try {
    for (;;) {
      views = await readViews(page, login.email);
      const [view] = views;
      if (!view) {
        stuck = null;
        break;
      }
      const { p: active, st, variant } = view;

      if (variant === 'code_page') {
        mark('code_page');
        return active;
      }

      // A state this step does not drive: give its page the chance to settle
      // into a driven one, then report it by name. Google's popup is such a
      // page for the moment between the confirmed account and its closing: a
      // page that closed while it settled is gone, and the next round reads
      // the pages that remain.
      if (!DRIVEN_VARIANTS.has(variant)) {
        let again;
        try {
          await pageSettled(active);
          again = classifyGisState(await observeGisPage(active, login.email));
        } catch (error) {
          if (active.isClosed()) continue;
          throw error;
        }
        if (!DRIVEN_VARIANTS.has(again)) {
          stuck = view;
          break;
        }
        continue;
      }

      if (await awaitPendingVariant({ page, views, active, variant, mark }))
        continue;

      // Acting twice on a state that has not changed yet is what produced the
      // popup pile-up, so an identical (variant, url) is acted on once; until
      // it changes, the loop waits for the event that can change it.
      const actionKey = `${variant}|${st.url}`;
      if (actionKey === lastActions.get(active)) {
        await stateChange(page, active, st.url);
        continue;
      }
      const claim = () => {
        lastActions.set(active, actionKey);
      };

      if (variant === 'claude_gis_gate') {
        // The gate is only meaningful while no Google page is holding the
        // decision; otherwise clicking it opens yet another popup. A click
        // that just opened a popup shows up once the gate page has settled.
        await pageSettled(active);
        const google = page
          .context()
          .pages()
          .find((p) => !p.isClosed() && onGoogleSignIn(p.url()));
        if (google) {
          await stateChange(page, google, google.url());
          continue;
        }
        claim();
        mark('gis_click_continue');
        await clickOfferedControl(active, 'gis_button');
        continue;
      }

      if (variant === 'google_rejected') {
        const dump = await dumpGisFailureDom(views, variant);
        throw new Error(
          `gis_continue: Google refused this sign-in (variant 'google_rejected') at ${st.host}${st.pathname}; body="${st.bodyText}"; DOM snapshot: ${dump.where}`,
        );
      }

      if (variant === 'google_account_chooser') {
        claim();
        mark('gis_account_chooser');
        // Only the configured identity's exact data-identifier match is selected.
        console.log(
          `[google_sso] selecting account row by ${st.accountRowMatchedBy} (${st.rowIdentifiers.join(', ')})`,
        );
        await clickOfferedControl(active, 'account_row');
        continue;
      }

      if (variant === 'google_chooser_without_account') {
        // The signed-in session is not the account we need: take the
        // chooser's other row ("use another account"), which lands on the
        // identifier page handled below.
        if (!st.otherAccountRow) {
          await pageSettled(active);
          if (!(await observeGisPage(active, login.email)).otherAccountRow) {
            stuck = view;
            break;
          }
          continue;
        }
        claim();
        mark('gis_use_another_account');
        await clickOfferedControl(active, 'other_account');
        continue;
      }

      if (variant === 'google_identifier') {
        if (freshEntryTried) {
          stuck = view;
          break;
        }
        claim();
        freshEntryTried = true;
        await enterGoogleCredentials({ page: active, ...entry });
        continue;
      }

      if (variant === 'google_confirm_continue') {
        claim();
        mark('gis_confirm_continue');
        await clickOfferedControl(active, 'primary');
        continue;
      }

      if (variant === 'oauth_consent') {
        claim();
        mark('oauth_consent_click');
        // The grant screen offers Authorize and Decline; the vision model
        // finds the grant in whatever language the screen speaks. The SPA
        // then POSTs its authorize request and redirects to the platform
        // host: just another state this same loop observes.
        await clickDescribed(
          active,
          'the button that authorizes the requested access (not the one that declines it)',
        );
        continue;
      }

      if (variant === 'claude_app_authenticated') {
        // The Google half is done and the session is live; claude.ai simply
        // consumed the CLI's authorize request and showed the app. Re-issue
        // that exact URL in this session: with the session present it renders
        // the grant screen, handled as oauth_consent, and the callback page
        // the CLI expects arrives as code_page.
        if (authorizeRedriven) {
          const dump = await dumpGisFailureDom(
            views,
            'claude_authorize_consumed',
          );
          throw new Error(
            `gis_continue: claude_authorize_consumed — claude.ai answered the re-driven authorize URL with its app as well (now ${st.url} title="${st.title}"); the CLI's authorize request is spent, a new one is needed; DOM snapshot: ${dump.where}`,
          );
        }
        claim();
        authorizeRedriven = true;
        mark('gis_authorize_redrive');
        await active.goto(authorizeUrl, { waitUntil: 'commit' });
        await pageSettled(active);
        continue;
      }
    }
    throw await unhandledVariantError(stuck, views);
  } finally {
    page.context().off('page', onPopup);
  }
}
