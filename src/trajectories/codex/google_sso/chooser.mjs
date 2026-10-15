// Google's account chooser in the Codex GIS handoff: on a Google chooser,
// identifier or OAuth page, the row of the requested account is picked, or
// the identifier is entered (once), or "use another account" is taken, or
// the page's primary control continues. Each page and control is acted on
// once; a chooser that offers rows but neither the requested account nor
// another-account control is refused.
import { enterGoogleCredentials } from './google_credentials.mjs';
import {
  clickGisTarget,
  observeGisPage,
} from '../../claude/google_sso/gis_state/page_reading.mjs';
import { GOOGLE_ACCOUNTS_HOST } from '../../_shared/profile/google_session.mjs';

// Google's pages that offer an account to sign in with.
const CHOOSER_PATHS = /accountchooser|oauthchooseaccount|identifier|\/signin\/oauth|\/o\/oauth2/;
const MARKS = {
  account_row: 'gis_account_chooser',
  other_account: 'gis_use_another_account',
  primary: 'gis_confirm_continue',
};

/** The control the chooser view offers for the requested account, if any. */
function offeredKind(view) {
  if (view.accountRow) return 'account_row';
  if (view.identifierField) return 'identifier';
  if (view.otherAccountRow) return 'other_account';
  if (view.rowCount) {
    const error = new Error(
      `gis_continue: requested Google account is not offered and no other-account control is available at ${view.host}${view.pathname}; visible account rows=${view.rowCount}`,
    );
    error.code = 'google_account_not_offered';
    throw error;
  }
  if (view.googlePrimary && !view.passwordField) return 'primary';
  return null;
}

export function googleChooser({ login, mark, humanFill, humanClickLocator, humanType, step }) {
  let identifierEntered = false;
  const acted = new WeakMap();

  /** Click the GIS control `kind`; a control the page does not offer throws. */
  async function clickTagged(active, kind) {
    const hit = await clickGisTarget(active, kind);
    if (hit.clicked) return;
    const current = new URL(active.url());
    const error = new Error(
      `gis_continue: ${kind} was not clicked at ${current.host}${current.pathname}: ${hit.reason}`,
    );
    error.code = 'gis_control_unavailable';
    throw error;
  }

  /** Act on the chooser `active` shows; answers whether it is a chooser page. */
  async function advance(active) {
    const view = await observeGisPage(active, login.email);
    if (!view || view.host !== GOOGLE_ACCOUNTS_HOST || !CHOOSER_PATHS.test(view.pathname))
      return false;
    const current = new URL(active.url());
    if (current.host !== view.host || current.pathname !== view.pathname) return true;
    const kind = offeredKind(view);
    if (!kind) return true;
    const key = `${active.url()}|${kind}`;
    if (acted.get(active) === key) return true;
    acted.set(active, key);
    if (kind === 'identifier') {
      if (identifierEntered) {
        const error = new Error(
          `gis_continue: Google offered identifier entry again at ${view.host}${view.pathname}`,
        );
        error.code = 'google_identifier_repeated';
        throw error;
      }
      identifierEntered = true;
      await enterGoogleCredentials({ page: active, login, mark, humanFill, humanClickLocator, humanType });
    } else {
      await clickTagged(active, kind);
      mark(MARKS[kind]);
    }
    step(`${kind}@${view.host}${view.pathname}`);
    return true;
  }

  return { clickTagged, advance };
}
