// The legal-act row form, bound to the page: its diagnostics, the text-like fields, the act
// type and act autocomplete, saving, and filling a whole row.
import {
  humanClickLocator,
  humanIdlePause,
} from '../../../../../../dist/human/mouse.js';
import { humanFill } from '../../../../../../dist/human/keyboard.js';
import { pageShows } from '../../../../_shared/page/judged/seen.mjs';
import { rowAbout } from '../../../../_shared/page/judged/matched.mjs';
import { actSubject, target } from './source.mjs';

export function legalActForm({ page }) {
  async function diagForm(opened) {
    const form = await page.evaluate(
      ({ opened, target }) => ({
        opened,
        target,
        fields: Array.from(document.querySelectorAll('input, textarea'))
          .filter((el) => el.offsetParent !== null)
          .map((el) => {
            const label = el.id
              ? document
                  .querySelector(`label[for="${CSS.escape(el.id)}"]`)
                  ?.textContent?.trim()
              : null;
            const wrapper = el.closest(
              '.MuiFormControl-root, label, form, section, .MuiBox-root',
            );
            return {
              tag: el.tagName,
              type: el.type || '',
              name: el.name || '',
              role: el.getAttribute('role') || '',
              value: el.value || '',
              len: (el.value || '').length,
              max: el.getAttribute('maxlength'),
              label,
              nearby: wrapper
                ? wrapper.textContent.trim().replace(/\s+/g, ' ')
                : '',
              readOnly: el.readOnly,
              disabled: el.disabled,
            };
          }),
        buttons: Array.from(document.querySelectorAll('button'))
          .map((button) => ({
            text: button.innerText.trim(),
            disabled: button.disabled,
          }))
          .filter((button) => button.text),
      }),
      { opened, target },
    ); // allow-raw-playwright: inspect legal-act edit form only
    console.log(JSON.stringify(form, null, 2));
  }

  async function fillTextLikeField(predicate, value) {
    const result = await page.evaluate(
      ({ predicateSource, value }) => {
        const predicate = new Function(
          'el',
          `return (${predicateSource})(el);`,
        );
        const fields = Array.from(
          document.querySelectorAll('input, textarea'),
        ).filter(
          (el) => el.offsetParent !== null && !el.disabled && !el.readOnly,
        );
        const field = fields.find((el) => predicate(el));
        if (!field)
          return {
            filled: false,
            fields: fields.map((el) => ({
              name: el.name || '',
              value: el.value || '',
              tag: el.tagName,
              role: el.getAttribute('role') || '',
            })),
          };
        // A value the field cannot hold is refused with both lengths: cutting
        // it at a word would file a shortened justification nobody wrote.
        const declared = field.getAttribute('maxlength');
        const next = String(value);
        if (declared !== null && next.length > Number(declared))
          return {
            filled: false,
            name: field.name,
            valueLength: next.length,
            max: Number(declared),
            reason: 'the value is longer than the field takes',
          };
        const setter = Object.getOwnPropertyDescriptor(
          Object.getPrototypeOf(field),
          'value',
        )?.set;
        if (setter) setter.call(field, next);
        else field.value = next;
        field.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            inputType: 'insertText',
            data: next,
          }),
        );
        field.dispatchEvent(new Event('change', { bubbles: true }));
        field.dispatchEvent(new Event('blur', { bubbles: true }));
        return {
          filled: true,
          name: field.name || '',
          valueLength: next.length,
          max: declared,
        };
      },
      { predicateSource: predicate.toString(), value },
    ); // allow-raw-playwright: fill visible legal-act text field through DOM setter
    await humanIdlePause('short');
    return result;
  }

  async function setActTypeIfPresent() {
    const input = page
      .locator('input[role="combobox"]')
      .filter({ hasText: '' })
      .first();
    if ((await input.count()) === 0) return { skipped: 'no combobox' };
    if (
      !(await pageShows(
        page,
        'Does the form ask for the type of the legal act in a dropdown?',
      ))
    )
      return { skipped: 'the form asks for no legal-act type' };
    await humanFill(page, input, 'Pozostałe inne');
    await humanIdlePause('deliberate');
    const option = page
      .locator("[role='listbox'] [role='option'], [role='option']")
      .filter({ hasText: 'Pozostałe inne' })
      .first();
    if ((await option.count()) === 0)
      return { skipped: 'Pozostałe inne option not found' };
    await option.dispatchEvent('click'); // allow-raw-playwright: select legal-act type
    await humanIdlePause('short');
    return { selected: 'Pozostałe inne' };
  }

  // The form's own option for an act its list does not carry; such a row
  // names the act in its justification instead.
  const OTHER_ACT_OPTION = 'inne (w polu uzasadnienie wpisz jakie)';

  /**
   * Picks the act of `row` in the autocomplete. The list is searched with
   * the act's own title, and which offered option is that act is judged by
   * the model over the options' text, however the list spells the statute.
   */
  async function setLegalAct(row) {
    const input = page.locator('input[name="akt_prawny"]').first();
    await input.waitFor({ state: 'visible' });
    const other = row.kind === 'inne';
    const search = other ? OTHER_ACT_OPTION : row.act;
    await humanFill(page, input, search);
    await humanIdlePause('deliberate');
    const options = page.locator(
      "[role='listbox'] [role='option'], [role='option']",
    );
    const seen = (await options.allTextContents())
      .map((text) => text.trim())
      .filter(Boolean);
    const subject = other
      ? `the option "${OTHER_ACT_OPTION}"`
      : actSubject(row);
    const index = await rowAbout(seen, subject);
    if (index === null)
      throw new Error(
        `legal act option not found: ${row.act}; searched "${search}"; seen=${seen.join(' | ')}`,
      );
    const picked = seen[index];
    await options.filter({ hasText: picked }).first().dispatchEvent('click'); // allow-raw-playwright: select legal-act option
    await humanIdlePause('short');
    return picked;
  }

  async function saveRow() {
    await humanIdlePause('deliberate');
    await humanIdlePause('deliberate');
    const buttons = page
      .getByRole('button', { name: 'Zapisz', exact: true })
      .filter({ visible: true });
    const count = await buttons.count();
    const state =
      count > 0
        ? { status: 'saved', errors: [] }
        : {
            status: 'no-enabled-save',
            errors: await page
              .locator('[aria-invalid="true"], .Mui-error')
              .allTextContents(),
          };
    if (count > 0) await humanClickLocator(page, buttons.nth(count - 1));
    await humanIdlePause('long');
    return state;
  }

  async function fillLegalActForm(row) {
    const picked = await setLegalAct(row);
    const justFill = await fillTextLikeField((el) => {
      const name = el.name || '';
      return name === 'uzasadnienie' || name.endsWith('.uzasadnienie');
    }, row.formJustification);
    if (!justFill.filled)
      throw new Error(
        `10.4 justification for ${row.act} not filled: ${JSON.stringify(justFill)}`,
      );
    const save = await saveRow();
    return { picked, justFill, save };
  }
  return {
    diagForm,
    fillTextLikeField,
    setActTypeIfPresent,
    setLegalAct,
    saveRow,
    fillLegalActForm,
  };
}
