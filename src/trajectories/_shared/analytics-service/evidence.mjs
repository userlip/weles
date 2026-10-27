import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runRecordingsDir } from '../../../../dist/session/run-recordings.js';
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { pageSettled } from '../page/settled.mjs';
import { input, actionName } from './action-catalog.mjs';
import { waitRendered } from './page-interaction.mjs';
import { clickOffered, fillOffered } from '../page/judged/seen.mjs';
import { umamiRegisterAccount, umamiCreateWebsite } from './umami.mjs';
import { googleAnalyticsRegisterSite } from './google-analytics/registration.mjs';

const INDENT = '  ';
const WRITE_CONFIRM = process.env.WRITE_CONFIRM === '1';

/** The action's declared inputs as this run received them. */
function receivedInputs(cfg) {
  return Object.fromEntries(cfg.required.map((key) => [key, input(key)]));
}

/**
 * Stage a write or admin action for approval: without WRITE_CONFIRM=1 the
 * run writes what it would do to pending_review.json and answers true.
 */
async function prepareWrite(s, cfg) {
  if (WRITE_CONFIRM) return false;
  const dir = runRecordingsDir(actionName());
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'pending_review.json'),
    JSON.stringify(
      {
        action: actionName(),
        platform: cfg.platform,
        risk: cfg.risk,
        objective: cfg.objective,
        required: cfg.required,
        inputs: receivedInputs(cfg),
        reason:
          'WRITE_CONFIRM=1 required before Weles performs admin/write browser changes',
      },
      null,
      INDENT,
    ),
  );
  return true;
}

async function performConfirmedWrite(s, cfg) {
  const action = actionName();
  if (cfg.platform === 'umami' && action === 'umami_register') {
    return umamiRegisterAccount(s);
  }
  if (cfg.platform === 'umami' && action === 'umami_create_website') {
    await umamiCreateWebsite(s);
    return { registration: { domain: input('DOMAIN') } };
  }
  if (cfg.platform === 'umami' && action === 'umami_update_website_settings') {
    await clickOffered(s.page, 'the control that opens the website settings');
    const patch = input('SETTINGS_PATCH');
    if (patch)
      await fillOffered(
        s.page,
        'the website settings field the new value belongs in',
        patch,
      );
    await clickOffered(s.page, 'the button that saves the settings');
    return {};
  }
  if (
    cfg.platform === 'googleanalytics' &&
    action.startsWith('googleanalytics_register')
  ) {
    return googleAnalyticsRegisterSite(s);
  }
  // Any other write is described to the vision model by its objective: the
  // control that starts it, the fields its inputs belong in, and the control
  // that saves it.
  await clickOffered(
    s.page,
    `the control that starts this task: ${cfg.objective}`,
  );
  for (const key of cfg.required) {
    const value = input(key);
    if (value)
      await fillOffered(
        s.page,
        `the field for ${key.toLowerCase().replace(/_/g, ' ')}`,
        value,
      );
  }
  await clickOffered(s.page, 'the button that saves or creates it');
  return {};
}

/**
 * Open the target site (SITE_URL) and read what it loads: the tracking tags
 * it carries are read from its scripts' own attributes (an Umami tag's
 * data-website-id), a Google tag by the measurement id the caller stated.
 */
async function verifyTargetSite(s, cfg) {
  const action = actionName();
  await s.goto(input('SITE_URL'));
  await pageSettled(s.page);
  if (action === 'umami_track_custom_event' && input('SELECTOR_OR_CODE_PATH')) {
    await humanClickLocator(
      s.page,
      s.page.locator(input('SELECTOR_OR_CODE_PATH')).first(),
    );
    await pageSettled(s.page);
  }
  const data = await s.page.evaluate(() => ({
    url: location.href,
    title: document.title,
    scripts: Array.from(document.scripts).map((script) => ({
      src: script.src,
      websiteId: script.getAttribute('data-website-id'),
    })),
    bodyText: document.body.innerText,
  }));
  const text = JSON.stringify(data);
  const tagged = data.scripts.filter((script) => script.websiteId);
  if (
    action === 'umami_verify_tracking_script' &&
    !tagged.some((script) => script.websiteId === input('WEBSITE_ID'))
  )
    throw new Error(
      `Umami website id ${input('WEBSITE_ID')} is on no tracking script of ${data.url}`,
    );
  if (action === 'umami_track_custom_event' && !tagged.length)
    throw new Error(
      `${data.url} loads no Umami tracking script (no script declares data-website-id); a custom event cannot be tracked`,
    );
  if (
    (action === 'googleanalytics_install_gtag' ||
      action === 'googleanalytics_verify_realtime') &&
    !text.includes(input('MEASUREMENT_ID'))
  )
    throw new Error(
      `GA measurement id ${input('MEASUREMENT_ID')} not found on target site`,
    );
  return data;
}

/**
 * Keep what the dashboard shows as the run's evidence: its text, its form
 * values, the requests the session saw, its HTML and its screenshot, in the
 * run's recordings, plus the `extra` the run found. A capture that fails
 * fails the run: evidence that is not kept proves nothing.
 */
async function captureEvidence(s, cfg, extra) {
  const dir = runRecordingsDir(actionName());
  mkdirSync(dir, { recursive: true });
  const text = await waitRendered(s.page);
  const formValues = await s.page.evaluate(() =>
    Array.from(document.querySelectorAll('input, textarea, select'))
      .filter((node) => node.value)
      .map((node) => ({
        name: node.getAttribute('name'),
        label: node.getAttribute('aria-label')
          ? node.getAttribute('aria-label')
          : node.getAttribute('title'),
        value: node.value,
      })),
  );
  const evidence = {
    action: actionName(),
    platform: cfg.platform,
    risk: cfg.risk,
    objective: cfg.objective,
    url: s.page.url(),
    title: await s.page.title(),
    required: cfg.required,
    inputs: receivedInputs(cfg),
    bodyText: text,
    formValues,
    capturedRequests: s.capturedResponses.map((r) => ({
      method: r.method,
      url: r.url,
      status: r.status,
    })),
    ...extra,
    dashboardHtml: 'dashboard.html',
    dashboardImage: 'dashboard.png',
  };
  writeFileSync(join(dir, 'dashboard-text.txt'), text);
  writeFileSync(join(dir, evidence.dashboardHtml), await s.page.content());
  await s.page.screenshot({
    path: join(dir, evidence.dashboardImage),
    fullPage: cfg.platform !== 'googleanalytics',
  });
  writeFileSync(
    join(dir, 'service_action_result.json'),
    JSON.stringify(evidence, null, INDENT),
  );
  return evidence;
}

export {
  prepareWrite,
  performConfirmedWrite,
  verifyTargetSite,
  captureEvidence,
};
