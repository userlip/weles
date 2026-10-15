// Comment on a GitHub issue in the account character's voice, through the
// shared action runner; the text answers the issue's title and opening post
// (../submit.mjs githubIssuePost).
//
// Env: ISSUE_URL (required): the issue, as https://github.com/<owner>/<repo>/issues/<n>.
import { runAction } from '../../_shared/action-runner.mjs';
import { statedText } from '../../_shared/inputs/stated.mjs';
import { githubIssuePost, githubSubmitIssueComment } from '../submit.mjs';
import { detectGitHubBanSignals } from '../../../../dist/platforms/github/ban_signals.js';

const ISSUE_URL = statedText(['ISSUE_URL'], 'the GitHub issue to comment on');

await runAction({
  platform: 'github',
  action: 'organic_issue_comment',
  feedUrl: ISSUE_URL,
  surfaceLabel: 'github issue',
  pickPost: githubIssuePost,
  submitComment: githubSubmitIssueComment,
  banDetector: detectGitHubBanSignals,
});
