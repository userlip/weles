// React to a Discord message with an emoji, through the shared Discord action
// runner (../../_shared/discord/run.mjs): the account, its seat, the ban
// signal and the kept verdict are the runner's.
//
// Env (all required; nothing is reacted to by default):
//   SERVER_CHANNEL_PATH   the channel, as <server id>/<channel id> (or @me/<dm id>)
//   DISCORD_MESSAGE_ID    the message reacted to
//   DISCORD_REACTION      the emoji, as Discord takes it in a reaction (a
//                         Unicode emoji, or name:id for a custom one)
//
// The reaction is the PUT the web client sends when an emoji is picked,
// authorised by the token the page holds, and counts only when Discord
// answers it with success.
import { runDiscordAction } from '../../_shared/discord/run.mjs';
import { statedText } from '../../_shared/inputs/stated.mjs';

const channelPath = statedText(['SERVER_CHANNEL_PATH'], 'the Discord channel to react in, as <server id>/<channel id> (or @me/<dm id>)');
const MESSAGE_ID = statedText(['DISCORD_MESSAGE_ID'], 'the Discord message to react to');
const REACTION = statedText(['DISCORD_REACTION'], 'the emoji the reaction carries (a Unicode emoji, or name:id for a custom one)');
const [, channelId] = channelPath.split('/');
if (!channelId) throw new Error(`SERVER_CHANNEL_PATH "${channelPath}" names no channel after its server`);

await runDiscordAction({
  action: 'react',
  url: `https://discord.com/channels/${channelPath}`,
  run: { channel: channelPath, message_id: MESSAGE_ID, reaction: REACTION },
  act: async (s) => {
    const result = await s.page.evaluate(
      async ({ channel, message, emoji }) => {
        const stored = localStorage.token;
        if (!stored) return { error: 'the page holds no Discord token' };
        const answer = await fetch(`/api/v9/channels/${channel}/messages/${message}/reactions/${encodeURIComponent(emoji)}/%40me`, {
          method: 'PUT',
          headers: { Authorization: JSON.parse(stored) },
        });
        return { ok: answer.ok, status: answer.status, body: await answer.text() };
      },
      { channel: channelId, message: MESSAGE_ID, emoji: REACTION },
    );
    if (result.error) throw new Error(`DISCORD_REACT_UNAUTHORISED: ${result.error}`);
    if (!result.ok) throw new Error(`DISCORD_REACT_REFUSED: Discord answered the reaction ${result.status}: ${result.body}`);
    return `reacted ${REACTION} on message ${MESSAGE_ID}`;
  },
});
