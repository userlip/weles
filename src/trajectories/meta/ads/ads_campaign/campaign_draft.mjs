import { pageSettled } from '../../../_shared/page/settled.mjs';
import {
  clickDescribed,
  pageShows,
} from '../../../_shared/page/judged/seen.mjs';
// Getting from the campaign table into a draft, and refusing with evidence
// when we never got there.
//
// Ads Manager opens on a table, not on a form. This module presses Create (or
// recognises that ADS_URL already put us inside a draft), picks the objective,
// walks the campaign-setup step that sometimes appears in between, and - when
// the form never appeared - prints the controls that were on screen instead so
// the refusal can be read without a screenshot. Ads Manager speaks the
// account's language, so every control is found and every page state is
// judged by the vision model (`_shared/page/judged/seen.mjs`), never by the
// words one language prints.

import { CAMPAIGN_NAME, objectiveLabels } from './campaign_request.mjs';

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
  if (!asked) return false;
  await clickDescribed(
    s.page,
    'the button that continues past the campaign setup dialog',
  );
  return true;
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
    return true;
  }
  await clickDescribed(
    s.page,
    'the button in the Ads Manager campaigns toolbar that creates a new campaign',
  );
  return true;
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
      `[meta-ads] ${error.message}; visible controls: ${JSON.stringify(await visibleControlDebug(s))}`,
    );
  }
  await maybeContinueCampaignConfiguration(s);
}

// Diagnostics for a refusal: every visible control with its text and box.
// Listing the controls can itself fail, so the answer says which of the two it
// is and the refusal keeps its own message either way.
async function visibleControlDebug(s) {
  try {
    return await s.page.evaluate(() =>
      Array.from(
        document.querySelectorAll(
          'button,[role="button"],[role="radio"],[role="tab"],a',
        ),
      )
        .map((el) => {
          const r = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return {
            text: el.innerText.replace(/\s+/g, ' ').trim(),
            x: Math.round(r.left),
            y: Math.round(r.top),
            w: Math.round(r.width),
            h: Math.round(r.height),
            tag: el.tagName,
            role: el.getAttribute('role'),
            visible:
              !!r.width &&
              !!r.height &&
              style.display !== 'none' &&
              style.visibility !== 'hidden',
          };
        })
        .filter((e) => e.visible && e.text),
    );
  } catch (error) {
    return {
      ok: false,
      reason: `visible controls could not be listed: ${error.message}`,
    };
  }
}

// Never returns: either the draft is already staged and this is a PASS, or the
// run refuses. Exit code 2 marks the account-side blocks an operator has to
// clear by hand; 1 marks a form we simply did not reach.
async function reportDraftOutcomeWithoutFields(s, createClicked, filledCount) {
  await pageSettled(s.page);
  const url = s.page.url();
  const draftCampaignId = selectedCampaignId(url);
  if (
    createClicked &&
    draftCampaignId &&
    (await pageShows(
      s.page,
      'Does the page show the selected campaign as an unpublished draft?',
    ))
  ) {
    console.log(
      `PASS: staged Meta ads campaign draft "${CAMPAIGN_NAME}" (SUBMIT=0, campaign_id=${draftCampaignId})`,
    );
    process.exit(0);
  }
  if (
    await pageShows(
      s.page,
      'Does the page say the ad account needs more information or is under review before a campaign can be created?',
    )
  ) {
    console.log(
      `FAIL: Meta account setup/review blocks campaign draft creation (createClicked=${createClicked}, filled=${filledCount}, url=${url})`,
    );
    process.exit(2);
  }
  const controls = await visibleControlDebug(s);
  console.log(
    `[meta-ads] visible controls debug: ${controls.ok === false ? controls.reason : JSON.stringify(controls)}`,
  );
  console.log(
    `FAIL: Meta Ads campaign form was not reached (createClicked=${createClicked}, filled=${filledCount}, url=${url})`,
  );
  process.exit(1);
}

export {
  chooseObjectiveAndContinue,
  openCampaignCreation,
  reportDraftOutcomeWithoutFields,
};
