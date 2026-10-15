// Post a message to Slack, by one of two routes that resolve recipients and
// mentions the same way (`./post_message/recipients.mjs`):
//   BOT: as the bot wisent-integrations' slack domain holds the token of
//     (identity swiatowid-bot) — no browser, no app creation. Taken whenever
//     the integrations are configured, so a reachable bot is never shadowed by
//     a second app.
//   BROWSER: signed in to the workspace (`./steps/workspace.mjs`), a bot app
//     is created from the caller's manifest, and the message is posted with
//     its fresh xoxb token, never as the signed-in person.
// Every recipient is attempted; any that refused fails the run, named with
// Slack's answer.
//
// Env:
//   MESSAGE_TEXT | MESSAGE_FILE   the message: inline text, or a file on this machine
//   SLACK_TARGET_CHANNEL (id) | SLACK_TARGET_CHANNEL_NAME | SLACK_TARGET_USER_IDS |
//   SLACK_TARGET_USER_MATCHERS (csv) | SLACK_RECIPIENT_GROUPS ('a,b;c,d')
//   SLACK_ENABLE_TAGGING=0 | SLACK_MENTION_USER_IDS | SLACK_MENTION_USER_MATCHERS
//   STADO_INTEGRATION_API_URL + WELES_STADO_INTEGRATION_TOKEN   the bot route
//   SLACK_WORKSPACE_URL, SLACK_BOT_APP_NAME, SLACK_BOT_SCOPES, PROXY_URL,
//   SLACK_EMAIL/SLACK_PASS        the browser route

import { readFileSync } from 'node:fs';
import { statedText } from '../_shared/inputs/stated.mjs';
import {
  botConfigured,
  slackDirectory,
  slackPost,
  workspaceApi,
  workspaceDirectory,
} from './post_message/api.mjs';
import {
  applyMentions,
  listMembers,
  mentionIdsForTarget,
  resolveTargets,
} from './post_message/recipients.mjs';
import { botManifest, createBotApp } from './steps/create_bot_app.mjs';
import {
  readClientToken,
  seatApiSession,
  signInThroughGoogle,
  slackWorkspace,
  startSlackSession,
  statedSlackLogin,
} from './steps/workspace.mjs';

const LABEL = 'slack-post';

/** The message: MESSAGE_TEXT inline, else the file MESSAGE_FILE names. */
function statedMessage() {
  if (process.env.MESSAGE_TEXT) return process.env.MESSAGE_TEXT;
  return readFileSync(
    statedText(
      ['MESSAGE_TEXT', 'MESSAGE_FILE'],
      'the message posted: inline text, or a file on this machine holding it',
    ),
    'utf8',
  );
}

/** The bot route: the integrations' bot reads the directory and posts. */
async function botRoute() {
  const who = await slackPost('auth.test', {});
  console.log(
    `[${LABEL}] bot route: bot=${who.user} user_id=${who.user_id} team=${who.team}`,
  );
  return {
    directory: slackDirectory,
    post: (channel, text) => slackPost('chat.postMessage', { channel, text }),
    close: async () => {},
  };
}

/**
 * The browser route: the signed-in client reads the directory, and a bot app
 * created from the caller's manifest posts.
 */
async function browserRoute() {
  console.log(
    `[${LABEL}] wisent-integrations is not configured: signing in to the workspace and creating a bot app`,
  );
  const workspace = slackWorkspace();
  const manifest = botManifest();
  const login = statedSlackLogin();
  const { s, shot } = await startSlackSession(LABEL);
  try {
    await signInThroughGoogle(s, workspace, login, LABEL);
    const xoxc = await readClientToken(s.page, workspace);
    await seatApiSession(s.page, workspace);
    const bot = await createBotApp({ page: s.page, xoxc, manifest, shot });
    const slackApi = workspaceApi(s.page.context().request, workspace);
    return {
      directory: workspaceDirectory(slackApi, xoxc),
      post: (channel, text) =>
        slackApi('chat.postMessage', {
          token: bot.token,
          channel,
          text,
          mrkdwn: true,
        }),
      close: () => s.close(),
    };
  } catch (error) {
    await s.close();
    throw error;
  }
}

const MESSAGE_BODY = statedMessage();
const route = botConfigured() ? await botRoute() : await browserRoute();
try {
  const targets = await resolveTargets(route.directory);
  let members;
  const loadMembers = async () => {
    if (!members) members = await listMembers(route.directory);
    return members;
  };
  const refused = [];
  for (const target of targets) {
    const mentionIds = await mentionIdsForTarget(target, loadMembers);
    try {
      const post = await route.post(target, applyMentions(MESSAGE_BODY, mentionIds));
      console.log(`[${LABEL}] posted to ${target} ts=${post.ts}`);
    } catch (error) {
      refused.push(`${target}: ${error.message}`);
    }
  }
  if (refused.length)
    throw new Error(
      `SLACK_POST_REFUSED: ${refused.length} of ${targets.length} recipient(s) refused the message: ${refused.join('; ')}`,
    );
  console.log(`[${LABEL}] delivered to ${targets.length} recipient(s)`);
} finally {
  await route.close();
}
