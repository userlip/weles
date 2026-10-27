import { humanFill } from '../../../../../dist/human/keyboard.js';
import { humanClickLocator } from '../../../../../dist/human/mouse.js';
import { pageSettled } from '../../page/settled.mjs';
import {
  clickDescribed,
  clickOffered,
  pageShows,
} from '../../page/judged/seen.mjs';
import { input, siteHostname } from '../action-catalog.mjs';
import {
  escapeRegExp,
  bodyText,
  clickCardLike,
  clickAnyLocator,
} from '../page-interaction.mjs';

/** The GA4 measurement id (G-…) `text` shows, or undefined. */
function extractGaMeasurementId(text) {
  return text.match(/\bG-[A-Z\d]+\b/)?.shift();
}

/**
 * Open the data stream the run names (STREAM_ID, else STREAM_NAME) from the
 * property's data streams table; a run that names none opens the property's
 * web stream as the vision model finds it.
 */
async function openDataStreamDetail(s) {
  if (!new URL(s.page.url()).hash.includes('/admin/streams/table'))
    throw new Error(`GA did not open the data streams table: ${s.page.url()}`);
  const streamId = input('STREAM_ID');
  const streamName = input('STREAM_NAME');
  if (!streamId && !streamName) {
    await clickDescribed(s.page, "the property's web data stream row");
    return;
  }
  const named = streamId
    ? new RegExp(escapeRegExp(streamId))
    : new RegExp(`^${escapeRegExp(streamName)}$`, 'i');
  if (!(await clickCardLike(s.page, named)))
    throw new Error(
      `GA's data streams table shows no stream ${JSON.stringify(streamId ? streamId : streamName)}`,
    );
}

async function fillGoogleAnalyticsWebStreamStep(s, values) {
  // One walk toward the editor: from a data-streams screen the Web platform
  // button opens it; from anywhere else the Data streams entry comes first.
  // Each click leaves the page settled before the next look.
  await pageSettled(s.page);
  const editor = s.page
    .locator('ga-admin-web-stream-editor')
    .filter({ visible: true })
    .first();
  if (
    !(await editor.isVisible()) &&
    !(await pageShows(
      s.page,
      'Does the page show the data stream setup (choosing a platform, or a web stream form)?',
    ))
  )
    await clickOffered(
      s.page,
      'the control that opens data streams or creates a new stream',
    );
  if (!(await editor.isVisible())) {
    const platform = [
      s.page.locator('button[debug-id="create-web-stream-button"]'),
      s.page.locator('[data-guidedhelpid="data-stream-choose-web"]'),
    ];
    if (!(await clickAnyLocator(s.page, platform)))
      await clickDescribed(
        s.page,
        'the Web platform choice for a new data stream',
      );
  }
  await pageSettled(s.page);
  if (!(await editor.isVisible()))
    throw new Error('GA web stream editor did not open');

  const website = editor.locator('input[debug-id="website-url-input"]').first();
  const streamName = editor
    .locator('input[debug-id="stream-name-input"]')
    .first();
  if (!(await website.isVisible()) || !(await streamName.isVisible()))
    throw new Error('GA web stream fields were not visible');
  await humanFill(s.page, website, siteHostname(values.siteUrl));
  await humanFill(s.page, streamName, values.streamName);
  await clickAnyLocator(
    s.page,
    [editor.locator('button[debug-id="create-stream-button"]')],
    'GA web stream Create and continue button',
  );
  await pageSettled(s.page);
}

/** The created stream's detail page: the one that shows its measurement id. */
async function openGoogleAnalyticsCreatedStreamDetail(s, values) {
  const detailShown = async () =>
    Boolean(extractGaMeasurementId(await bodyText(s.page)));
  await pageSettled(s.page);
  if (!(await detailShown())) {
    const row = s.page
      .locator('mat-row, tr, [role="row"]')
      .filter({ hasText: new RegExp(escapeRegExp(values.streamName), 'i') })
      .filter({ visible: true })
      .first();
    if (!(await row.isVisible()))
      throw new Error(
        `GA shows neither the created stream's detail nor its row ${JSON.stringify(values.streamName)} at ${s.page.url()}`,
      );
    const arrow = row
      .locator('button[aria-label="Select stream"], button')
      .filter({ visible: true })
      .last();
    if (!(await clickAnyLocator(s.page, [arrow])))
      await humanClickLocator(s.page, row);
    await pageSettled(s.page);
  }
  if (
    await clickOffered(
      s.page,
      'the button that shows the tag installation instructions',
    )
  )
    await pageSettled(s.page);
}

export {
  extractGaMeasurementId,
  openDataStreamDetail,
  fillGoogleAnalyticsWebStreamStep,
  openGoogleAnalyticsCreatedStreamDetail,
};
