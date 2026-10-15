// A Slack app created from a manifest with the web client's own (xoxc) token
// and installed to the workspace, for the runs that mint a bot (xoxb) or a
// user (xoxp) token:
//   1. apps.manifest.validate, then apps.manifest.create, with xoxc as Bearer
//      (the xoxc-authed API takes the manifest as JSON);
//   2. the app's install-on-team page, whose OAuth authorize link is followed;
//   3. the OAuth consent form POSTed through the browser context's request API
//      (Slack refuses a synthetic click on its Allow button);
//   4. the token read from the app's OAuth page.
// The app's name and its scopes are the caller's: an app nobody named, or a
// grant nobody chose, is refused by name before anything is created.
// Deleting an app POSTs its settings page's delete form the same way (the
// page's delete button asks through window.confirm, which Playwright
// dismisses).

import { statedText } from '../../_shared/inputs/stated.mjs';
import { pageSettled } from '../../_shared/page/settled.mjs';

const SLACK_API = 'https://slack.com/api';
const APPS = 'https://api.slack.com/apps';
// The flags Slack's forms carry and land on: an accepted install, a delete
// request, and a completed delete.
const INSTALLED = 'success=1';
const DELETE_REQUEST = 'delete=1';
const DELETED = 'deleted=1';

/** Whether `address` carries the `flag=value` pair. */
function flagged(address, pair) {
  const [flag, value] = pair.split('=');
  return new URL(address).searchParams.get(flag) === value;
}

/**
 * The manifest of an app granted `kind` ('bot' or 'user') scopes, its name
 * stated in `nameVar` and its scopes (comma or space separated) in
 * `scopesVar`; `what` says what the app is for in the refusal.
 */
export function statedManifest({ kind, nameVar, scopesVar, what }) {
  const name = statedText(
    [nameVar],
    `the name the workspace lists the ${what} app under`,
  );
  const scopes = statedText(
    [scopesVar],
    `the ${kind} scopes the ${what} app is granted (comma or space separated)`,
  )
    .split(/[\s,]+/)
    .filter(Boolean);
  return {
    display_information: { name },
    ...(kind === 'bot'
      ? { features: { bot_user: { display_name: name } } }
      : {}),
    oauth_config: { scopes: { [kind]: scopes } },
  };
}

async function manifestCall(page, method, xoxc, manifest) {
  const response = await page.context().request.post(`${SLACK_API}/${method}`, {
    headers: { Authorization: `Bearer ${xoxc}` },
    multipart: { manifest: JSON.stringify(manifest), token: xoxc },
  });
  const answer = await response.json();
  if (!answer.ok)
    throw new Error(
      `SLACK_MANIFEST_REFUSED: ${method} answered ${response.status()} ${JSON.stringify(answer)}`,
    );
  return answer;
}

/** The OAuth authorize link the app's install-on-team page offers. */
async function authorizeLink(page, appId) {
  await page.goto(`${APPS}/${appId}/install-on-team`, {
    waitUntil: 'domcontentloaded',
  });
  await pageSettled(page);
  const links = await page.evaluate(() => [
    ...new Set(
      Array.from(document.querySelectorAll('a[href]'))
        .map((a) => a.href)
        .filter((href) => new URL(href).pathname.endsWith('/oauth/v2/authorize')),
    ),
  ]);
  const [link, ...others] = links;
  if (!link || others.length)
    throw new Error(
      `SLACK_INSTALL_LINK: ${page.url()} offers ${links.length} OAuth authorize links, not one: ${JSON.stringify(links)}`,
    );
  return link;
}

/** POST the OAuth consent form the authorize page renders. */
async function grantConsent(page, shot) {
  await pageSettled(page);
  await shot('oauth-consent');
  const form = await page.evaluate(() => {
    const f = document.querySelector('#oauth_install_form');
    if (!f) return null;
    const body = new URLSearchParams();
    f.querySelectorAll('input[type=hidden]').forEach((i) =>
      body.append(i.name, i.value),
    );
    return { action: f.action, body: body.toString() };
  });
  if (!form)
    throw new Error(`SLACK_CONSENT_FORM: ${page.url()} renders no OAuth consent form`);
  const allowed = await page.context().request.post(form.action, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    data: form.body,
  });
  if (!allowed.ok() || !flagged(allowed.url(), INSTALLED))
    throw new Error(
      `SLACK_CONSENT_REFUSED: the OAuth consent POST ended ${allowed.status()} at ${allowed.url()}`,
    );
}

/**
 * The `prefix` token (xoxb, xoxp) the app's OAuth page shows; refused when
 * the page shows none.
 */
export async function appToken(page, appId, prefix) {
  await page.goto(`${APPS}/${appId}/oauth`, { waitUntil: 'domcontentloaded' });
  await pageSettled(page);
  const token = await page.evaluate((start) => {
    const field = Array.from(document.querySelectorAll('input,textarea'))
      .map((i) => i.value)
      .find((value) => value.startsWith(`${start}-`));
    if (field) return field;
    return document.body.innerText.match(new RegExp(`${start}-[\\w-]+`))?.shift();
  }, prefix);
  if (!token)
    throw new Error(
      `SLACK_NO_APP_TOKEN: the OAuth page of app ${appId} shows no ${prefix} token`,
    );
  return token;
}

/**
 * Create the app `manifest` describes with `xoxc`, install it to the
 * workspace, and resolve its id.
 */
export async function installManifestApp({ page, xoxc, manifest, label, shot }) {
  await manifestCall(page, 'apps.manifest.validate', xoxc, manifest);
  const created = await manifestCall(page, 'apps.manifest.create', xoxc, manifest);
  if (!created.app_id)
    throw new Error(
      `SLACK_MANIFEST_REFUSED: apps.manifest.create answered no app_id: ${JSON.stringify(created)}`,
    );
  console.log(`[${label}] app created: id=${created.app_id}`);
  await shot('app-created');
  await page.goto(await authorizeLink(page, created.app_id), {
    waitUntil: 'domcontentloaded',
  });
  await grantConsent(page, shot);
  console.log(`[${label}] OAuth consent accepted for ${created.app_id}`);
  return created.app_id;
}

/** The delete form's CSRF crumb on app `appId`'s settings page, or undefined. */
async function deleteCrumb(page, appId) {
  await page.goto(`${APPS}/${appId}/general`, { waitUntil: 'domcontentloaded' });
  await pageSettled(page);
  return page.evaluate(
    () =>
      document.querySelector('#delete_application_form input[name=crumb]')
        ?.value,
  );
}

/**
 * Delete app `appId` through its settings page's delete form; refused when
 * the page renders no delete form, or still renders one afterwards.
 */
export async function deleteApp(page, appId) {
  if (!/^A[A-Z\d]+$/.test(appId))
    throw new Error(`SLACK_APP_ID: "${appId}" is not a Slack app id (A…)`);
  const crumb = await deleteCrumb(page, appId);
  if (!crumb)
    throw new Error(
      `SLACK_APP_NOT_DELETABLE: ${page.url()} renders no delete form for app ${appId}: the browser is not signed in to api.slack.com for the app's workspace, or the app is gone`,
    );
  const body = new URLSearchParams(DELETE_REQUEST);
  body.set('crumb', crumb);
  const answer = await page
    .context()
    .request.post(`${APPS}/${appId}/general`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: body.toString(),
    });
  if (!answer.ok() || !flagged(answer.url(), DELETED))
    throw new Error(
      `SLACK_APP_DELETE_REFUSED: deleting app ${appId} ended ${answer.status()} at ${answer.url()}`,
    );
  if (await deleteCrumb(page, appId))
    throw new Error(
      `SLACK_APP_DELETE_REFUSED: app ${appId} still renders its delete form after the delete was accepted`,
    );
}
