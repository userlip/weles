// Send a 1:1 Discord direct message, through the shared Discord action runner
// (../../../_shared/discord/run.mjs) and the shared direct-message sender
// (../../../_shared/discord/direct.mjs). A message into a server channel is
// comment/organic_message.mjs. Discord's receipt (acknowledgement
// provider_response, the recipient requested, the conversation and message
// ids its answer carries) is printed as one JSON line.
//
// Env: RECIPIENT_HANDLE (required; @ optional) the username the DM goes to;
// DM_MESSAGE (required) the text, from a real account to a real person.
import { runDiscordAction } from '../../../_shared/discord/run.mjs';
import { sendDirectMessage } from '../../../_shared/discord/direct.mjs';
import { statedText } from '../../../_shared/inputs/stated.mjs';

const RECIPIENT = statedText(['RECIPIENT_HANDLE'], 'the Discord username the DM goes to', 'DISCORD_DM_RECIPIENT_REQUIRED');
const MESSAGE = statedText(['DM_MESSAGE'], 'the text sent from a real account to a real person', 'DISCORD_DM_MESSAGE_REQUIRED');

await runDiscordAction({
  action: 'dm',
  url: 'https://discord.com/channels/@me',
  run: { recipient: RECIPIENT },
  act: async (s) => {
    const receipt = await sendDirectMessage(s, RECIPIENT, MESSAGE);
    console.log(JSON.stringify(receipt));
    return `sent ${receipt.url} to ${RECIPIENT}`;
  },
});
