// The two questions the Accounts Center phone flow asks of the page - whether
// it asks for the SMS code, and whether it offers the phone-number form -
// answered by the vision model (`_shared/page/judged/seen.mjs`) in the
// account's language.
import { pageShows } from '../../../_shared/page/judged/seen.mjs';

/** Whether the page asks for the confirmation code sent to the phone. */
export function asksForCode(page) {
  return pageShows(
    page,
    'Does the page ask for a confirmation code that was sent to a phone number?',
  );
}

/** Whether the page shows the form for entering a phone number. */
export function offersPhoneForm(page) {
  return pageShows(
    page,
    'Does the page show a form for entering a mobile phone number?',
  );
}
