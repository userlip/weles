// The Slack workspace a browser run works in, and the steps every such run
// shares: starting its browser session, signing in through the workspace's
// Google SSO, seating api.slack.com's session for that workspace, and reading
// the web client's own (xoxc) token.
//
// Which workspace is the caller's to state (SLACK_WORKSPACE_URL); whether the
// browser is signed in is read from Slack's own session cookie, `d`, which
// Slack sets on its domain for a signed-in browser and which its web API
// requests carry next to the xoxc token.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { WSession } from '../../../../dist/session/wsession.js';
import { runRecordingsDir } from '../../../../dist/session/run-recordings.js';
import { statedProxy, statedText } from '../../_shared/inputs/stated.mjs';
import { signInThroughKeeper } from '../../_shared/keeper/google_sign_in.mjs';
import { sessionAct } from '../../_shared/keeper/session_act.mjs';
import { pageSettled } from '../../_shared/page/settled.mjs';

/** The workspace's origin, stated in SLACK_WORKSPACE_URL. */
export function slackWorkspace() {
  const raw = statedText(
    ['SLACK_WORKSPACE_URL'],
    'the Slack workspace address (https://<name>.slack.com) the run signs into',
  );
  const url = new URL(raw);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.slack.com'))
    throw new Error(
      `SLACK_WORKSPACE_URL is "${raw}", not an https://<name>.slack.com address`,
    );
  return url.origin;
}

/**
 * A Chromium session for `label` (the manifest install's OAuth POST rides the
 * browser context's request API), with `shot(name)` saving a full-page
 * screenshot into the run's own recordings.
 */
export async function startSlackSession(label) {
  const s = await WSession.start({
    label,
    browser: 'chromium',
    proxy: statedProxy(`the Slack ${label} run`),
    headless: process.env.HEADLESS === '1',
  });
  const shotDir = runRecordingsDir(label);
  mkdirSync(shotDir, { recursive: true });
  const shot = async (name) => {
    const path = join(shotDir, `${name}_${Date.now()}.png`);
    await s.page.screenshot({ path, fullPage: true });
    console.log(`[${label}] shot=${path}`);
  };
  return { s, shot };
}

/** Whether the browser context carries Slack's session cookie for `workspace`. */
export async function holdsSlackSession(ctx, workspace) {
  return (await ctx.cookies(workspace)).some(({ name }) => name === 'd');
}

/**
 * The Google login the workspace's SSO is answered with: SLACK_EMAIL with
 * SLACK_PASS, or null when no email is stated (the browser must then already
 * hold the workspace's session).
 */
export function statedSlackLogin() {
  if (!process.env.SLACK_EMAIL) return null;
  return {
    email: statedText(
      ['SLACK_EMAIL'],
      'the Google account the workspace admits',
    ),
    password: statedText(
      ['SLACK_PASS'],
      'the password of the Google account in SLACK_EMAIL',
    ),
  };
}

/**
 * Sign in to `workspace` through its Google SSO as `login`
 * ({ email, password, totpSecret? }); a browser that already holds the
 * workspace's session is left as it is. Refused when the browser holds no
 * session and no login is stated, or when Slack's session cookie is still
 * missing after Google let the browser go.
 */
export async function signInThroughGoogle(s, workspace, login, label) {
  const act = sessionAct(s, label);
  await act({ action: 'nav', url: workspace });
  await act({ action: 'settle' });
  if (await holdsSlackSession(s.ctx, workspace)) return [];
  if (!login)
    throw new Error(
      `SLACK_NOT_SIGNED_IN: the browser holds no Slack session for ${workspace} and SLACK_EMAIL/SLACK_PASS are not set to sign in with`,
    );
  await act({
    action: 'click_described',
    description: 'the button that signs in to the Slack workspace with Google',
  });
  await act({ action: 'settle' });
  const steps = await signInThroughKeeper(act, login);
  await act({ action: 'settle' });
  if (!(await holdsSlackSession(s.ctx, workspace)))
    throw new Error(
      `SLACK_NOT_SIGNED_IN: Google let the browser go at ${s.page.url()}, but it holds no Slack session for ${workspace}; Google steps: ${JSON.stringify(steps)}`,
    );
  console.log(`[${label}] signed in to ${workspace} at ${s.page.url()}`);
  return steps;
}

/**
 * Open the workspace's app management, which plants api.slack.com's session
 * for this workspace (api.slack.com signs in per workspace).
 */
export async function seatApiSession(page, workspace) {
  await page.goto(`${workspace}/apps/manage`, {
    waitUntil: 'domcontentloaded',
  });
  await pageSettled(page);
}

/**
 * The web client's own xoxc token for `workspace`, from its boot data or its
 * local storage; refused when the client holds none.
 */
export async function readClientToken(page, workspace) {
  await page.goto(`${workspace}/messages`, { waitUntil: 'domcontentloaded' });
  await pageSettled(page);
  const token = await page.evaluate(() => {
    if (window.boot_data && window.boot_data.api_token)
      return window.boot_data.api_token;
    return Object.keys(localStorage)
      .map((key) =>
        localStorage
          .getItem(key)
          .match(/xoxc-[\w-]+/)
          ?.shift(),
      )
      .find(Boolean);
  });
  if (!token)
    throw new Error(
      `SLACK_NO_CLIENT_TOKEN: the web client at ${page.url()} holds no xoxc token in boot_data or localStorage`,
    );
  return token;
}
