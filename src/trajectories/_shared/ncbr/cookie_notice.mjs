// The LSI2 cookie notice, dismissed through the page's own control.
//
// NCBR scripts used to find the notice by the words 'pliki cookies' in any div
// and switch its pointer events off, which broke when the notice was reworded
// and could disable whatever other div held those words. The notice is now
// recognised and closed by the vision model through Jeden's Brama route: when
// the page shows a cookie notice, the control that accepts or closes it is
// pressed; a page that shows none is left as it is.

import { clickOffered } from '../page/judged/seen.mjs';

const NOTICE_CONTROL = 'the button that accepts or closes the cookie notice';

/** Close the cookie notice when the page shows one; whether it was closed. */
export async function dismissCookieNotice(page) {
  return clickOffered(page, NOTICE_CONTROL);
}
