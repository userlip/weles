// The browser this runner does not own. Every exchange with the keeper is one
// JSON line over its socket: the command, the settle after it, what the page
// currently shows, and the click or fill that changes it. Nothing here is
// retried behind the caller's back — a command the keeper refused comes back
// as an error.

import { keeperRequest } from '../../../../_shared/keeper/client.mjs';
import { SOCK, keywords } from './run_brief.mjs';

export async function action(cmd) {
  const answer = await keeperRequest(SOCK, cmd);
  if (!answer.ok)
    throw new Error(
      `keeper action ${cmd.action} failed: ${answer.error ? answer.error : 'the keeper gave no reason'}`,
    );
  return answer;
}

export async function idle() {
  await action({ action: 'settle' });
}

export async function nav(url) {
  await action({ action: 'nav', url });
  await idle();
}

/** Whether the keeper's settled page shows what `question` asks (yes/no). */
export async function shows(question) {
  return (await action({ action: 'shows', question })).shows;
}

/** Clicks the control `description` names; the keeper refuses when there is none. */
export async function clickDescribed(description) {
  console.log(`[google-ads-keyword-planner-keeper] clicking ${description}`);
  await action({ action: 'click_described', description });
  await idle();
}

/**
 * The page as the keeper's tab shows it: address, title, text, and its
 * fields with what they hold and whether the browser renders them. An
 * attribute a field does not carry reads as null.
 */
export async function evalState() {
  const res = await action({
    action: 'eval',
    js: `(() => ({
      url: location.href,
      title: document.title,
      text: document.body.innerText,
      inputs: Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"], [role="textbox"]')).map((el) => ({
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type'),
        name: el.getAttribute('name'),
        role: el.getAttribute('role'),
        aria: el.getAttribute('aria-label'),
        placeholder: el.getAttribute('placeholder'),
        value: typeof el.value === 'string' ? el.value : el.textContent,
        visible: el.checkVisibility({ checkOpacity: true, visibilityProperty: true }),
      })),
    }))()`,
  });
  if (!res.result)
    throw new Error(
      'keeper ran the page-state script but answered with no document; the tab did not report its state',
    );
  return res.result;
}

// The planner's keyword box is the form's visible text area - the same field
// chooseVolumeMode waits for. The box counts as filled when the value it
// reports is the text this run sent (a box that drops the line breaks still
// reports its start). If nothing on screen reports that, the form is not the
// one this run was written against.
export async function fillKeywordInput() {
  const text = keywords.join('\n');
  console.log('[google-ads-keyword-planner-keeper] filling keyword input');
  await action({ action: 'fill', selector: 'textarea', text });
  await idle();
  const state = await evalState();
  const landed = state.inputs.some(
    (input) => input.value && text.startsWith(input.value),
  );
  if (!landed) {
    throw new Error(
      `keyword box did not take the ${keywords.length} keyword(s) of this run; the form on screen is not the keyword entry form`,
    );
  }
}

// Google Ads opens notification, setup and app-promotion dialogs over the
// planner; each closes on Escape, as for a person, so no dialog is looked up
// by its wording.
export async function dismissChrome() {
  await action({ action: 'press', key: 'Escape' });
  await idle();
}
