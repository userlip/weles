// List the team's Vast host machine for rent at the owner's price: signed in
// through ./session.mjs in the stated team's context (VAST_TEAM_NAME), the
// machine's settings opened on the host machines page, the on-demand price
// per GPU (PRICE_GPU, US dollars an hour, required) typed into the dialog and
// LIST pressed. The controls are found by the vision model, and a page that
// shows several machines is refused rather than one of them guessed. The
// listing counts once Vast answers the request LIST sends with success; its
// refusal fails the run with Vast's own answer.
import { join } from 'node:path';
import { runRecordingsDir } from '../../../dist/session/run-recordings.js';
import { exitStatusFor } from '../../../dist/cli/usage.js';
import { statedText } from '../_shared/inputs/stated.mjs';
import {
  clickDescribed,
  fillDescribed,
  pageShows,
} from '../_shared/page/judged/seen.mjs';
import { pageSettled, responseAfterAction } from '../_shared/page/settled.mjs';
import { openVast } from './session.mjs';

const PRICE_GPU = statedText(
  ['PRICE_GPU'],
  'the hourly price per GPU the machine is listed at, in US dollars',
);

const { ws, team, origin } = await openVast('vast_list_machine');
try {
  await ws.goto(`${origin}/host/machines/`);
  await pageSettled(ws.page);
  if (
    await pageShows(ws.page, 'Does the page list more than one host machine?')
  )
    throw new Error(
      `VAST_MACHINE_AMBIGUOUS: team ${team} hosts several machines; nothing was listed`,
    );
  await clickDescribed(ws.page, "the host machine's SETTINGS button");
  await fillDescribed(
    ws.page,
    'the on-demand price per GPU field in the open machine settings dialog',
    PRICE_GPU,
  );
  const answer = await responseAfterAction(
    ws.page,
    (request) =>
      request.method() !== 'GET' &&
      new URL(request.url()).pathname.startsWith('/api/v0/'),
    () =>
      clickDescribed(
        ws.page,
        'the LIST button of the open machine settings dialog',
      ),
  );
  const body = await answer.text();
  if (!answer.ok())
    throw new Error(
      `VAST_LIST_REFUSED: ${answer.url()} answered ${answer.status()}: ${body}`,
    );
  const shot = join(runRecordingsDir('vast_list_machine'), 'list_result.png');
  await pageSettled(ws.page);
  await ws.page.screenshot({ path: shot, fullPage: true });
  console.log(
    `[vast] ${answer.request().method()} ${answer.url()} answered ${answer.status()}: ${body}`,
  );
  console.log(
    `PASS: machine listed at $${PRICE_GPU}/GPU-hour under team ${team} (screenshot ${shot})`,
  );
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = exitStatusFor(error);
} finally {
  await ws.close();
}
