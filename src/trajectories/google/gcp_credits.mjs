// Capture a Google Cloud billing account's Credits page in a Weles browser
// session.
//
// Run: node src/trajectories/google/gcp_credits.mjs <BILLING_ACCOUNT_ID>
//
// Env:
//   GCP_LOGIN_SERVICE   required: the Weles scoped Google login (for example
//                       googleSso or googleWorkspaceAdmin) whose account
//                       administers the billing account
//   GCP_CREDITS_TAB     required: 'issued' captures the Issued credits tab,
//                       'first' the tab the page opens on
//   PROXY_URL           required: the proxy the browser goes through, or 'direct'
//
// The browser signs in through Google's own steps (the shared Google sign-in,
// driven in process), and the capture is the credits page of that session,
// kept in the run's recordings. A page that is not the requested account's
// credits page, or an Issued credits tab that does not show selected,
// refuses the capture.
import { join } from 'node:path';
import { WSession } from '../../../dist/session/wsession.js';
import { runRecordingsDir } from '../../../dist/session/run-recordings.js';
import { readScopedLogin } from '../../_shared/scoped-secrets.mjs';
import {
  statedChoice,
  statedProxy,
  statedText,
} from '../_shared/inputs/stated.mjs';
import { signInThroughKeeper } from '../_shared/keeper/google_sign_in.mjs';
import { sessionAct } from '../_shared/keeper/session_act.mjs';
import { clickDescribed, pageShows } from '../_shared/page/judged/seen.mjs';
import { pageSettled } from '../_shared/page/settled.mjs';

const LABEL = 'gcp_credits';
// Whose credits are read is the caller's: a billing account written here
// would read another account's credits.
const [, , ACCOUNT] = process.argv;
if (!ACCOUNT)
  throw new Error(
    'no billing account given: run with <BILLING_ACCOUNT_ID>; nothing was opened',
  );
const TAB = statedChoice(
  ['GCP_CREDITS_TAB'],
  Object.freeze({
    issued: 'the Issued credits tab',
    first: 'the tab the credits page opens on',
  }),
  'the credits tab captured',
);
const login = readScopedLogin(
  statedText(
    ['GCP_LOGIN_SERVICE'],
    'the Weles scoped Google login whose account administers the billing account',
  ),
);
const CREDITS_URL = new URL(
  `https://console.cloud.google.com/billing/${encodeURIComponent(ACCOUNT)}/credits`,
);
const OUT_PNG = join(runRecordingsDir(LABEL), 'gcp_credits.png');

/** Whether the page is the requested account's credits page. */
function onCreditsPage(address) {
  const url = new URL(address);
  return (
    url.hostname === CREDITS_URL.hostname &&
    url.pathname.startsWith(CREDITS_URL.pathname)
  );
}

const s = await WSession.start({
  label: LABEL,
  browser: 'chromium',
  proxy: statedProxy('the Google Cloud credits read'),
});
try {
  const act = sessionAct(s, LABEL);
  await act({ action: 'nav', url: CREDITS_URL.href });
  await act({ action: 'settle' });
  const steps = await signInThroughKeeper(act, login);
  await pageSettled(s.page);
  if (!onCreditsPage(s.page.url()))
    throw new Error(
      `GCP_CREDITS_UNREACHED: the session is at ${s.page.url()}, not ${CREDITS_URL.href}; Google steps: ${JSON.stringify(steps)}`,
    );
  if (TAB === 'issued') {
    await clickDescribed(s.page, 'the Issued credits tab');
    if (
      !(await pageShows(s.page, 'Is the Issued credits tab the selected tab?'))
    )
      throw new Error(
        `GCP_CREDITS_TAB: the Issued credits tab does not show selected at ${s.page.url()}; no capture was taken`,
      );
  }
  await s.page.screenshot({ path: OUT_PNG, fullPage: true });
  console.log(
    `[gcp_credits] ${TAB} credits of ${ACCOUNT} captured to ${OUT_PNG}`,
  );
} finally {
  await s.close();
}
