// Getting from the campaign table into a draft, and refusing with evidence
// when we never got there.
//
// Ads Manager opens on a table, not on a form. This module presses Create (or
// recognises that ADS_URL already put us inside a draft), picks the objective,
// walks the campaign-setup step that sometimes appears in between, and - when
// the form never appeared - names the controls that were on screen in the
// refusal, so it can be read without a screenshot. Ads Manager speaks the
// account's language, so every control is found and every page state is
// judged by the vision model (`_shared/page/judged/seen.mjs`), never by the
// words one language prints.
import { pageSettled } from '../../../_shared/page/settled.mjs';
import {
  clickDescribed,
  pageShows,
} from '../../../_shared/page/judged/seen.mjs';
import { objectiveLabels } from './campaign_request.mjs';

// URLSearchParams answers null for a parameter that is not in the address, so
// that answer is passed through as it is.
function selectedCampaignId(url) {
  if (!URL.canParse(url)) return null;
  return new URL(url).searchParams.get('selected_campaign_ids');
}

async function maybeContinueCampaignConfiguration(s) {
  const asked = await pageShows(
    s.page,
    'Is a dialog open that asks how to set up the new campaign (for example a choice between a recommended and a manual setup)?',
  );
  if (asked)
    await clickDescribed(
      s.page,
      'the button that continues past the campaign setup dialog',
    );
}

async function openCampaignCreation(s) {
  const startingDraftUrl = s.page.url();
  if (
    /\/edit\/standalone/i.test(startingDraftUrl) &&
    selectedCampaignId(startingDraftUrl)
  ) {
    console.log(
      `[meta-ads] configuring existing draft campaign_id=${selectedCampaignId(startingDraftUrl)}`,
    );
    return;
  }
  await clickDescribed(
    s.page,
    'the button in the Ads Manager campaigns toolbar that creates a new campaign',
  );
}

async function chooseObjectiveAndContinue(s) {
  if (/\/edit\/standalone/i.test(s.page.url())) return;
  const [objective] = objectiveLabels;
  try {
    await clickDescribed(
      s.page,
      `the campaign objective option labelled "${objective}"`,
    );
    await clickDescribed(
      s.page,
      'the button that continues to the next step after choosing the campaign objective',
    );
  } catch (error) {
    throw new Error(
      `[meta-ads] ${error.message}; visible controls: ${JSON.stringify(await visibleControls(s))}`,
      {
        cause: error,
      },
    );
  }
  await maybeContinueCampaignConfiguration(s);
}

/** Diagnostics for a refusal: every rendered control with its text, box, tag and role. */
function visibleControls(s) {
  return s.page.evaluate(() =>
    Array.from(
      document.querySelectorAll(
        'button,[role="button"],[role="radio"],[role="tab"],a',
      ),
    )
      .filter((el) => el.checkVisibility() && el.innerText.trim())
      .map((el) => {
        const box = el.getBoundingClientRect();
        return {
          text: el.innerText.replace(/\s+/g, ' ').trim(),
          x: Math.round(box.left),
          y: Math.round(box.top),
          w: Math.round(box.width),
          h: Math.round(box.height),
          tag: el.tagName,
          role: el.getAttribute('role'),
        };
      }),
  );
}

/**
 * When no campaign field was filled: the id of the draft Ads Manager already
 * staged and shows as unpublished, else a refusal - the ad account blocked by
 * Meta's setup or review (META_ADS_ACCOUNT_BLOCKED, for an operator to clear),
 * or the campaign form never reached (META_ADS_FORM_NOT_REACHED, with the
 * controls that were on screen).
 */
async function stagedDraftWithoutFields(s) {
  await pageSettled(s.page);
  const url = s.page.url();
  const draftCampaignId = selectedCampaignId(url);
  if (
    draftCampaignId &&
    (await pageShows(
      s.page,
      'Does the page show the selected campaign as an unpublished draft?',
    ))
  )
    return draftCampaignId;
  if (
    await pageShows(
      s.page,
      'Does the page say the ad account needs more information or is under review before a campaign can be created?',
    )
  )
    throw new Error(
      `META_ADS_ACCOUNT_BLOCKED: Meta's account setup or review blocks creating a campaign draft at ${url}`,
    );
  throw new Error(
    `META_ADS_FORM_NOT_REACHED: no campaign field was reached at ${url}; visible controls: ${JSON.stringify(await visibleControls(s))}`,
  );
}

export {
  chooseObjectiveAndContinue,
  openCampaignCreation,
  stagedDraftWithoutFields,
};
