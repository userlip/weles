// Capturing a credential a provider page shows and storing it in the one
// Skarbiec item the task's acquisition constraints name. The capture reads
// only pages and frames on the authorized origin, and takes the first value
// with the contract's shape from the element the caller's target names (a
// selector, a label or a textbox name) or, failing that, from any input,
// textarea, code or pre element of those frames: the shape check decides,
// never the words in an element's attributes.

import { constants, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runRecordingsDir } from '../../run-recordings.js';
import type { WSession } from '../../wsession.js';
import {
  acquiredSecretContract,
  isWelesAcquiredSecretValue,
  isWelesAcquiredSourceOrigin,
  writeWelesAcquiredSecret,
  type WelesAcquiredSecret,
} from '../../../secrets/scoped-service.js';
import { isRequestId } from '../../../secrets/request-id.js';
import type {
  CredentialFrame,
  CredentialLocator,
  CredentialPage,
} from './page.js';
import {
  credentialConstraintsText,
  isSkarbiecCredentialTask,
  type CredentialFieldClass,
  type StoreConstraints,
} from './task.js';

/** The operations a credential storage request may name. */
const STORE_OPERATIONS: Readonly<Record<string, true>> = {
  acquire: true,
  rotate: true,
  verify: true,
};

/** The field classes of the contract fields a credential is stored in. */
const FIELD_CLASS: Readonly<Record<string, CredentialFieldClass>> = {
  api_key: 'api-key',
  password: 'password',
  token: 'token',
};

/** The elements a credential is shown in when the target names none that holds it. */
const SHOWN_IN = 'input, textarea, code, pre';

const ORIGIN_MISMATCH = 'credential source origin mismatch';
const NOT_FOUND =
  'credential element was not found or did not match the required secret shape';

/** A non-empty string, or undefined. */
function stated(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function storeConstraints(): StoreConstraints {
  const text = credentialConstraintsText();
  if (text === null) {
    throw new Error('credential storage constraints are absent from this task');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `credential storage constraints are not JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('credential storage constraints are not an object');
  }
  const record = raw as Record<string, unknown>;
  if (record.store_secret_target !== 'skarbiec') {
    throw new Error('credential storage is not authorized for this task');
  }
  const secretName = stated(record.secret);
  const itemId = stated(record.vault_item_id);
  const field = stated(record.vault_field);
  const sourceOrigin = stated(record.secret_source_origin);
  const contract = secretName ? acquiredSecretContract(secretName) : null;
  // A table contract pins the capture origin. A derived contract has none to pin:
  // Skarbiec records the signup origin declared for the acquire operation and
  // echoes it here, so that recorded value is the pin when there is one, and the
  // live page origin becomes the recorded provenance when the caller declared
  // none. The item and the field stay bound to the contract either way.
  if (
    !secretName ||
    !contract ||
    itemId !== contract.item ||
    field !== contract.field ||
    (contract.sourceOrigin === null
      ? sourceOrigin !== undefined && !isWelesAcquiredSourceOrigin(sourceOrigin)
      : sourceOrigin !== contract.sourceOrigin)
  ) {
    throw new Error(
      'credential storage target is not in the exact Weles acquisition allowlist',
    );
  }
  const fieldClass = Object.hasOwn(FIELD_CLASS, contract.field)
    ? FIELD_CLASS[contract.field]
    : undefined;
  if (!fieldClass)
    throw new Error(
      `credential storage field ${contract.field} has no field class: it is one of ${Object.keys(FIELD_CLASS).join(', ')}`,
    );
  const accountEmail = stated(record.account_email)?.trim().toLowerCase();
  if (fieldClass === 'password' && !accountEmail) {
    throw new Error(
      'password credential storage requires an exact account email',
    );
  }
  const requestId = record.request_id;
  const operation = stated(record.operation);
  if (
    !isRequestId(requestId) ||
    !operation ||
    !Object.hasOwn(STORE_OPERATIONS, operation)
  ) {
    throw new Error(
      'credential storage requires an exact request id and operation',
    );
  }
  return {
    secretName: secretName as WelesAcquiredSecret,
    itemId: contract.item,
    field: contract.field,
    fieldClass,
    sourceOrigin,
    declaredOrigin: contract.sourceOrigin === null ? sourceOrigin : undefined,
    tenantId: stated(record.tenant_id),
    accountEmail,
    requestId,
    operation,
  };
}

/** Whether `url` is on `origin`; a URL that does not parse is on none. */
function onOrigin(url: string, origin: string): boolean {
  return URL.canParse(url) && new URL(url).origin === origin;
}

/** The locators the caller's target names in `frame`, then every element a credential is shown in. */
function candidateLocators(
  frame: CredentialFrame,
  target: string,
): CredentialLocator[] {
  const named = [
    frame.getByLabel(target, { exact: false }),
    frame.getByRole('textbox', { name: target }),
  ];
  if (/^(#|\.|\[|input|textarea|code|pre)/.test(target.trim()))
    named.unshift(frame.locator(target));
  return [...named, frame.locator(SHOWN_IN)];
}

async function captureCandidate(
  session: WSession,
  target: string,
  secretName: WelesAcquiredSecret,
  sourceOrigin: string,
): Promise<Buffer> {
  const rootPage = session.page as CredentialPage;
  const pages = rootPage.context ? rootPage.context().pages() : [rootPage];
  const authorizedPages = pages.filter((page) =>
    onOrigin(page.url(), sourceOrigin),
  );
  if (!authorizedPages.length) throw new Error(ORIGIN_MISMATCH);
  const frames = authorizedPages
    .flatMap((page) => page.frames())
    .filter((frame) => onOrigin(frame.url(), sourceOrigin));
  for (const frame of frames) {
    for (const locator of candidateLocators(frame, target)) {
      for (const element of await locator.all()) {
        const shown = await element.evaluate((node: Element) =>
          node instanceof HTMLInputElement ||
          node instanceof HTMLTextAreaElement
            ? node.value
            : node.textContent,
        );
        if (!shown) continue;
        const secret = Buffer.from(shown.trim(), 'utf8');
        if (isWelesAcquiredSecretValue(secretName, secret)) return secret;
        secret.fill('\0');
      }
    }
  }
  throw new Error(NOT_FOUND);
}

export async function wsStoreCredential(
  session: WSession,
  target: string,
  fieldClass: CredentialFieldClass,
): Promise<string> {
  if (!target.trim()) throw new Error('credential target is empty');
  const constraints = storeConstraints();
  if (fieldClass !== constraints.fieldClass) {
    throw new Error(
      'credential field class does not match the exact Weles acquisition allowlist',
    );
  }

  const captureOrigin =
    constraints.sourceOrigin ??
    new URL((session.page as CredentialPage).url()).origin;
  if (!isWelesAcquiredSourceOrigin(captureOrigin)) {
    throw new Error(
      'credential capture origin is not one absolute https origin',
    );
  }
  const secret = await captureCandidate(
    session,
    target,
    constraints.secretName,
    captureOrigin,
  );
  try {
    writeWelesAcquiredSecret(
      constraints.secretName,
      constraints.field,
      secret,
      constraints.tenantId,
      {
        accountEmail: constraints.accountEmail,
        requestId: constraints.requestId,
        operation: constraints.operation,
        sourceOrigin: captureOrigin,
        declaredOrigin: constraints.declaredOrigin,
      },
    );
    writeFileSync(
      join(runRecordingsDir(), 'credential_capture.json'),
      JSON.stringify({
        requestId: constraints.requestId,
        operation: constraints.operation,
        vaultItemId: constraints.itemId,
        field: constraints.field,
        sourceOrigin: captureOrigin,
        storedAt: new Date().toISOString(),
      }),
      { mode: constants.S_IRUSR | constants.S_IWUSR },
    );
  } finally {
    secret.fill('\0');
  }
  return `credential stored in Skarbiec item ${constraints.itemId} field ${constraints.field}`;
}

/**
 * After a step of a credential task, store the credential the page now shows,
 * if it shows one: a page on another origin, or one showing no value of the
 * contract's shape yet, is not an error here, and the step goes on.
 */
export async function wsAutoStoreCredential(
  session: WSession,
): Promise<string | null> {
  if (!isSkarbiecCredentialTask()) return null;
  try {
    return await wsStoreCredential(
      session,
      'generated credential',
      storeConstraints().fieldClass,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === ORIGIN_MISMATCH || message === NOT_FOUND) return null;
    throw error;
  }
}
