// The Ads Manager panel in front of us: whether something covers it, and what
// text it shows.
//
// Controls and fields are found by the vision model from their description
// (`_shared/page/judged/seen.mjs`), which answers in whatever language the
// account's Ads Manager speaks; the selector lists of English and Polish labels
// this module used to carry are gone with the clicks and fills built on them.

import {
  clickDescribed,
  pageShows,
} from '../../../_shared/page/judged/seen.mjs';

// A side panel or overlay left open covers the table the run works in, so it
// is closed when the model sees one.
async function closeObstructingPanels(s) {
  if (
    await pageShows(
      s.page,
      'Is a side panel, popup or overlay open on top of the Ads Manager campaign table?',
    )
  ) {
    await clickDescribed(
      s.page,
      'the button that closes the open side panel, popup or overlay',
    );
  }
}

// A page whose text could not be read is not a page without text, so this
// names the read failure instead of answering with an empty string.
async function pageText(s) {
  try {
    return await s.page.evaluate(() => document.body.innerText);
  } catch (error) {
    throw new Error(
      `page text could not be read from ${s.page.url()}: ${error.message}`,
      { cause: error },
    );
  }
}

export { closeObstructingPanels, pageText };
