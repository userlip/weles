// Edit the Discord account's display name, About Me and custom status,
// through the shared Discord action runner (../../_shared/discord/run.mjs):
// the account, its seat, the ban signal and the kept verdict are the runner's.
//
// Env (at least one; each one set is applied): DISCORD_NEW_DISPLAY_NAME,
// DISCORD_NEW_BIO, DISCORD_NEW_STATUS.
//
// The settings controls are found by the vision model. The display name and
// About Me count once Discord's own account record (/users/@me) holds them;
// the custom status, which that record does not carry, once the user area
// shows it. A change that does not take fails the run. The changes are kept
// in the account's metadata.
import { runDiscordAction } from '../../_shared/discord/run.mjs';
import { readDiscordApi } from '../../_shared/discord/response.mjs';
import {
  clickDescribed,
  fillDescribed,
  pageShows,
} from '../../_shared/page/judged/seen.mjs';
import { pageSettled } from '../../_shared/page/settled.mjs';
import { updateAccountMetadata } from '../../_shared/skarbiec/accounts.mjs';

const NEW_DISPLAY = process.env.DISCORD_NEW_DISPLAY_NAME;
const NEW_BIO = process.env.DISCORD_NEW_BIO;
const NEW_STATUS = process.env.DISCORD_NEW_STATUS;
if (!NEW_DISPLAY && !NEW_BIO && !NEW_STATUS)
  throw new Error(
    'DISCORD_PROFILE_NOTHING_STATED: set DISCORD_NEW_DISPLAY_NAME, DISCORD_NEW_BIO or DISCORD_NEW_STATUS',
  );

await runDiscordAction({
  action: 'edit_profile',
  url: 'https://discord.com/channels/@me',
  run: { display_name: NEW_DISPLAY, bio: NEW_BIO, status: NEW_STATUS },
  act: async (s, acct) => {
    const changes = [];
    if (NEW_DISPLAY || NEW_BIO)
      await clickDescribed(s.page, 'the user settings button');
    if (NEW_DISPLAY) {
      await clickDescribed(
        s.page,
        'the edit button of the display name on the account page',
      );
      await fillDescribed(s.page, 'the display name field', NEW_DISPLAY);
      await clickDescribed(s.page, 'the button that saves the display name');
      await pageSettled(s.page);
      const { global_name: shown } = await readDiscordApi(
        s.page,
        '/users/@me',
        'DISCORD_ACCOUNT',
      );
      if (shown !== NEW_DISPLAY)
        throw new Error(
          `DISCORD_DISPLAY_NAME_NOT_SAVED: Discord's account record holds ${JSON.stringify(shown)}`,
        );
      changes.push('display_name');
    }
    if (NEW_BIO) {
      await clickDescribed(s.page, 'the profiles tab of the user settings');
      await fillDescribed(s.page, 'the About Me field', NEW_BIO);
      await clickDescribed(s.page, 'the button that saves the profile changes');
      await pageSettled(s.page);
      const { bio } = await readDiscordApi(
        s.page,
        '/users/@me',
        'DISCORD_ACCOUNT',
      );
      if (bio !== NEW_BIO)
        throw new Error(
          `DISCORD_BIO_NOT_SAVED: Discord's account record holds a ${String(bio).length}-character About Me`,
        );
      changes.push('bio');
    }
    if (NEW_STATUS) {
      await s.page.keyboard.press('Escape');
      await pageSettled(s.page);
      await clickDescribed(
        s.page,
        "the account's avatar in the bottom-left user area",
      );
      await clickDescribed(s.page, 'the option that sets a custom status');
      await fillDescribed(s.page, 'the custom status field', NEW_STATUS);
      await clickDescribed(s.page, 'the button that saves the custom status');
      await pageSettled(s.page);
      if (
        !(await pageShows(
          s.page,
          `Does the user area show the custom status "${NEW_STATUS}"?`,
        ))
      )
        throw new Error(
          'DISCORD_STATUS_NOT_SHOWN: the user area does not show the custom status after saving it',
        );
      changes.push('status');
    }
    updateAccountMetadata(acct.id, {
      last_profile_edit_at: new Date().toISOString(),
      last_profile_changes: changes,
    });
    return `${acct.username} changed ${changes.join(', ')}`;
  },
});
