// How this login reads a live page and fills a field on it.
//
// Google's and OpenAI's sign-in surfaces are WIZ/React documents whose fields
// ignore keystrokes until their handlers are bound and are replaced by the
// next redirect. So a read that lost its document means "look again", and a
// fill is verified by reading the value back. Controls are not found by what
// they say here: forms submit on Enter, and a control is found by the vision
// model (`_shared/page/judged/seen.mjs`).
import {
  DOCUMENT_REPLACED,
  readAcrossNavigation,
} from '../../_shared/page/navigation/read.mjs';

// In an OAuth redirect chain a navigation mid-call is the EXPECTED
// transition, so in poll loops a read whose document was replaced means
// "not ready, re-poll the new document", never a fatal error.
export async function navEval(page, fn, dflt, arg) {
  const value = await readAcrossNavigation(page, () => page.evaluate(fn, arg));
  return value === DOCUMENT_REPLACED ? dflt : value;
}

// Email/password fields: humanType (CDP default = page.keyboard.type
// per char) emits the full keydown/keyup/input sequence, which
// Google's WIZ validator needs to enable Next. Input.insertText emits only
// input and does not supply that sequence. Keystrokes go to the focused
// element, so the field must hold focus before typing: a pointer click that
// lands on a control drawn over the field (Google's identifier page shows its
// floating label there) leaves focus elsewhere and every keystroke is lost.
// The field is then focused directly, and a field that still does not hold
// focus is named in the failure. Throw if the value is not retained.
export async function fillAndVerify(
  page,
  locator,
  text,
  humanClickLocator,
  humanType,
) {
  const editable = locator.and(
    page.locator(
      'input:enabled:not([readonly]), textarea:enabled:not([readonly])',
    ),
  );
  await editable.waitFor({ state: 'visible' });
  await humanClickLocator(page, editable);
  const focused = () =>
    editable.evaluate(
      (element) => element === element.ownerDocument.activeElement,
    );
  if (!(await focused())) {
    await editable.focus();
  }
  if (!(await focused())) {
    throw new Error(
      'fillAndVerify: the field did not take focus after a pointer click and a focus call; keystrokes would be lost',
    );
  }
  await humanType(page, text);
  const actual = await locator.inputValue();
  if (actual !== text) {
    throw new Error(
      `fillAndVerify: value mismatch after input dispatch; observed length=${actual.length}, expected length=${text.length}`,
    );
  }
}
