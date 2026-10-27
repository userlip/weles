// A signed-in Vast session in the stated team's context, shared by every Vast
// run. Whether the browser is signed in is Vast's own answer: its current-user
// endpoint answers only a signed-in session. A browser it refuses signs in
// through Vast's Google control with the Weles Vast dashboard login from
// Skarbiec (the shared Google SSO steps drive the popup), and the session's
// cookies are kept in the SessionStore under the run's label. The session is
// then switched into the team VAST_TEAM_NAME names (./team_context.mjs).
import { WSession } from '../../../dist/session/wsession.js';
import { SessionStore } from '../../../dist/session/store.js';
import { readScopedLogin } from '../../_shared/scoped-secrets.mjs';
import { googleSso } from '../_shared/services/google_sso.mjs';
import { clickDescribed } from '../_shared/page/judged/seen.mjs';
import { pageSettled } from '../_shared/page/settled.mjs';
import { switchToTeam, vastTeamName } from './team_context.mjs';

const ORIGIN = 'https://cloud.vast.ai';
const CURRENT_USER = `${ORIGIN}/api/v0/users/current/`;

const signedIn = async (ws) => (await ws.ctx.request.get(CURRENT_USER)).ok();

/** A signed-in Vast session labelled `label`, in the stated team's context; the caller closes it. */
export async function openVast(label) {
  const team = vastTeamName();
  const ws = await WSession.start({ label, headless: false });
  const store = new SessionStore();
  await ws.goto(`${ORIGIN}/`);
  await pageSettled(ws.page);
  if (!(await signedIn(ws))) {
    const login = readScopedLogin('vastDashboard');
    console.log(
      `[vast] not signed in; signing in through Google as ${login.email}`,
    );
    await clickDescribed(ws.page, "Vast's log-in button");
    const popup = ws.ctx.waitForEvent('page');
    await clickDescribed(ws.page, 'the button that continues with Google');
    const googlePage = await popup;
    await googlePage.waitForLoadState('domcontentloaded');
    const completed = await googleSso(ws, login, {
      page: googlePage,
      originHost: 'cloud.vast.ai',
    });
    if (!completed || !(await signedIn(ws)))
      throw new Error(
        `VAST_SIGN_IN_FAILED: Google sign-in left no Vast session (${CURRENT_USER} still refuses this browser)`,
      );
    console.log(
      `[vast] kept ${(await store.capturePlaywright(ws.ctx, label)).length} cookies`,
    );
  }
  await switchToTeam(ws.page, team);
  return { ws, team, origin: ORIGIN };
}
