// Send a message in a Discord channel in the account character's voice,
// through the shared action runner; the text answers the channel's newest
// message (../../submit.mjs discordNewestMessage).
//
// Env: SERVER_CHANNEL_PATH (required): <server id>/<channel id> or @me/<dm id>.
import { runAction } from '../../../_shared/action-runner.mjs';
import { discordNewestMessage, discordSubmitMessage } from '../../submit.mjs';
import { detectDiscordBanSignals } from '../../../../../dist/platforms/discord/ban_signals.js';
import { statedText } from '../../../_shared/inputs/stated.mjs';

const channelPath = statedText(
  ['SERVER_CHANNEL_PATH'],
  'the Discord channel to post in, as <server id>/<channel id> (or @me/<dm id>)',
);
await runAction({
  platform: 'discord',
  action: 'organic_message',
  feedUrl: `https://discord.com/channels/${channelPath}`,
  surfaceLabel: 'discord channel',
  pickPost: discordNewestMessage,
  submitComment: discordSubmitMessage,
  banDetector: detectDiscordBanSignals,
});
