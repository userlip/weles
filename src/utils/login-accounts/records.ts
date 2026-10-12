// What a login account is, how a refusal to resolve one is reported, and
// what one vault item and the subscription's chain of source items declare
// about the login behind it.
import { createHash } from 'node:crypto';
import { readDocument } from '../../state/skarbiec-records.js';
import { itemId, providerName, tag, text, type Item } from './identity.js';

export type LoginAccountProvider = 'claude' | 'codex' | 'kimi';

/** A projection of Skarbiec records, never a separately registered Weles account. */
export interface LoginAccount {
  loginItem: string;
  provider: LoginAccountProvider;
  displayName: string;
  subscriptionId: string;
  subscriptionItem: string;
  accountRef: string;
  loginMethod: string;
  accountRevision: string;
}

/** How a login row may sign in: through Google, with a password, or with the
 * one-time code the provider mails to an inbound address Weles reads (the
 * accounts an acquisition buys). */
export const LOGIN_METHODS = ['google_sso', 'email_password', 'email_code'];

/** The kind of vault item that holds sign-in material. */
const LOGIN_KIND = 'login';

/** Whether a vault item is a login, by its kind or its legacy type. */
export function isLogin(item: Item): boolean {
  return item.kind === LOGIN_KIND || item.type === LOGIN_KIND;
}

export class LoginAccountSelectionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly detail: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'LoginAccountSelectionError';
  }
}

export function fail(
  code: string,
  message: string,
  detail: Record<string, unknown>,
): never {
  throw new LoginAccountSelectionError(code, message, detail);
}

export function metadata(
  item: Item,
  provider = providerName(tag(item, 'brama:provider:')),
): Item {
  const document = readDocument(itemId(item));
  const context = document.context ?? {};
  let value = document.fields?.value;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      value = undefined;
    }
  }
  let declared = value?.metadata;
  if (typeof declared === 'string') declared = JSON.parse(declared);
  return {
    ...context,
    login_method:
      text(context.login_method) || tag(item, 'weles:login-method:'),
    login_item:
      text(context.login_item) ||
      text(declared?.login_item) ||
      text(declared?.[`${provider.toUpperCase()}_SERVICE_CREDENTIAL_ID`]),
    account_ref: text(context.account_ref) || text(document.fields?.username),
    credentialDigest: createHash('sha256')
      .update(
        JSON.stringify([
          document.fields?.username?.toLowerCase(),
          document.fields?.password,
        ]),
      )
      .digest('hex'),
    authenticatorDigest: document.fields?.totp_secret
      ? createHash('sha256').update(document.fields.totp_secret).digest('hex')
      : null,
  };
}

/** A subscription can name a canonical descriptor which names its login. */
export function subscriptionMetadata(
  subscription: Item,
  inventory: Item[],
  provider: string,
): Item {
  const result = metadata(subscription);
  const visited = new Set([itemId(subscription)]);
  const revisions: unknown[] = [];
  let source = text(result.source_item);
  while (source && !text(result.account_ref) && !text(result.login_item)) {
    if (visited.has(source))
      fail(
        'subscription_source_cycle',
        `Skarbiec subscription ${itemId(subscription)} has a cyclic source reference at ${source}`,
        { subscription_item: itemId(subscription), source_item: source },
      );
    visited.add(source);
    const item = inventory.find(
      (candidate) =>
        itemId(candidate) === source || candidate.item_uid === source,
    );
    if (!item)
      fail(
        'subscription_source_missing',
        `Skarbiec subscription ${itemId(subscription)} names missing source item ${source}`,
        { subscription_item: itemId(subscription), source_item: source },
      );
    const declared = metadata(item, provider);
    revisions.push([item.item_uid ?? itemId(item), item.revision]);
    if (isLogin(item)) {
      result.login_item = itemId(item);
    } else {
      result.login_item = text(declared.login_item);
    }
    result.account_ref = text(declared.account_ref);
    source = text(declared.source_item);
  }
  result.source_revisions = revisions;
  return result;
}
