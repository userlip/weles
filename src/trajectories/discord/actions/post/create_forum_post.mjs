// Create a post in a Discord forum channel (every forum post is a top-level
// thread; a thread off a message is create_thread.mjs), through the shared
// Discord action runner (../../../_shared/discord/run.mjs): the account, its
// seat, the ban signal and the kept verdict are the runner's.
//
// Env: FORUM_CHANNEL_PATH ('<guild_id>/<forum_channel_id>'), POST_TITLE and
// POST_BODY are required; POST_TAGS, when set, is a comma-separated list of
// the forum's tag names to apply.
//
// The new-post control, title field and post control are found by the vision
// model; each tag chip by its own name. The post counts once Discord's own
// answer names the thread in that forum with that title and a first message
// holding the body.
import { humanFill } from '../../../../../dist/human/keyboard.js';
import { humanClickLocator } from '../../../../../dist/human/mouse.js';
import { runDiscordAction } from '../../../_shared/discord/run.mjs';
import { readDiscordReply } from '../../../_shared/discord/response.mjs';
import { statedText } from '../../../_shared/inputs/stated.mjs';
import {
  clickDescribed,
  fillDescribed,
} from '../../../_shared/page/judged/seen.mjs';
import { responseAfterAction } from '../../../_shared/page/settled.mjs';

const CHANNEL = statedText(
  ['FORUM_CHANNEL_PATH'],
  "the forum channel, as '<guild_id>/<forum_channel_id>'",
);
const TITLE = statedText(['POST_TITLE'], "the forum post's title");
const BODY = statedText(['POST_BODY'], "the forum post's content");
const TAGS = process.env.POST_TAGS
  ? process.env.POST_TAGS.split(',')
      .map((tag) => tag.trim())
      .filter(Boolean)
  : [];
const channel = /^(?<guild>\d+)\/(?<id>\d+)$/.exec(CHANNEL);
if (!channel)
  throw new Error(
    `DISCORD_FORUM_CHANNEL_INVALID: FORUM_CHANNEL_PATH must be guild_id/forum_channel_id, not ${JSON.stringify(CHANNEL)}`,
  );
const { guild, id: forumId } = channel.groups;

await runDiscordAction({
  action: 'create_forum_post',
  url: `https://discord.com/channels/${CHANNEL}`,
  run: { channel: CHANNEL, title: TITLE, tags: TAGS },
  act: async (s) => {
    await clickDescribed(s.page, 'the button that starts a new forum post');
    await fillDescribed(
      s.page,
      'the field that takes the new post title',
      TITLE,
    );
    for (const tag of TAGS) {
      const chip = s.page
        .getByText(tag, { exact: true })
        .filter({ visible: true })
        .first();
      if (!(await chip.count()))
        throw new Error(
          `DISCORD_FORUM_TAG_MISSING: the forum offers no tag named ${tag}`,
        );
      await humanClickLocator(s.page, chip);
    }
    const composer = s.page
      .locator('div[role="textbox"][contenteditable="true"]')
      .filter({ visible: true })
      .first();
    await composer.waitFor({ state: 'visible' });
    await humanClickLocator(s.page, composer);
    await humanFill(s.page, composer, BODY);
    const threads = new RegExp(`^/api/v\\d+/channels/${forumId}/threads$`);
    const answer = await responseAfterAction(
      s.page,
      (request) =>
        request.method() === 'POST' &&
        threads.test(new URL(request.url()).pathname),
      () => clickDescribed(s.page, 'the button that publishes the forum post'),
    );
    const thread = await readDiscordReply(
      answer,
      'create_forum_post',
      'DISCORD_FORUM',
    );
    if (
      thread.parent_id !== forumId ||
      thread.name !== TITLE ||
      !thread.message ||
      thread.message.channel_id !== thread.id ||
      thread.message.content !== BODY
    )
      throw new Error(
        `DISCORD_FORUM_POST_UNCONFIRMED: Discord answered the post with ${JSON.stringify(thread)}`,
      );
    return `posted https://discord.com/channels/${guild}/${thread.id}`;
  },
});
