// A Slack bot (xoxb) token: an app created from the caller's manifest (its
// name in SLACK_BOT_APP_NAME, its bot scopes in SLACK_BOT_SCOPES) with the
// signed-in web client's own token, installed to the workspace, and the bot
// token read from the app's OAuth page (`./manifest_app.mjs`).

import {
  appToken,
  installManifestApp,
  statedManifest,
} from './manifest_app.mjs';

/** The manifest the bot app is created from, refused by name when unstated. */
export function botManifest() {
  return statedManifest({
    kind: 'bot',
    nameVar: 'SLACK_BOT_APP_NAME',
    scopesVar: 'SLACK_BOT_SCOPES',
    what: 'bot',
  });
}

/**
 * Create and install the bot app `manifest` describes with the client token
 * `xoxc`; resolves its id and bot token.
 */
export async function createBotApp({ page, xoxc, manifest, shot }) {
  const appId = await installManifestApp({
    page,
    xoxc,
    manifest,
    label: 'slack-bot',
    shot,
  });
  return { appId, token: await appToken(page, appId, 'xoxb') };
}
