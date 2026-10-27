/**
 * The browser tools the agent loop offers the model, as function-tool
 * declarations; ../tools.ts dispatches each call to its WSession method.
 */

import type { WelesCapabilityPurpose } from '../../utils/capability.js';
import type { IdentityField } from '../../session/identity/generated.js';
import type { FunctionTool } from '../model/router-call.js';

export type CredentialFieldClass =
  | 'password'
  | 'email'
  | 'username'
  | 'token'
  | 'api-key';

export const CAPABILITY_PURPOSES: Record<WelesCapabilityPurpose, true> = {
  'weles.browser.fill': true,
  'weles.captcha.solve': true,
  'weles.sms.verify': true,
  'weles.apple.2fa': true,
  'weles.proxy.authenticate': true,
  'weles.brama.sign': true,
};

export const CREDENTIAL_FIELD_CLASSES: Record<CredentialFieldClass, true> = {
  password: true,
  email: true,
  username: true,
  token: true,
  'api-key': true,
};

export const IDENTITY_FIELDS: Record<IdentityField, true> = {
  email: true,
  password: true,
  username: true,
  first_name: true,
  last_name: true,
  birth_month: true,
  birth_day: true,
  birth_year: true,
};

const TEXT = { type: 'string' };
const NUMBER = { type: 'number' };
const TARGET = {
  type: 'string',
  description:
    'The element description or selector. For click, copy the complete observed CONTROLS entry, including every field and its optional [index]. Never supply an index alone or an object.',
};
const CAPABILITY = {
  type: 'object',
  description:
    'Copy the supplied opaque capability reference exactly. Never invent or alter its id, purpose, resource or target.',
  properties: {
    capability_id: TEXT,
    purpose: { type: 'string', enum: Object.keys(CAPABILITY_PURPOSES) },
    resource: TEXT,
    target: { type: 'string', enum: ['weles'] },
  },
  required: ['capability_id', 'purpose', 'resource', 'target'],
  additionalProperties: false,
};

/** A tool whose listed `required` properties must be given; every property when the list is not stated. */
function browserTool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required?: string[],
): FunctionTool {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: {
        type: 'object',
        properties,
        required: required === undefined ? Object.keys(properties) : required,
        additionalProperties: false,
      },
    },
  };
}

// Both are required: a number is only bought in a country the task named.
const SMS_ARGS = { service: TEXT, country: TEXT };

export const BROWSER_TOOLS: readonly FunctionTool[] = [
  browserTool(
    'click',
    'Click an element. Prefer the complete current CONTROLS entry; preserve its tag and every reported field, including [index] when present. An explicit selector must match exactly one visible control and never falls back to an image guess. Otherwise describe the actual element in plain English.',
    { target: TARGET },
  ),
  browserTool(
    'fill',
    'Fill a literal value only into a non-credential field. The actual field is checked; a selector cannot bypass its credential requirement. Environment placeholders are forbidden.',
    { target: TARGET, value: TEXT },
  ),
  browserTool(
    'fill_credential',
    'Fill an authorized credential field using its supplied opaque capability. Point the target at the actual field; its own markup must declare the class (a password, token or API key only into a masked input). Never request or provide plaintext credentials.',
    {
      target: TARGET,
      field_class: {
        type: 'string',
        enum: Object.keys(CREDENTIAL_FIELD_CLASSES),
        description:
          'Use the class bound by the supplied capability, not a class guessed from its value. Keep its resource unchanged.',
      },
      capability: CAPABILITY,
    },
  ),
  browserTool(
    'fill_identity',
    'Fill one field from the current run-generated identity without exposing its value.',
    {
      target: TARGET,
      field: { type: 'string', enum: Object.keys(IDENTITY_FIELDS) },
    },
  ),
  browserTool(
    'store_credential',
    'Store a newly issued token or API key directly in the task-authorized Skarbiec item. Never read or return its value.',
    {
      target: TARGET,
      field_class: { type: 'string', enum: ['token', 'api-key'] },
    },
  ),
  browserTool(
    'focus',
    'Focus an input by name, type or placeholder, including shadow DOM.',
    { selector: TEXT },
  ),
  browserTool(
    'type_text',
    'Type literal non-credential text after focusing a non-credential field. The focused field is checked, including inside frames and shadow roots. Never use this to work around fill_credential refusal.',
    { value: TEXT },
  ),
  browserTool(
    'press_key',
    'Press a keyboard key such as Enter, Tab or Escape.',
    { key: TEXT },
  ),
  browserTool('navigate', 'Navigate to the supplied URL.', { url: TEXT }),
  browserTool(
    'scroll',
    'Scroll the actual page up or down, by a number of pixels when one is given.',
    { direction: { type: 'string', enum: ['up', 'down'] }, amount: NUMBER },
    ['direction'],
  ),
  browserTool(
    'wait_for',
    'Wait until the element matching a CSS selector reaches a Playwright locator state (attached, visible, hidden or detached; default visible). Waits as long as the page takes; fails with the reason when the element cannot reach it.',
    { selector: TEXT, state: TEXT },
    ['selector'],
  ),
  browserTool(
    'read',
    'Answer a question using only the current screenshot. This cannot click, scroll, navigate or change page state.',
    { question: TEXT },
  ),
  browserTool(
    'select_option',
    'Select a dropdown option, including date pickers.',
    { target: TARGET, value: TEXT },
  ),
  browserTool(
    'set_control',
    'Set and verify a non-credential input, select or textarea by CSS selector in the page or an iframe. The actual field is checked; this is not a workaround for a credential refusal.',
    { selector: TEXT, value: {}, checked: { type: 'boolean' } },
    ['selector'],
  ),
  browserTool(
    'js_click',
    'Last resort: click by selector or text only after click, set_control, and focus with press_key cannot reach the element.',
    { selector: TEXT, text: TEXT },
    [],
  ),
  browserTool(
    'solve_captcha',
    'Solve a detected supported CAPTCHA and wait for automatic submission. Report failed or absent challenges honestly.',
    {},
  ),
  browserTool(
    'check_email',
    'Wait for the newest mail Skrzynka holds for the address (from a sender containing the hint, or any sender when the hint is empty) and return its sender, subject and text, so its code or link can be used.',
    { email: TEXT, sender: TEXT },
  ),
  browserTool(
    'generate_identity',
    'Generate an identity only for a task-authorized registration on the named platform.',
    {
      platform: TEXT,
    },
  ),
  browserTool(
    'check_sms',
    'Request an SMS number for the authorized service in the stated country code; an unsupported country is refused with the supported list.',
    SMS_ARGS,
  ),
  browserTool(
    'poll_sms_code',
    'Wait for the code texted to the number check_sms rented and return it; a provider that cancels the order or fails is reported with its answer.',
    {},
  ),
  browserTool(
    'save_account',
    'Save a task-authorized newly registered account.',
    { platform: TEXT, username: TEXT, email: TEXT, password: TEXT, name: TEXT },
    ['platform', 'username', 'email', 'password'],
  ),
  browserTool(
    'done',
    'Finish only when all goal conditions are confirmed by actual action results and the current page.',
    { value: {} },
    [],
  ),
  browserTool(
    'give_up',
    'Stop when the goal cannot be completed; report the actual refusal and missing prerequisite.',
    { reason: TEXT },
  ),
];

/**
 * Tools whose call is a judgement of the page as it is now: `read` answers
 * from the current screenshot and `done` claims the goal is met. A replay
 * never reuses a recorded one; the model decides it again on the live page.
 */
export const DECIDED_ON_LIVE_PAGE: Readonly<Record<string, true>> = {
  read: true,
  done: true,
};
