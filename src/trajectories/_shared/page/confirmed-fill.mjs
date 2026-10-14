// Replacing what a form field holds with stated text. humanFill clears the
// field and types through the humanized input path; the field is then read
// back, because a clear that did not take leaves the old value with the new
// text appended, and a save after it would publish that. Anything but the
// stated text refuses the run before any save.
import { humanFill } from '../../../../dist/human/keyboard.js';

export async function confirmedFill(page, field, text, what) {
  await humanFill(page, field, text);
  const held = await field.inputValue();
  if (held !== text)
    throw new Error(
      `${what} differs after input: observed length=${held.length}, requested length=${text.length}; nothing was saved`,
    );
  return held;
}

// Whether a field is to be written: a value nobody stated leaves the field as
// it is (false); a stated value whose field the page does not show fails the
// run, instead of a PASS for a profile that was never updated.
export async function statedField(field, value, what) {
  if (!value) return false;
  if (!(await field.count()))
    throw new Error(
      `${what} is not on the page; the stated value was not written`,
    );
  return true;
}

// Typing into an empty field of a WIZ/React sign-in document (Google's,
// OpenAI's): humanType emits the full keydown/keyup/input sequence per
// character, which Google's WIZ validator needs to enable Next; insertText
// does not. Keystrokes go to the focused element, so the field must hold focus
// before typing: a pointer click that lands on a control drawn over the field
// (Google's identifier page shows its floating label there) leaves focus
// elsewhere and every keystroke is lost. The field is then focused directly, a
// field that still does not hold focus is named in the failure, and a value
// not retained refuses the run.
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
