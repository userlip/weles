// Watch a TikTok video through to its end, through the shared action
// runner: the account's fresh jar, the signed-in gate, the verdict and its
// record are the runner's.
//
// Env: TARGET_URL (optional): the video, or a page whose first video is
// watched; without it, the first video of the account's For You feed.
//
// The watch counts when the visible video has reached its end once (it
// ends, or TikTok loops it back to the start), read from the <video>
// element itself; a video that fails to play fails the run with its error.
import { detectTikTokBanSignals } from '../../../../dist/platforms/tiktok/ban_signals.js';
import { runAction } from '../../_shared/action-runner.mjs';
import { TIKTOK_ORIGIN, openVideo } from '../rail.mjs';

await runAction({
  platform: 'tiktok',
  action: 'watch_through',
  feedUrl: `${TIKTOK_ORIGIN}/foryou`,
  banDetector: detectTikTokBanSignals,
  act: async (s) => {
    await openVideo(s);
    const video = s.page.locator('video').filter({ visible: true }).first();
    await video.waitFor({ state: 'visible' });
    const watched = await video.evaluate(
      (element) =>
        new Promise((resolve, reject) => {
          let furthest = element.currentTime;
          const done = () =>
            resolve({ source: element.currentSrc, duration: element.duration });
          element.addEventListener('ended', done, { once: true });
          element.addEventListener('error', () =>
            reject(new Error(`the video failed to play: ${element.error?.message}`)),
          );
          element.addEventListener('timeupdate', () => {
            if (element.currentTime < furthest) done();
            furthest = Math.max(furthest, element.currentTime);
          });
          if (element.paused) element.play().catch(reject);
        }),
    );
    return `watched a ${watched.duration}s video through on ${s.page.url()}`;
  },
});
