// A row's menu in LSI (NCBR's application system): its edit and delete items,
// and the confirmation LSI asks for before a deletion. All are found by the
// vision model, which reads LSI's copy in whatever language and spelling it
// ships, instead of a list of the words a release happened to use.

import { clickDescribed, clickOffered } from '../page/judged/seen.mjs';

/** Clicks the edit (or details) item of the open row menu; throws naming the page when there is none. */
export function chooseEditInRowMenu(page) {
  return clickDescribed(
    page,
    'the item of the open row menu that edits or opens the row',
  );
}

/** Clicks the delete item of the open row menu; throws naming the page when there is none. */
export function chooseDeleteInRowMenu(page) {
  return clickDescribed(page, 'the delete item of the open row menu');
}

/** Confirms the deletion when LSI asks for it; says whether it asked. */
export function confirmDeletion(page) {
  return clickOffered(
    page,
    'the button in the dialog that confirms deleting the row',
  );
}
