// What a login account is, and how one subscription in the vault resolves to
// exactly one login: the subscription's own records first, then the logins
// that carry its account.
import { createHash } from 'node:crypto';
import { readDocument } from '../../state/skarbiec-records.js';
import {
  accountFromSubscriptionId,
  itemId,
  loginMethodDeclaration,
  providerName,
  sameAccount,
  tag,
  text,
  type Item,
} from './identity.js';

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

/** The providers Weles signs a subscription in for. */
const SUPPORTED_PROVIDERS: Readonly<Record<string, true>> = {
  claude: true,
  codex: true,
  kimi: true,
};

/** The kind of vault item that holds sign-in material. */
const LOGIN_KIND = 'login';

/** Whether a vault item is a login, by its kind or its legacy type. */
function isLogin(item: Item): boolean {
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
function subscriptionMetadata(
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

export function resolveAccount(
  subscription: Item,
  inventory: Item[],
  requested?: string | null,
): LoginAccount {
  const subscriptionItem = itemId(subscription);
  const subscriptionId = tag(subscription, 'brama:id:');
  const provider = providerName(tag(subscription, 'brama:provider:'));
  const context = subscriptionMetadata(subscription, inventory, provider);
  // Brama records the provider account a member belongs to as
  // `brama:account:<address>` on the subscription item (`brama subscription
  // attribute`, Brama Desktop's Record accounts, the renewal sweep). Read only
  // the item's context, a fleet whose members carry nothing else stayed
  // `subscription_identity_missing` however exactly Brama had recorded them.
  let accountRef =
    text(context.account_ref) || tag(subscription, 'brama:account:');
  const explicit =
    text(requested) ||
    text(context.login_item) ||
    tag(subscription, 'brama:login:');
  const sourceItem = text(context.source_item);
  const logins = inventory.filter(isLogin);
  const sourceLogin = logins.find((item) => itemId(item) === sourceItem);
  const named = explicit || (sourceLogin ? sourceItem : '');
  const available = (
    named ? logins.filter((item) => itemId(item) === named) : logins
  ).map((item) => ({ item, context: metadata(item) }));
  if (!accountRef && named && available.length === 1) {
    accountRef = text(available[0].context.account_ref);
  }
  if (!accountRef && !named) {
    const sameProvider = available.filter(
      (candidate) =>
        providerName(text(candidate.context.provider)) === provider,
    );
    const subscriptions = inventory.filter(
      (item) =>
        Array.isArray(item.tags) &&
        item.tags.includes('brama:subscription') &&
        providerName(tag(item, 'brama:provider:')) === provider,
    );
    if (subscriptions.length === 1 && sameProvider.length === 1) {
      accountRef = text(sameProvider[0].context.account_ref);
    }
  }
  if (!accountRef) {
    const sameProvider = available.filter(
      (candidate) =>
        providerName(text(candidate.context.provider)) === provider,
    );
    accountRef = accountFromSubscriptionId(subscriptionId, sameProvider);
    // A login row that declares no provider — which can be every row in a
    // fleet's vault — is invisible to the filter above, and every
    // member imported before accounts were recorded beside their grants
    // stayed `subscription_identity_missing` however exactly its own id
    // named the account. The suffix match is exact and yields nothing
    // unless one login's account matches it, so it is asked of every
    // login when the narrowed field answered nothing.
    if (!accountRef) {
      accountRef = accountFromSubscriptionId(subscriptionId, available);
    }
  }
  if (!accountRef) {
    const names = available.map(({ item }) => itemId(item));
    // The way out belongs in the sentence. A `brama subscription sign-in`
    // that printed the bare refusal left the logins to be found with
    // `skarbiec list`; and a vault whose rows declare no provider at all
    // would have every row named — captcha
    // solvers, proxies, an example row — which hides them again. A provider's
    // own logins are named when the vault declares any, and when it declares
    // none that is the finding, because it is what has to be repaired before
    // any sign-in can choose.
    const ofProvider = available
      .filter(
        (candidate) =>
          providerName(text(candidate.context.provider)) === provider,
      )
      .map(({ item }) => itemId(item));
    // Naming the way out is not the same as naming the command that takes
    // it: subscriptions can fail here every pass while the sentence leaves
    // the reader to discover that a subscription item's account is recorded
    // as a tag on that item.
    const recordIt =
      `record the account on the subscription item itself — ` +
      `brama subscription attribute ${provider === 'claude' ? 'claude-code' : provider} ` +
      `--gateway <gateway> reads it from the member's own grant and writes ` +
      `brama:account:<address> into the vault the gateway serves (Brama Desktop: ` +
      `Record accounts), or stado credentials item retag --host <VAULT HOST> ` +
      `${subscriptionItem} --tags "<its current tags>,brama:login:<login item>"`;
    const remedy = ofProvider.length
      ? `name one of this provider's logins with --login-item: ${ofProvider.join(', ')}; ` +
        `or ${recordIt}`
      : names.length
        ? `no login item in this vault declares provider ${provider}, so none can be chosen ` +
          `for it: ${recordIt}, declare the provider on its login, or name one of the ` +
          `${names.length} logins explicitly with --login-item`
        : 'this vault holds no login item to name';
    fail(
      'subscription_identity_missing',
      `Skarbiec subscription ${subscriptionItem} has neither an account identity nor an ` +
        `unambiguous login reference; ${remedy}`,
      {
        subscription_id: subscriptionId,
        subscription_item: subscriptionItem,
        login_items: names,
        provider_login_items: ofProvider,
      },
    );
  }
  const candidates = available.filter((candidate) =>
    sameAccount(text(candidate.context.account_ref), accountRef),
  );
  // A provider-specific login takes precedence over a shared SSO login for the
  // same principal. Neither provider nor principal is inferred from an item name.
  const direct = candidates.filter(
    (candidate) => providerName(text(candidate.context.provider)) === provider,
  );
  const google = candidates.filter(
    (candidate) => candidate.context.login_method === 'google_sso',
  );
  // A row that declares no provider is not a row for another provider. When
  // the account is settled and nothing of this provider or of Google claims
  // it, the rows that carry that account ARE its login material; otherwise
  // a vault holding exactly such rows refuses every held member with
  // `skarbiec_login_missing` one step after its account has been resolved
  // from its own id.
  const unclaimed = candidates.filter(
    (candidate) => !text(candidate.context.provider),
  );
  const eligible = direct.length
    ? direct
    : google.length
      ? google
      : named
        ? candidates
        : unclaimed;
  const credentials = new Set(
    eligible.map((candidate) => candidate.context.credentialDigest),
  );
  const authenticators = new Set(
    eligible
      .map((candidate) => candidate.context.authenticatorDigest)
      .filter(Boolean),
  );
  if (!eligible.length || credentials.size !== 1 || authenticators.size > 1) {
    fail(
      eligible.length ? 'skarbiec_login_ambiguous' : 'skarbiec_login_missing',
      `Skarbiec subscription ${subscriptionItem} identifies ${accountRef}, but its login material is ${eligible.length ? 'inconsistent across matching records' : 'missing'}`,
      {
        subscription_id: subscriptionId,
        subscription_item: subscriptionItem,
        account_ref: accountRef,
        candidates: eligible.map(({ item }) => itemId(item)),
      },
    );
  }
  // Equivalent records describe the same principal and credential, not
  // different accounts. Prefer one carrying the stored authenticator, then
  // its immutable identity so renaming does not elect a different credential.
  eligible.sort(
    (left, right) =>
      Number(Boolean(right.context.authenticatorDigest)) -
        Number(Boolean(left.context.authenticatorDigest)) ||
      String(left.item.item_uid ?? itemId(left.item)).localeCompare(
        String(right.item.item_uid ?? itemId(right.item)),
      ),
  );
  const login = eligible[0];
  const method = text(login.context.login_method) || text(context.login_method);
  if (!LOGIN_METHODS.includes(method))
    fail(
      'login_method_unsupported',
      `Skarbiec login ${itemId(login.item)} declares unsupported login_method ${method || '(absent)'}; declare how to sign in with \`${loginMethodDeclaration(login.item)}\``,
      {
        subscription_id: subscriptionId,
        login_item: itemId(login.item),
        login_method: method,
      },
    );
  if (!Object.hasOwn(SUPPORTED_PROVIDERS, provider))
    fail(
      'subscription_provider_unsupported',
      `Skarbiec subscription ${subscriptionItem} declares unsupported provider ${provider}`,
      { subscription_id: subscriptionId, provider },
    );
  const revision = createHash('sha256')
    .update(
      JSON.stringify([
        subscription.item_uid ?? subscriptionItem,
        subscription.revision,
        login.item.item_uid ?? itemId(login.item),
        login.item.revision,
        method,
        context.source_revisions,
      ]),
    )
    .digest('hex');
  return {
    provider: provider as LoginAccountProvider,
    subscriptionId,
    subscriptionItem,
    loginItem: itemId(login.item),
    displayName: text(context.name) || accountRef,
    accountRef,
    loginMethod: method,
    accountRevision: revision,
  };
}
