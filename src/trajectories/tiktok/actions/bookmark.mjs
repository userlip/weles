// Add a TikTok video to the account's favourites through the shared action
// runner: the account's fresh jar, the signed-in gate, the verdict and its
// record are the runner's.
//
// Env: TARGET_URL (required): the video, or a page whose first video is
// saved.
import { detectTikTokBanSignals } from '../../../../dist/platforms/tiktok/ban_signals.js';
import { runAction } from '../../_shared/action-runner.mjs';
import { openVideo, switchRailOn } from '../rail.mjs';

await runAction({
  platform: 'tiktok',
  action: 'bookmark',
  banDetector: detectTikTokBanSignals,
  act: async (s) => {
    await openVideo(s);
    const saved = await switchRailOn(
      s.page,
      'button[data-e2e="video-save"], button[data-e2e="favorite-icon"], button[data-e2e="browse-favorite-icon"]',
      'favourites (bookmark)',
    );
    return saved ? `already saved ${s.page.url()}` : `saved ${s.page.url()}`;
  },
});
