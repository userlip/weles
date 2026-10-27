// Comment on a YouTube video through the shared action runner: the account's
// session and proxy, the signed-in gate, the ban signal and the kept verdict
// are runAction's. The video and the words published under the account's name
// are the caller's (VIDEO_URL, COMMENT_TEXT); nothing is assumed, because a
// built-in comment on a built-in video is a real publication nobody asked for.
//
// The comment box and its Comment button are found by the vision model. The
// comment counts once YouTube answers its create_comment request with a
// succeeded action; a held or refused comment fails with YouTube's answer.
import { humanType } from '../../../dist/human/keyboard.js';
import { detectYouTubeBanSignals } from '../../../dist/platforms/youtube/ban_signals.js';
import { runAction } from '../_shared/action-runner.mjs';
import { statedText } from '../_shared/inputs/stated.mjs';
import { clickDescribed } from '../_shared/page/judged/seen.mjs';
import { pageSettled, responseAfterAction } from '../_shared/page/settled.mjs';

const VIDEO = statedText(['VIDEO_URL'], 'the YouTube video commented on');
const COMMENT = statedText(
  ['COMMENT_TEXT'],
  'the comment published under the account',
);
const CREATE_COMMENT = /\/youtubei\/v\d+\/comment\/create_comment/;

await runAction({
  platform: 'youtube',
  action: 'comment',
  feedUrl: VIDEO,
  banDetector: detectYouTubeBanSignals,
  act: async (s) => {
    await s.page.locator('#comments').scrollIntoViewIfNeeded();
    await pageSettled(s.page);
    await clickDescribed(
      s.page,
      "the video's add-a-comment box below the video",
    );
    await humanType(s.page, COMMENT);
    const answer = await responseAfterAction(
      s.page,
      (request) =>
        request.method() === 'POST' && CREATE_COMMENT.test(request.url()),
      () =>
        clickDescribed(
          s.page,
          'the Comment button that posts the typed comment',
        ),
    );
    const body = await answer.text();
    if (!answer.ok())
      throw new Error(
        `YOUTUBE_COMMENT_REFUSED: ${answer.url()} answered ${answer.status()}: ${body}`,
      );
    const result = JSON.parse(body).actionResult;
    if (!result || result.status !== 'STATUS_SUCCEEDED')
      throw new Error(
        `YOUTUBE_COMMENT_NOT_POSTED: YouTube's create_comment answer reports no succeeded action: ${body}`,
      );
    return `commented on ${VIDEO}`;
  },
});
