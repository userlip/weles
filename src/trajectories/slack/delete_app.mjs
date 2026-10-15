// Delete a Slack app from a workspace.
//
// Env:
//   SLACK_WORKSPACE_URL        required: the workspace, https://<name>.slack.com
//   SLACK_APP_ID               required: the app deleted
//   PROXY_URL                  required: the proxy the browser goes through, or 'direct'
//   SLACK_EMAIL, SLACK_PASS    sign in through the workspace's Google SSO; unset,
//                              the browser must already hold the workspace's session

import { statedText } from '../_shared/inputs/stated.mjs';
import { deleteApp } from './steps/manifest_app.mjs';
import {
  seatApiSession,
  signInThroughGoogle,
  slackWorkspace,
  startSlackSession,
  statedSlackLogin,
} from './steps/workspace.mjs';

const LABEL = 'slack-delete';
const workspace = slackWorkspace();
const APP_ID = statedText(['SLACK_APP_ID'], 'the Slack app to delete');
const login = statedSlackLogin();

const { s } = await startSlackSession(LABEL);
try {
  await signInThroughGoogle(s, workspace, login, LABEL);
  await seatApiSession(s.page, workspace);
  await deleteApp(s.page, APP_ID);
  console.log(`[${LABEL}] deleted app ${APP_ID} from ${workspace}`);
} finally {
  await s.close();
}
