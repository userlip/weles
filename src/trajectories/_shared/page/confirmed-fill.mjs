// Replacing what a form field holds with stated text. humanFill clears the
// field and types through the humanized input path; the field is then read
// back, because a clear that did not take leaves the old value with the new
// text appended, and a save after it would publish that. Anything but the
// stated text refuses the run before any save.
import { humanFill } from '../../../../dist/human/keyboard.js';

export async function confirmedFill(page, field, text, what) {
  await humanFill(page, field, text);
  const held = await field.inputValue();
  if (held.trim() !== text.trim())
    throw new Error(
      `${what} holds ${held.length} characters, not the ${text.length} typed; nothing was saved`,
    );
  return held;
}
