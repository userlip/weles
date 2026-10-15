// The Brave proof-of-work challenge: a registration form that computes its
// own solution in the page and enables its button when done. Nothing to
// solve remotely; the page itself is asked to report when the form changes.
//
// Every state is read from the form's structure: the solution field holding a
// value is the proof, a disabled button over an empty solution is the page
// still validating or calculating, and an alert element is the page's refusal.
// No word on the button decides anything.
import {
  DOCUMENT_REPLACED,
  readAcrossReplacement,
} from '../browser/settled.js';

type Page = any;

// Resolves in the page, on an animation frame, once the challenge form shows
// one of the outcomes the caller is watching for (or has gone away).
async function braveFormChanged(
  page: Page,
  phase: 'validation' | 'calculation',
): Promise<void> {
  await page.waitForFunction(
    (which: string) => {
      const solution = document.querySelector<HTMLInputElement>(
        'input[name="captchaSolution"]',
      );
      const button =
        document.querySelector<HTMLButtonElement>('#captcha-button');
      if (!solution || !button) return true;
      const form = button.closest('form');
      if (form && !form.checkValidity()) return true;
      const alerted = Array.from(
        document.querySelectorAll<HTMLElement>(
          '.alert, [role="alert"], .error',
        ),
      ).some((element) => element.innerText.trim() !== '');
      if (alerted && (which === 'validation' || !button.disabled)) return true;
      if (which === 'validation') return !button.disabled;
      return solution.value !== '';
    },
    phase,
    { polling: 'raf' },
  );
}

export interface BraveProofOfWorkState {
  present: boolean;
  formValid: boolean;
  buttonDisabled: boolean;
  solved: boolean;
  errorText: string;
  url: string;
}

export async function braveProofOfWorkState(
  page: Page,
): Promise<BraveProofOfWorkState | null> {
  return await page.evaluate(() => {
    const solution = document.querySelector<HTMLInputElement>(
      'input[name="captchaSolution"]',
    );
    const button = document.querySelector<HTMLButtonElement>('#captcha-button');
    if (!solution || !button) return null;
    const form = button.closest('form');
    const errorText = Array.from(
      document.querySelectorAll<HTMLElement>('.alert, [role="alert"], .error'),
    )
      .map((element) => element.innerText.trim())
      .filter(Boolean)
      .join(' ');
    return {
      present: true,
      formValid: form !== null && form.checkValidity(),
      buttonDisabled: button.disabled,
      solved: solution.value !== '',
      errorText,
      url: location.href,
    };
  });
}

export async function solveBraveProofOfWork(
  page: Page,
  initial: BraveProofOfWorkState,
): Promise<boolean> {
  let ready = initial;
  if (!ready.formValid) {
    console.log(
      '[captcha] Brave proof-of-work blocked: registration form is invalid',
    );
    return false;
  }

  if (ready.buttonDisabled && !ready.solved) {
    console.log(
      '[captcha] Brave proof-of-work waiting for registration validation',
    );
    await braveFormChanged(page, 'validation');
    const state = await braveProofOfWorkState(page);
    if (!state) return false;
    ready = state;
    if (!ready.formValid) {
      console.log(
        '[captcha] Brave proof-of-work blocked: registration form became invalid',
      );
      return false;
    }
    if (ready.errorText) {
      console.log(
        `[captcha] Brave proof-of-work validation failed: ${ready.errorText}`,
      );
      return false;
    }
  }

  if (ready.solved) return true;
  if (!ready.buttonDisabled) {
    await page.locator('#captcha-button').click();
    console.log('[captcha] Brave proof-of-work calculation started');
  }

  const initialURL = ready.url;
  for (;;) {
    // The form submitting itself replaces the document under the wait.
    if (
      (await readAcrossReplacement(page, () =>
        braveFormChanged(page, 'calculation'),
      )) === DOCUMENT_REPLACED
    )
      await page.waitForLoadState('domcontentloaded');
    const state = await braveProofOfWorkState(page);
    if (!state) {
      console.log(
        page.url() === initialURL
          ? '[captcha] Brave proof-of-work form disappeared after calculation'
          : '[captcha] Brave proof-of-work submitted the registration form',
      );
      return true;
    }
    if (state.solved) {
      console.log('[captcha] Brave proof-of-work solved');
      return true;
    }
    if (state.url !== initialURL) {
      console.log('[captcha] Brave proof-of-work navigated after submission');
      return true;
    }
    if (state.errorText && !state.buttonDisabled) {
      console.log(`[captcha] Brave proof-of-work failed: ${state.errorText}`);
      return false;
    }
    if (!state.formValid) {
      console.log(
        '[captcha] Brave proof-of-work blocked: registration form became invalid',
      );
      return false;
    }
  }
}
