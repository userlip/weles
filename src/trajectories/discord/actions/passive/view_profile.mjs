// View another Discord user's profile, through the shared Discord action
// runner (../../../_shared/discord/run.mjs): the account, its seat, the ban
// signal and the kept verdict are the runner's.
//
// Env: DISCORD_TARGET_USER_ID (required): the user's numeric id.
//
// The profile is opened as a user would (/users/<id>), and read from the
// answer Discord gives its own profile popout (/users/<id>/profile): display
// name, username, bio, avatar, banner and connected accounts. It is written
// as <id>.json under the run's output.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runOutputPath } from '#run-output';
import { runDiscordAction } from '../../../_shared/discord/run.mjs';
import { readDiscordApi } from '../../../_shared/discord/response.mjs';
import { statedText } from '../../../_shared/inputs/stated.mjs';
import { pageSettled } from '../../../_shared/page/settled.mjs';

const INDENT = '  ';
const TARGET_ID = statedText(
  ['DISCORD_TARGET_USER_ID'],
  'the numeric id of the Discord user whose profile is viewed',
);
if (!/^\d+$/.test(TARGET_ID))
  throw new Error(
    `DISCORD_TARGET_USER_ID "${TARGET_ID}" is not a numeric Discord user id`,
  );

await runDiscordAction({
  action: 'view_profile',
  url: 'https://discord.com/channels/@me',
  run: { target_id: TARGET_ID },
  act: async (s, acct) => {
    await s.goto(`https://discord.com/users/${TARGET_ID}`);
    await pageSettled(s.page);
    const { user, connected_accounts: connected } = await readDiscordApi(
      s.page,
      `/users/${TARGET_ID}/profile`,
      'DISCORD_PROFILE',
    );
    const profile = {
      id: TARGET_ID,
      display: user.global_name,
      username: user.username,
      bio: user.bio,
      avatar: user.avatar
        ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
        : null,
      banner: user.banner
        ? `https://cdn.discordapp.com/banners/${user.id}/${user.banner}.png`
        : null,
      connected: connected.map((account) => ({
        type: account.type,
        name: account.name,
      })),
      fetched_at: new Date().toISOString(),
      fetched_by: acct.username,
    };
    const dir = runOutputPath('discord_view_profile');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${TARGET_ID}.json`);
    writeFileSync(file, JSON.stringify(profile, null, INDENT));
    return `profile of ${user.username} written to ${file}`;
  },
});
