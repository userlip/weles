// GitHub health probe — lives in github/health/run.mjs because the github/
// top folder already has 5 files at its sibling level (solvers + register).
// Invoke via: node src/trajectories/github/health/run.mjs
import { runHealthProbe } from '../../_shared/health-runner.mjs';
import { detectGitHubBanSignals } from '../../../../dist/platforms/github/ban_signals.js';
import { HTTP_OK } from '../../../worker/weles-api-server/routes/http-status.mjs';

// api.github.com rejects web session cookies — it wants a personal-access-token
// Bearer header our accounts don't have. Probe github.com itself instead: the
// /settings/profile document answers 200 only to a signed-in session (a
// signed-out one is redirected to /login), and the logged-out /<username>
// profile answers with its own HTTP status (the runner reads a 200 as
// visible). Suspension is what GitHub's ban detector judged on the same
// signed-in page.
await runHealthProbe({
  platform: 'github',
  loggedInUrl: 'https://github.com/settings/profile',
  loggedInRegex: /^https:\/\/github\.com\/settings\/profile$/,
  loggedOutUrl: (u) => `https://github.com/${encodeURIComponent(u)}`,
  loggedOutRegex: /github\.com\/[^/?]+$/,
  banDetector: detectGitHubBanSignals,
  extractLoggedIn: (_body, resp) => ({
    ok: resp.status === HTTP_OK,
    karma: null,
    is_suspended: resp.signal?.signal === 'suspended',
  }),
});
