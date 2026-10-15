// Sign in to Vast (./session.mjs) in the stated team's context and read the
// host install command its setup page gives this account: the longest code
// block the page renders (the personalised command, longer than any example
// beside it). The page is kept as a screenshot in the run's recordings; a
// setup page that renders no code block fails the run.
import { join } from 'node:path';
import { runRecordingsDir } from '../../../dist/session/run-recordings.js';
import { exitStatusFor } from '../../../dist/cli/usage.js';
import { pageSettled } from '../_shared/page/settled.mjs';
import { openVast } from './session.mjs';

const { ws, team, origin } = await openVast('vast');
try {
  await ws.goto(`${origin}/host/setup/`);
  await pageSettled(ws.page);
  const command = await ws.page.evaluate(() => {
    const [longest] = Array.from(document.querySelectorAll('pre, code'))
      .filter((block) => block.checkVisibility())
      .map((block) => block.innerText.trim())
      .sort((a, b) => b.length - a.length);
    return longest;
  });
  if (!command) throw new Error(`VAST_INSTALL_COMMAND_MISSING: ${ws.page.url()} renders no code block`);
  const shot = join(runRecordingsDir('vast_login'), 'install_cmd.png');
  await ws.page.screenshot({ path: shot, fullPage: true });
  console.log(`[vast] install command (${command.length} characters), screenshot ${shot}`);
  console.log(`PASS: Vast install command read under team ${team}`);
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = exitStatusFor(error);
} finally {
  await ws.close();
}
