// Follow a TikTok account through the shared action runner: the account's
// fresh jar, the signed-in gate, the verdict and its record are the
// runner's.
//
// Env: TARGET_USER (required; @ optional): the handle to follow.
//
// The follow is the profile's follow-button, which TikTok replaces with its
// follow-icon once the account follows.
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { detectTikTokBanSignals } from '../../../../dist/platforms/tiktok/ban_signals.js';
import { runAction } from '../../_shared/action-runner.mjs';
import { statedText } from '../../_shared/inputs/stated.mjs';
import { TIKTOK_ORIGIN } from '../rail.mjs';

const TARGET_USER = statedText(
  ['TARGET_USER'],
  'the TikTok handle to follow',
).replace(/^@/, '');

await runAction({
  platform: 'tiktok',
  action: 'follow',
  resolveUserUrl: () => `${TIKTOK_ORIGIN}/@${encodeURIComponent(TARGET_USER)}`,
  banDetector: detectTikTokBanSignals,
  act: async (s) => {
    const following = s.page
      .locator('button[data-e2e="follow-icon"]')
      .filter({ visible: true })
      .first();
    if (await following.count()) return `already following @${TARGET_USER}`;
    const follow = s.page
      .locator('button[data-e2e="follow-button"]')
      .filter({ visible: true })
      .first();
    await follow.waitFor({ state: 'visible' });
    await humanClickLocator(s.page, follow);
    await following.waitFor({ state: 'visible' });
    return `followed @${TARGET_USER}`;
  },
});
