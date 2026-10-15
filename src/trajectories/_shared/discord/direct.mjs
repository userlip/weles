// One Discord direct message: the quick switcher finds the recipient's row by
// its exact handle, the conversation opens, and the message counts once
// Discord's own answer to its POST holds that text in that conversation.
import { humanFill } from '../../../../dist/human/keyboard.js';
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { readDiscordReply } from './response.mjs';
import { responseAfterAction, urlMatching } from '../page/settled.mjs';

/** Sends `text` to `recipient` (a username, @ optional); answers the message's address. */
export async function sendDirectMessage(s, recipient, text) {
  const handle = recipient.replace(/^@/, '');
  await s.page.keyboard.press('ControlOrMeta+K');
  const query = s.page.locator('[role="dialog"] input').filter({ visible: true }).first();
  await query.waitFor({ state: 'visible' });
  await humanFill(s.page, query, handle);
  const row = s.page
    .locator('[role="listbox"] [role="option"]')
    .filter({ has: s.page.getByText(handle, { exact: true }).or(s.page.getByText(`@${handle}`, { exact: true })), visible: true })
    .first();
  await row.waitFor({ state: 'visible' });
  await humanClickLocator(s.page, row);
  const channelId = new URL(await urlMatching(s.page, /^https:\/\/discord\.com\/channels\/@me\/\d+(?:[?#].*)?$/)).pathname.split('/').pop();
  const composer = s.page.locator('div[role="textbox"][contenteditable="true"]').filter({ visible: true }).first();
  await composer.waitFor({ state: 'visible' });
  if (!(await composer.isEditable())) throw new Error(`DISCORD_DM_COMPOSER_NOT_EDITABLE: the conversation with ${handle} takes no message`);
  await humanClickLocator(s.page, composer);
  await humanFill(s.page, composer, text);
  const messages = new RegExp(`^/api/v\\d+/channels/${channelId}/messages$`);
  const answer = await responseAfterAction(
    s.page,
    (request) => request.method() === 'POST' && messages.test(new URL(request.url()).pathname),
    () => s.page.keyboard.press('Enter'),
  );
  const message = await readDiscordReply(answer, 'direct_message', 'DISCORD_DM');
  if (message.channel_id !== channelId || message.content !== text || !/^\d+$/.test(message.id))
    throw new Error(`DISCORD_DM_UNCONFIRMED: Discord answered the message to ${handle} with ${JSON.stringify(message)}`);
  return `https://discord.com/channels/@me/${channelId}/${message.id}`;
}
