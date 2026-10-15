// Create a Slack bot app in a workspace and hand back its bot (xoxb) token.
//
// Env:
//   SLACK_WORKSPACE_URL        required: the workspace, https://<name>.slack.com
//   SLACK_BOT_APP_NAME         required: the name the workspace lists the app under
//   SLACK_BOT_SCOPES           required: the bot scopes it is granted (comma or
//                              space separated)
//   WELES_SECRET_RESULT_FILE   required: JSON path the raw token is written to;
//                              stdout carries only its type and length
//   PROXY_URL                  required: the proxy the browser goes through, or 'direct'
//   SLACK_EMAIL, SLACK_PASS    sign in through the workspace's Google SSO; unset,
//                              the browser must already hold the workspace's session
//
// What happens to the token is the caller's: nothing here writes it into a
// settings file, an MCP configuration or a vault.

import { writeFileSync } from 'node:fs';
import { statedText } from '../_shared/inputs/stated.mjs';
import { botManifest, createBotApp } from './steps/create_bot_app.mjs';
import {
  readClientToken,
  seatApiSession,
  signInThroughGoogle,
  slackWorkspace,
  startSlackSession,
  statedSlackLogin,
} from './steps/workspace.mjs';

const LABEL = 'slack-create';
const workspace = slackWorkspace();
const manifest = botManifest();
const RESULT_FILE = statedText(
  ['WELES_SECRET_RESULT_FILE'],
  'the JSON file the raw bot token is written to',
);
const login = statedSlackLogin();

const { s, shot } = await startSlackSession(LABEL);
try {
  await signInThroughGoogle(s, workspace, login, LABEL);
  const xoxc = await readClientToken(s.page, workspace);
  await seatApiSession(s.page, workspace);
  const { appId, token } = await createBotApp({
    page: s.page,
    xoxc,
    manifest,
    shot,
  });

  const auth = await (
    await s.page.context().request.post('https://slack.com/api/auth.test', {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();
  if (!auth.ok)
    throw new Error(
      `SLACK_TOKEN_REFUSED: auth.test refused the xoxb token of app ${appId}: ${auth.error}`,
    );
  writeFileSync(
    RESULT_FILE,
    JSON.stringify(
      {
        ok: true,
        token,
        app_id: appId,
        team: auth.team,
        team_id: auth.team_id,
        user: auth.user,
        user_id: auth.user_id,
        bot_id: auth.bot_id,
        url: auth.url,
      },
      null,
      '  ',
    ),
  );
  console.log(
    `[${LABEL}] bot ready ${JSON.stringify({ type: token.split('-').shift(), length: token.length, app_id: appId, team: auth.team, bot_id: auth.bot_id, result: RESULT_FILE })}`,
  );
} finally {
  await s.close();
}
