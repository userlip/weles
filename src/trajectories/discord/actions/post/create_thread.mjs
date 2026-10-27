// Create a Discord thread off an existing message in a text channel (a forum
// post is create_forum_post.mjs), through the shared Discord action runner
// (../../../_shared/discord/run.mjs): the account, its seat, the ban signal
// and the kept verdict are the runner's.
//
// Env: SERVER_CHANNEL_PATH ('<guild_id>/<channel_id>'), TARGET_MESSAGE_SUBSTRING
// (text of the parent message) and THREAD_NAME are required;
// THREAD_FIRST_MESSAGE, when set, is posted as the thread's first message.
//
// The parent's toolbar control, the thread-name field and the create control
// are found by the vision model; the thread counts once Discord's own answer
// names it off that parent with that name, and the first message once its
// answer holds that text in the thread.
import { humanFill } from '../../../../../dist/human/keyboard.js';
import { runDiscordAction } from '../../../_shared/discord/run.mjs';
import { findDiscordMessage } from '../../../_shared/discord/message-target.mjs';
import { readDiscordReply } from '../../../_shared/discord/response.mjs';
import { statedText } from '../../../_shared/inputs/stated.mjs';
import {
  clickDescribed,
  fillDescribed,
} from '../../../_shared/page/judged/seen.mjs';
import { responseAfterAction } from '../../../_shared/page/settled.mjs';

const CHANNEL = statedText(
  ['SERVER_CHANNEL_PATH'],
  "the channel, as '<guild_id>/<channel_id>'",
);
const TARGET = statedText(
  ['TARGET_MESSAGE_SUBSTRING'],
  'text of the message the thread starts from',
);
const NAME = statedText(['THREAD_NAME'], "the new thread's title");
const FIRST = process.env.THREAD_FIRST_MESSAGE;
const channel = /^(?<guild>\d+)\/(?<id>\d+)$/.exec(CHANNEL);
if (!channel)
  throw new Error(
    `DISCORD_THREAD_CHANNEL_INVALID: SERVER_CHANNEL_PATH must be guild_id/channel_id, not ${JSON.stringify(CHANNEL)}`,
  );
const { guild, id: channelId } = channel.groups;
const posted = (pattern) => (request) =>
  request.method() === 'POST' && pattern.test(new URL(request.url()).pathname);

await runDiscordAction({
  action: 'create_thread',
  url: `https://discord.com/channels/${CHANNEL}`,
  run: { channel: CHANNEL, target: TARGET, name: NAME },
  act: async (s) => {
    const { target, messageId: sourceId } = await findDiscordMessage(
      s.page,
      CHANNEL,
      channelId,
      TARGET,
      'DISCORD_THREAD',
    );
    await target.hover();
    await clickDescribed(
      s.page,
      'the create-thread button in the toolbar of the hovered message',
    );
    await fillDescribed(
      s.page,
      'the field that takes the new thread name',
      NAME,
    );
    if (FIRST) {
      const composer = s.page
        .locator('[role="dialog"] div[role="textbox"][contenteditable="true"]')
        .filter({ visible: true })
        .first();
      await composer.waitFor({ state: 'visible' });
      await humanFill(s.page, composer, FIRST);
    }
    // A thread made from a message takes that message's id; its first message
    // is posted right after it, so its answer is listened for before the click.
    const firstAnswer = FIRST
      ? s.page.waitForResponse((response) =>
          posted(new RegExp(`^/api/v\\d+/channels/${sourceId}/messages$`))(
            response.request(),
          ),
        )
      : null;
    const answer = await responseAfterAction(
      s.page,
      posted(
        new RegExp(
          `^/api/v\\d+/channels/${channelId}/messages/${sourceId}/threads$`,
        ),
      ),
      () => clickDescribed(s.page, 'the button that creates the thread'),
    );
    const thread = await readDiscordReply(
      answer,
      'create_thread',
      'DISCORD_THREAD',
    );
    if (
      thread.id !== sourceId ||
      thread.parent_id !== channelId ||
      thread.name !== NAME
    )
      throw new Error(
        `DISCORD_THREAD_CREATE_UNCONFIRMED: Discord answered the thread with ${JSON.stringify(thread)}`,
      );
    if (FIRST) {
      const first = await readDiscordReply(
        await firstAnswer,
        'thread_first_message',
        'DISCORD_THREAD',
      );
      if (first.channel_id !== thread.id || first.content !== FIRST)
        throw new Error(
          `DISCORD_THREAD_FIRST_MESSAGE_UNCONFIRMED: thread ${thread.id} was created, but its first message answered ${JSON.stringify(first)}`,
        );
    }
    return `created thread https://discord.com/channels/${guild}/${thread.id}`;
  },
});
