// Credential and identity fills: the value never reaches the model or the
// log, only the page field the capability was minted for. Split out of
// finalize.ts, which keeps the click, fill and close primitives.
import {
  assertNonCredentialInput,
  withCapability,
} from '../../../utils/capability.js';
import type { CapabilityRef } from '../../../utils/capability.js';
import type { WSession } from '../../wsession.js';
import type { ElementHandle, Page } from 'playwright';
import { fillPage } from './page_fill.js';
import { humanFill } from '../../../human/keyboard.js';
import { resolveObservedControl } from '../../observation/controls.js';

type CredentialFieldClass =
  | 'password'
  | 'email'
  | 'username'
  | 'token'
  | 'api-key';
type IdentityField =
  | 'email'
  | 'password'
  | 'username'
  | 'first_name'
  | 'last_name'
  | 'birth_month'
  | 'birth_day'
  | 'birth_year';

/**
 * What a field's own markup must declare to receive each credential class:
 * its input type, or a WHATWG autocomplete field name
 * (https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#autofill).
 * The page states what a field takes in its markup, whatever language its
 * label is in. A secret goes only into a field that masks it; email and
 * username are not secret, so any plain text input may take them too.
 */
interface DeclaredControl {
  types: Record<string, true>;
  autocomplete: Record<string, true>;
  plainText: boolean;
}

const CREDENTIAL_CONTROLS: Record<CredentialFieldClass, DeclaredControl> = {
  password: { types: { password: true }, autocomplete: {}, plainText: false },
  email: {
    types: { email: true },
    autocomplete: { email: true, username: true },
    plainText: true,
  },
  username: {
    types: {},
    autocomplete: { username: true, nickname: true, email: true },
    plainText: true,
  },
  token: {
    types: { password: true },
    autocomplete: { 'one-time-code': true },
    plainText: false,
  },
  'api-key': { types: { password: true }, autocomplete: {}, plainText: false },
};

/** The run identity fields that are secrets, and the class whose field they need. */
const IDENTITY_SECRETS: Partial<Record<IdentityField, CredentialFieldClass>> = {
  password: 'password',
};

/** Page protocols a credential may be typed into. */
const WEB_PROTOCOLS: Record<string, true> = { 'https:': true, 'http:': true };

function webOrigin(page: Page): string {
  const pageUrl = new URL(page.url());
  if (!Object.hasOwn(WEB_PROTOCOLS, pageUrl.protocol))
    throw new Error(
      `credential fill requires an HTTP(S) origin; the page is ${pageUrl.protocol} (${pageUrl.origin})`,
    );
  return pageUrl.origin;
}

/** The selectors that find a field declaring this class. */
function declaredSelectors(fieldClass: CredentialFieldClass): string[] {
  const declared = CREDENTIAL_CONTROLS[fieldClass];
  return [
    ...Object.keys(declared.types).map((type) => `input[type="${type}"]`),
    ...Object.keys(declared.autocomplete).map(
      (name) => `input[autocomplete~="${name}" i]`,
    ),
  ];
}

/**
 * Refuses, before any capability is redeemed, a bound field whose own markup
 * does not declare the class, naming what the field does declare.
 */
async function assertDeclaredControl(
  control: ElementHandle,
  fieldClass: CredentialFieldClass,
  target: string,
): Promise<void> {
  const seen = await control.evaluate((node) => {
    const element = node as Element;
    return {
      type:
        element instanceof HTMLInputElement
          ? element.type
          : element.tagName.toLowerCase(),
      autocomplete: element.hasAttribute('autocomplete')
        ? String(element.getAttribute('autocomplete'))
            .toLowerCase()
            .split(/\s+/)
        : [],
    };
  });
  const declared = CREDENTIAL_CONTROLS[fieldClass];
  const fits =
    Object.hasOwn(declared.types, seen.type) ||
    seen.autocomplete.some((name) =>
      Object.hasOwn(declared.autocomplete, name),
    ) ||
    (declared.plainText && seen.type === 'text');
  if (!fits)
    throw new Error(
      `[credential_target_mismatch] ${JSON.stringify(target)} is a ${seen.type} control with autocomplete ${JSON.stringify(seen.autocomplete)}; a ${fieldClass} goes only into a field whose markup declares input type ${JSON.stringify(Object.keys(declared.types))} or autocomplete ${JSON.stringify(Object.keys(declared.autocomplete))}${declared.plainText ? ' or into a plain text input' : ''}. The capability was not consumed`,
    );
}

export class CredentialFillError extends Error {
  readonly code = 'CREDENTIAL_FILL_FAILED';

  constructor(state: string, origin: string, target: string) {
    super(
      `credential fill at ${origin} for ${JSON.stringify(target)}: ${state}; the capability must not be retried`,
    );
    this.name = this.code;
  }
}

// The marker a declined credential fill returns. Not an error: the capability
// is still unspent, so the field can be filled once it exists. A sign-in page
// renders its input after load and a two-step flow puts the password on a
// page that does not exist yet; the caller waits for that page (`wait_for`)
// and fills again instead of this lookup polling for it.
export const CREDENTIAL_FIELD_ABSENT = 'credential-field-absent';

// Resolve and retain the exact node before redeeming. The old presence probe
// and generic fill used different selectors and could fall back to a visual
// guess after the one-shot capability had already been spent.
async function credentialField(
  page: Page,
  target: string,
  allowedOrigin: string,
  fieldClass: CredentialFieldClass,
): Promise<ElementHandle | null> {
  const observed = await resolveObservedControl(page, target, allowedOrigin);
  if (observed) return observed;
  const explicitSelector = target
    .trim()
    .match(/^(?:input|textarea)(?:\[[^\]]+\])+/)?.[0];
  const description = explicitSelector
    ? target.slice(explicitSelector.length)
    : target;
  const kws = description
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 2);
  const sels = [
    ...declaredSelectors(fieldClass),
    ...kws.flatMap((k) =>
      ['input', 'textarea', '[contenteditable]'].flatMap((t) => [
        `${t}[name*="${k}"]`,
        `${t}[placeholder*="${k}" i]`,
        `${t}[aria-label*="${k}" i]`,
      ]),
    ),
  ];
  const frames = page
    .frames()
    .filter((frame) => new URL(frame.url()).origin === allowedOrigin);
  const queries = explicitSelector ? [explicitSelector] : [null, ...sels];
  for (const selector of queries) {
    const handles: ElementHandle[] = [];
    let selected: ElementHandle | null = null;
    try {
      for (const frame of frames) {
        const locator = selector
          ? frame.locator(selector)
          : frame.getByLabel(target, { exact: false });
        handles.push(...(await locator.elementHandles()));
      }
      for (const handle of handles) {
        if (!(await handle.isVisible()) || !(await handle.isEditable()))
          continue;
        if (selected)
          throw new Error(
            `[credential_target_ambiguous] Multiple editable fields match ${JSON.stringify(target)}; capability not consumed`,
          );
        selected = handle;
      }
      if (selected) {
        handles.splice(handles.indexOf(selected), 1);
        return selected;
      }
    } finally {
      await Promise.all(handles.map((handle) => handle.dispose()));
    }
  }
  return null;
}

async function fillCredentialNode(
  page: Page,
  control: ElementHandle,
  target: string,
  origin: string,
  value: string,
): Promise<string> {
  if (!value)
    throw new CredentialFillError('empty credential material', origin, target);
  try {
    const ready = await control.evaluate((element) => ({
      connected: element.isConnected,
      origin: element.ownerDocument?.location.origin,
    }));
    if (
      !ready.connected ||
      ready.origin !== origin ||
      new URL(page.url()).origin !== origin
    ) {
      throw new CredentialFillError(
        'the bound page or field changed before input',
        origin,
        target,
      );
    }
    await humanFill(page, control, value);
    const matches = await control.evaluate(
      (element, expected) =>
        element.isConnected &&
        ('value' in element ? element.value : element.textContent) === expected,
      value,
    );
    if (!matches)
      throw new CredentialFillError(
        'the bound field did not retain the credential after typing',
        origin,
        target,
      );
    return 'credential filled and verified';
  } catch (error) {
    if (error instanceof CredentialFillError) throw error;
    // Input libraries can include the typed value in their errors. Keep only
    // the exception class at this secret boundary, never its message or stack.
    throw new CredentialFillError(
      `input or verification failed (${error instanceof Error ? error.name : 'unknown error'})`,
      origin,
      target,
    );
  }
}

export async function wsFillCredential(
  s: WSession,
  target: string,
  fieldClass: CredentialFieldClass,
  capability: CapabilityRef,
): Promise<string> {
  // Validate the origin, the field and the field's EXISTENCE before
  // withCapability: redeeming burns a one-shot capability and materializes the
  // plaintext secret. A non-HTTP(S) page, a field that is not on this page, or
  // a field whose markup does not declare the class must be refused while no
  // secret exists.
  //
  // The existence check is not fussiness. Google's sign-in puts the password on
  // a second page, so prefilling both at load spent the password capability on
  // a field that could not exist yet, and the agent that reached the password
  // page was then denied for a capability it had never used.
  const page: Page = s.page;
  const origin = webOrigin(page);
  const control = await credentialField(page, target, origin, fieldClass);
  if (!control) return CREDENTIAL_FIELD_ABSENT;
  try {
    if (!(await control.isVisible()) || !(await control.isEditable()))
      throw new Error(
        `[credential_target_unusable] ${JSON.stringify(target)} is not a visible editable field; capability not consumed`,
      );
    await assertDeclaredControl(control, fieldClass, target);
    const expected = {
      purpose: 'weles.browser.fill' as const,
      resource: `origin:${origin}/${fieldClass}`,
    };
    return await withCapability(capability, expected, (secret) =>
      fillCredentialNode(page, control, target, origin, secret),
    );
  } finally {
    await control.dispose();
  }
}

/**
 * Fills one field from the run's generated identity. A secret identity field
 * (the password) goes through the same declared-markup check as a credential;
 * the others are the persona's own details and are filled by description,
 * never logged.
 */
export async function wsFillIdentity(
  s: WSession,
  target: string,
  field: IdentityField,
  value: string,
): Promise<string> {
  const page: Page = s.page;
  const origin = webOrigin(page);
  const secretClass = IDENTITY_SECRETS[field];
  if (secretClass !== undefined) {
    const control = await credentialField(page, target, origin, secretClass);
    if (!control) return CREDENTIAL_FIELD_ABSENT;
    try {
      await assertDeclaredControl(control, secretClass, target);
      return await fillCredentialNode(page, control, target, origin, value);
    } finally {
      await control.dispose();
    }
  }
  try {
    const result = await fillPage(s, target, value, origin, true);
    return result.startsWith('filled') ? `identity ${result}` : result;
  } catch (error) {
    // The fill error may carry the typed value; only its class leaves here.
    throw new CredentialFillError(
      `identity ${field} input failed (${error instanceof Error ? error.name : typeof error})`,
      origin,
      target,
    );
  }
}
