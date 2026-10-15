// Enable the Bright Data proxy zone Skarbiec names (brightdataProxy.zone). A
// disabled zone fails every CONNECT with "client_10002: zone not found"; its
// header toggle turns it on.
//
// Signed in through ./sign_in.mjs. The onboarding and role popups Bright Data
// lays over the page are each closed (found by the vision model). The zone's
// toggle is the topmost checkbox outside any dialog (Bright Data draws it as
// a styled wrapper over a hidden input); a confirmation it asks for is
// answered, and the zone counts as enabled once that checkbox is checked.
import { WSession } from '../../../dist/session/wsession.js';
import { runRecordingsDir } from '../../../dist/session/run-recordings.js';
import { exitStatusFor } from '../../../dist/cli/usage.js';
import { readScopedSecret } from '../../_shared/scoped-secrets.mjs';
import { clickOffered } from '../_shared/page/judged/seen.mjs';
import { pageSettled } from '../_shared/page/settled.mjs';
import { brightdataSignIn } from './sign_in.mjs';

const ZONE = readScopedSecret('brightdataProxy', 'zone');

async function closePopups(page) {
  while (await clickOffered(page, 'the button that closes or skips an onboarding, survey or role popup')) await pageSettled(page);
}

/** The zone's header toggle: the topmost checkbox outside any dialog. */
async function headerToggle(page) {
  let top;
  for (const box of await page.locator('input[type="checkbox"]').all()) {
    if (await box.evaluate((el) => Boolean(el.closest('[role="dialog"], [aria-modal="true"]')))) continue;
    const y = await box.evaluate((el) => el.parentElement.getBoundingClientRect().top);
    if (!top || y < top.y) top = { box, y };
  }
  if (!top) throw new Error(`BRIGHTDATA_ZONE_TOGGLE_MISSING: ${page.url()} shows no zone toggle outside a dialog`);
  return top.box;
}

const s = await WSession.start({ label: 'brightdata_enable_zone', browser: 'chromium' });
try {
  await brightdataSignIn(s, 'BRIGHTDATA_ENABLE_ZONE');
  await closePopups(s.page);
  await s.page.goto(`https://brightdata.com/cp/zones/${ZONE}/access_params`, { waitUntil: 'domcontentloaded' });
  await pageSettled(s.page);
  await closePopups(s.page);
  await s.page.screenshot({ path: `${runRecordingsDir('brightdata_enable_zone')}/before.png`, fullPage: true });
  const toggle = await headerToggle(s.page);
  if (await toggle.isChecked()) console.log(`PASS: zone ${ZONE} is already enabled`);
  else {
    // The input is hidden; its styled wrapper takes the click.
    await toggle.evaluate((el) => (el.closest('label') ? el.closest('label') : el.parentElement).click());
    await pageSettled(s.page);
    if (await clickOffered(s.page, 'the button that confirms enabling the zone')) await pageSettled(s.page);
    await s.page.screenshot({ path: `${runRecordingsDir('brightdata_enable_zone')}/after.png`, fullPage: true });
    if (!(await toggle.isChecked())) throw new Error(`BRIGHTDATA_ZONE_NOT_ENABLED: zone ${ZONE}'s toggle is still off after the click`);
    console.log(`PASS: zone ${ZONE} enabled`);
  }
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = exitStatusFor(error);
} finally {
  await s.close();
}
