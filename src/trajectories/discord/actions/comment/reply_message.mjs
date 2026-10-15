// Reply to a specific Discord message (Discord's quoted reply), through the
// shared Discord action runner (../../../_shared/discord/run.mjs): the
// account, its seat, the ban signal and the kept verdict are the runner's.
// A top-level message is comment/organic_message.mjs.
//
// Env (all required): SERVER_CHANNEL_PATH ('<guild_id>/<channel_id>'),
// TARGET_MESSAGE_SUBSTRING (text of the message replied to), REPLY_TEXT.
//
// The parent message is found in the channel (../../../_shared/discord/message-target.mjs);
// its toolbar's reply control is found by the vision model; the reply counts
// once Discord's own answer to its POST holds the text and references that
// parent.
import { humanFill } from '../../../../../dist/human/keyboard.js';
import { humanClickLocator } from '../../../../../dist/human/mouse.js';
import { runDiscordAction } from '../../../_shared/discord/run.mjs';
import { findDiscordMessage } from '../../../_shared/discord/message-target.mjs';
import { readDiscordReply } from '../../../_shared/discord/response.mjs';
import { statedText } from '../../../_shared/inputs/stated.mjs';
import { clickDescribed } from '../../../_shared/page/judged/seen.mjs';
import { responseAfterAction } from '../../../_shared/page/settled.mjs';

const CHANNEL = statedText(['SERVER_CHANNEL_PATH'], "the channel, as '<guild_id>/<channel_id>'");
const TARGET = statedText(['TARGET_MESSAGE_SUBSTRING'], 'text of the message replied to');
const REPLY = statedText(['REPLY_TEXT'], 'the reply');
const channel = /^(?<guild>\d+)\/(?<id>\d+)$/.exec(CHANNEL);
if (!channel) throw new Error(`DISCORD_REPLY_CHANNEL_INVALID: SERVER_CHANNEL_PATH must be guild_id/channel_id, not ${JSON.stringify(CHANNEL)}`);
const { guild, id: channelId } = channel.groups;

await runDiscordAction({
  action: 'reply_message',
  url: `https://discord.com/channels/${CHANNEL}`,
  run: { channel: CHANNEL, target: TARGET },
  act: async (s) => {
    const { target, messageId: parentId } = await findDiscordMessage(s.page, CHANNEL, channelId, TARGET, 'DISCORD_REPLY');
    await target.hover();
    await clickDescribed(s.page, 'the reply button in the toolbar of the hovered message');
    const composer = s.page.locator('div[role="textbox"][contenteditable="true"]').filter({ visible: true }).first();
    await composer.waitFor({ state: 'visible' });
    await humanClickLocator(s.page, composer);
    await humanFill(s.page, composer, REPLY);
    const messages = new RegExp(`^/api/v\\d+/channels/${channelId}/messages$`);
    const answer = await responseAfterAction(
      s.page,
      (request) => request.method() === 'POST' && messages.test(new URL(request.url()).pathname),
      () => s.page.keyboard.press('Enter'),
    );
    const message = await readDiscordReply(answer, 'reply_message', 'DISCORD_REPLY');
    if (message.channel_id !== channelId || message.content !== REPLY || !message.message_reference || message.message_reference.message_id !== parentId)
      throw new Error(`DISCORD_REPLY_UNCONFIRMED: Discord answered the reply with ${JSON.stringify(message)}`);
    return `replied https://discord.com/channels/${guild}/${channelId}/${message.id} to ${parentId}`;
  },
});
