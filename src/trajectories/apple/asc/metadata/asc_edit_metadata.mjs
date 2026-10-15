// App Store Connect: edit an app's metadata. Inputs: APP_ID, and any of
// DESCRIPTION / KEYWORDS / PROMO_TEXT / WHATS_NEW (at least one). Every
// requested field must be on the page before anything is changed: a field the
// page does not show refuses the edit, so no request is half saved.
import { pageSettled } from '../../../_shared/page/settled.mjs';
import { getSocialAccount } from '../../../../../dist/utils/credentials.js';
import { WSession } from '../../../../../dist/session/wsession.js';
import { statedProxy, statedText } from '../../../_shared/inputs/stated.mjs';
import { openAppStoreConnect } from '../../asc_session.mjs';

const APP_ID = statedText(['APP_ID'], 'the numeric App Store Connect id of the app');
const fields = {
  description: process.env.DESCRIPTION,
  keywords: process.env.KEYWORDS,
  promotionalText: process.env.PROMO_TEXT,
  whatsNew: process.env.WHATS_NEW,
};
const toUpdate = Object.entries(fields).filter(([, value]) => value);
if (!toUpdate.length)
  throw new Error('at least one of DESCRIPTION, KEYWORDS, PROMO_TEXT or WHATS_NEW must be set');

const acct = await getSocialAccount('apple');
if (!acct) throw new Error('ASC_ACCOUNT_ABSENT: no Apple account is stored');

const s = await WSession.start({
  label: 'apple_asc_edit_metadata',
  proxy: statedProxy('the App Store Connect metadata edit'),
});
try {
  await openAppStoreConnect(s, `/apps/${APP_ID}/distribution/info`);
  // App Store Connect keys each metadata textarea by its name, test id or label.
  const editors = toUpdate.map(([field, value]) => ({
    field,
    value,
    textarea: s.page
      .locator(`textarea[name="${field}"], textarea[data-test-id*="${field}"], textarea[aria-label*="${field}" i]`)
      .first(),
  }));
  const absent = [];
  for (const editor of editors) if (!(await editor.textarea.isVisible())) absent.push(editor.field);
  if (absent.length)
    throw new Error(`ASC_METADATA_FIELD_ABSENT: app ${APP_ID}'s page shows no ${absent.join(', ')}; nothing was changed`);
  for (const { field, value, textarea } of editors) {
    await textarea.fill(value);
    console.log(`[asc-edit] ${field} set (${value.length} chars)`);
  }
  await pageSettled(s.page);
  await s.page.locator('button:has-text("Save"), button[data-test-id="save"]').click();
  await pageSettled(s.page);
  console.log(`PASS: updated ${editors.map((editor) => editor.field).join(', ')} for app ${APP_ID}`);
} finally {
  await s.close();
}
