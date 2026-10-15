import {
  integrationAction,
  integrationsConfigured,
} from '../../../_shared/integrations.mjs';

/**
 * The Slack identity Weles posts as when it does not drive the browser: the
 * Swiatowid bot, whose token is wisent-integrations' provider item
 * `slack-swiatowid-bot`. Weles itself holds no Slack token.
 */
export const BOT_IDENTITY = 'swiatowid-bot';

/** Whether the bot can be reached through wisent-integrations at all. */
export const botConfigured = integrationsConfigured;

export function encodeForm(form) {
  return Object.entries(form)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
}

/**
 * One Slack call as the bot, through wisent-integrations' `slack` domain.
 * `auth.test` answers Slack's own fields; `chat.postMessage` answers `ts`,
 * `channel` and `user`. A refusal carries Slack's own error word.
 */
export async function slackPost(method, form) {
  const identity = { identity: BOT_IDENTITY };
  if (method === 'auth.test')
    return integrationAction('slack', 'auth.test', identity);
  if (method === 'chat.postMessage') {
    return integrationAction('slack', 'chat.post_message', {
      ...identity,
      channel: form.channel,
      text: form.text,
    });
  }
  throw new Error(
    `${method}: not a Slack method Weles reaches through wisent-integrations`,
  );
}

/**
 * Every entry of one Slack directory as the bot -- `users.list` under
 * `members`, `conversations.list` under `channels` -- page by page through
 * wisent-integrations until `next_cursor` is empty. Slack may answer fewer
 * entries than asked while more remain, so one page is never read as the
 * whole directory. `form` carries the caller's page `limit` and the method's
 * own filters (`types`); a call without a limit is refused by name.
 */
export async function slackDirectory(method, key, form) {
  const { limit, ...filters } = form;
  if (!limit)
    throw new Error(`${method}: the caller names no page limit to ask for`);
  const entries = [];
  let cursor;
  do {
    const page = await integrationAction('slack', method, {
      identity: BOT_IDENTITY,
      limit: Number(limit),
      ...filters,
      ...(cursor ? { cursor } : {}),
    });
    if (!Array.isArray(page[key]))
      throw new Error(
        `${method} answered without a ${key} list: ${JSON.stringify(page)}`,
      );
    entries.push(...page[key]);
    cursor = page.next_cursor;
  } while (cursor);
  return entries;
}

/**
 * One Slack call through the signed-in browser context, on `workspace`'s own
 * API address (the client token rides the form, the session cookie the
 * context). A refusal carries Slack's whole answer.
 */
export function workspaceApi(request, workspace) {
  return async function slackApi(method, form) {
    const r = await request.post(
      `${workspace}/api/${method}?_x_id=${Date.now()}`,
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        data: encodeForm(form),
      },
    );
    const j = await r.json();
    if (!j.ok) throw new Error(`${method}: ${JSON.stringify(j)}`);
    return j;
  };
}

/**
 * slackDirectory's reading through the signed-in client as `token`: every
 * page of `method` until Slack's next_cursor is empty.
 */
export function workspaceDirectory(slackApi, token) {
  return async function directory(method, key, form) {
    const entries = [];
    let cursor;
    do {
      const page = await slackApi(method, {
        ...form,
        token,
        ...(cursor ? { cursor } : {}),
      });
      if (!Array.isArray(page[key]))
        throw new Error(
          `${method} answered without a ${key} list: ${JSON.stringify(page)}`,
        );
      entries.push(...page[key]);
      cursor = page.response_metadata?.next_cursor;
    } while (cursor);
    return entries;
  };
}
