import { runAction } from '../../../_shared/action-runner.mjs';
import { discordSubmitMessage } from '../../submit.mjs';
import { detectDiscordBanSignals } from '../../../../../dist/platforms/discord/ban_signals.js';
import { statedText } from '../../../_shared/inputs/stated.mjs';

const channelPath = statedText(
  ['SERVER_CHANNEL_PATH'],
  'the Discord channel to promote in, as <server id>/<channel id> (or @me/<dm id>)',
);
await runAction({
  platform: 'discord',
  action: 'promote',
  feedUrl: `https://discord.com/channels/${channelPath}`,
  surfaceLabel: 'discord channel',
  pickPost: async (s) => {
    try {
      const text = await s.page.evaluate(() => {
        const messages = Array.from(
          document.querySelectorAll('[class*="messageContent"]'),
        ).slice(-5);
        const last = messages[messages.length - 1];
        return last?.textContent?.trim() ?? '';
      });
      return { postTitle: text || '', postBody: '' };
    } catch {
      return { postTitle: '', postBody: '' };
    }
  },
  submitComment: discordSubmitMessage,
  banDetector: detectDiscordBanSignals,
});
