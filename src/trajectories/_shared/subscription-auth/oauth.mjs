import { createHash, randomBytes } from 'node:crypto';
import { constants as http } from 'node:http2';
import { describeError } from '../../../_shared/error-chain/index.cjs';

// Public OAuth clients and endpoints from the providers' authentication protocols.
// These exchanges never invoke a provider CLI or touch its local credential store.
const OPENAI = {
  origin: 'https://auth.openai.com',
  client: 'app_EMoamEEZ73f0CkXaXp7hrann',
};
const KIMI = {
  origin: 'https://auth.kimi.com',
  client: '17e5f671-d194-4dfb-9706-5516cb48c098',
};
const CLAUDE = {
  authorize: 'https://claude.ai/oauth/authorize',
  token: 'https://console.anthropic.com/v1/oauth/token',
  redirect: 'https://console.anthropic.com/oauth/code/callback',
  client: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
  scopes:
    'user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload',
};

// RFC 7636 section 4.1 recommends a verifier of as many random octets as the
// S256 challenge's SHA-256 digest holds; the state is drawn the same length.
const PKCE_OCTETS = createHash('sha256').digest().length;
// One second in Date's milliseconds, read from the clock's own epoch.
const MILLISECONDS_PER_SECOND = Date.parse('1970-01-01T00:00:01Z');
// OpenAI's device token endpoint answers a grant the user has not approved
// yet with these statuses.
const CODEX_PENDING = new Set([
  http.HTTP_STATUS_FORBIDDEN,
  http.HTTP_STATUS_NOT_FOUND,
]);

/** Each provider's authorize page, for callers that check a URL against it. */
export const AUTHORIZE_PAGES = { claude: CLAUDE.authorize };

export class AuthenticationFailure extends Error {
  // options is Error's own ({ cause }), so the failure keeps what it wraps.
  constructor(code, stage, message, status = null, options) {
    super(message, options);
    this.code = code;
    this.stage = stage;
    this.status = status;
  }
}

/** The exchange with `url` failed in transport, before an answer or while
 * reading its body (then with its status); the endpoint and cause stay. */
function transportFailure(url, error, status) {
  const failure = new AuthenticationFailure(
    'oauth_transport_failed',
    'oauth_exchange',
    `${url}: ${describeError(error)}`,
    status,
    { cause: error },
  );
  failure.endpoint = url;
  return failure;
}

async function post(url, payload, form = false) {
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'content-type': form
          ? 'application/x-www-form-urlencoded'
          : 'application/json',
      },
      body: form ? new URLSearchParams(payload) : JSON.stringify(payload),
    });
  } catch (error) {
    throw transportFailure(url, error, null);
  }
  // The body is read as text first so an answer that is not JSON reaches the
  // refusal whole, with the parse error; a lost connection is a transport one.
  let body;
  try {
    body = await response.text();
  } catch (error) {
    throw transportFailure(url, error, response.status);
  }
  let data;
  try {
    data = JSON.parse(body);
  } catch (error) {
    throw new AuthenticationFailure(
      'oauth_response_invalid',
      'oauth_exchange',
      `${url} answered HTTP ${response.status} with a body that is not JSON (${error.message}): ${body}`,
      response.status,
    );
  }
  return { status: response.status, ok: response.ok, data };
}

function accepted(answer, stage) {
  if (answer.ok) return answer.data;
  // A refusal names its cause in the provider's own field; one that names it
  // in none of them is passed on whole.
  const detail =
    answer.data.error_description ||
    answer.data.message ||
    answer.data.error?.message ||
    (typeof answer.data.error === 'string'
      ? answer.data.error
      : `HTTP ${answer.status} naming no cause in error_description, message or error: ${JSON.stringify(answer.data)}`);
  throw new AuthenticationFailure(
    'oauth_provider_refused',
    stage,
    String(detail),
    answer.status,
  );
}

function credential(provider, tokens, expectedEmail) {
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new AuthenticationFailure(
      'oauth_grant_incomplete',
      'grant_validation',
      'The provider did not return both an access token and a refresh token',
    );
  }
  if (provider === 'codex') {
    let identity;
    try {
      // A JWT is header.payload.signature (RFC 7519 section 7.2).
      const [, payload] = tokens.id_token.split('.');
      identity = JSON.parse(Buffer.from(payload, 'base64url').toString());
    } catch (error) {
      throw new AuthenticationFailure(
        'oauth_identity_missing',
        'grant_validation',
        `OpenAI did not return a readable identity token: ${describeError(error)}`,
      );
    }
    if (identity.email?.toLowerCase() !== expectedEmail.toLowerCase()) {
      throw new AuthenticationFailure(
        'oauth_identity_mismatch',
        'grant_validation',
        'The OpenAI grant belongs to a different account than the selected Skarbiec login',
      );
    }
    // Banked as OpenAI returned it; Brama reads the ChatGPT account from the
    // identity token when it calls the provider.
    return {
      auth_mode: 'chatgpt',
      tokens: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        id_token: tokens.id_token,
      },
      last_refresh: new Date().toISOString(),
    };
  }
  if (provider === 'claude') {
    const email = tokens.account?.email_address;
    if (email && email.toLowerCase() !== expectedEmail.toLowerCase()) {
      throw new AuthenticationFailure(
        'oauth_identity_mismatch',
        'grant_validation',
        'The Anthropic grant belongs to a different account than the selected Skarbiec login',
      );
    }
    return {
      claudeAiOauth: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: Date.now() + tokens.expires_in * MILLISECONDS_PER_SECOND,
        scopes: String(tokens.scope || CLAUDE.scopes).split(' '),
      },
    };
  }
  return {
    ...tokens,
    expires_at:
      Math.floor(Date.now() / MILLISECONDS_PER_SECOND) + tokens.expires_in,
  };
}

/** Start an OAuth transaction; only the approved Weles browser sees its URL/code. */
export async function beginOAuth(provider) {
  if (provider === 'claude') {
    const verifier = randomBytes(PKCE_OCTETS).toString('base64url');
    const state = randomBytes(PKCE_OCTETS).toString('base64url');
    const query = new URLSearchParams({
      client_id: CLAUDE.client,
      response_type: 'code',
      redirect_uri: CLAUDE.redirect,
      scope: CLAUDE.scopes,
      state,
      code: 'true',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    });
    return { provider, url: `${CLAUDE.authorize}?${query}`, verifier, state };
  }
  const configuration = provider === 'codex' ? OPENAI : KIMI;
  const path =
    provider === 'codex'
      ? '/api/accounts/deviceauth/usercode'
      : '/api/oauth/device_authorization';
  const data = accepted(
    await post(
      `${configuration.origin}${path}`,
      { client_id: configuration.client },
      provider === 'kimi',
    ),
    'device_authorization',
  );
  return {
    provider,
    data,
    url:
      provider === 'codex'
        ? `${OPENAI.origin}/codex/device`
        : data.verification_uri_complete,
    code: data.user_code || data.usercode,
  };
}

export async function finishOAuth(transaction, expectedEmail, displayedCode) {
  const { provider } = transaction;
  if (provider === 'claude') {
    const [code, state] = String(displayedCode).split('#');
    if (!code || state !== transaction.state) {
      throw new AuthenticationFailure(
        'oauth_state_mismatch',
        'oauth_callback',
        'The authorization callback does not match this login transaction',
      );
    }
    const tokens = accepted(
      await post(CLAUDE.token, {
        grant_type: 'authorization_code',
        client_id: CLAUDE.client,
        code,
        state,
        redirect_uri: CLAUDE.redirect,
        code_verifier: transaction.verifier,
      }),
      'token_exchange',
    );
    return credential(provider, tokens, expectedEmail);
  }
  // finishOAuth runs after the browser granted consent, so the provider has
  // the answer ready: one token request either returns the credential or
  // states why it did not.
  const { data } = transaction;
  const answer =
    provider === 'codex'
      ? await post(`${OPENAI.origin}/api/accounts/deviceauth/token`, {
          device_auth_id: data.device_auth_id,
          user_code: transaction.code,
        })
      : await post(
          `${KIMI.origin}/api/oauth/token`,
          {
            client_id: KIMI.client,
            device_code: data.device_code,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          },
          true,
        );
  if (answer.ok) {
    if (provider === 'kimi')
      return credential(provider, answer.data, expectedEmail);
    const tokens = accepted(
      await post(
        `${OPENAI.origin}/oauth/token`,
        {
          grant_type: 'authorization_code',
          client_id: OPENAI.client,
          code: answer.data.authorization_code,
          code_verifier: answer.data.code_verifier,
          redirect_uri: `${OPENAI.origin}/deviceauth/callback`,
        },
        true,
      ),
      'token_exchange',
    );
    return credential(provider, tokens, expectedEmail);
  }
  const pending =
    provider === 'codex'
      ? CODEX_PENDING.has(answer.status)
      : ['authorization_pending', 'slow_down'].includes(answer.data.error);
  if (!pending) accepted(answer, 'device_authorization');
  throw new AuthenticationFailure(
    'authorization_pending_after_consent',
    'device_authorization',
    `The provider still reports the device authorization as pending (HTTP ${answer.status}${answer.data?.error ? `, ${answer.data.error}` : ''}) after the browser consent was given`,
  );
}
