import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runRecordingsDir } from '../../../../dist/session/run-recordings.js';
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { pageSettled } from '../page/settled.mjs';
import { input, actionName } from './action-catalog.mjs';
import { escapeRegExp, waitRendered } from './page-interaction.mjs';
import { clickOffered, fillOffered } from '../page/judged/seen.mjs';
import { umamiRegisterAccount, umamiCreateWebsite } from './umami.mjs';
import { googleAnalyticsRegisterSite } from './google-analytics/registration.mjs';
import { extractGaMeasurementId } from './google-analytics/web-stream.mjs';

const WRITE_CONFIRM = process.env.WRITE_CONFIRM === '1';

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
        inputs: Object.fromEntries(
          cfg.required.map((key) => [key, process.env[key] ?? null]),
        ),
        reason:
          'WRITE_CONFIRM=1 required before Weles performs admin/write browser changes',
      },
      null,
      2,
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

async function verifyTargetSite(s, cfg) {
  const action = actionName();
  await s.goto(input('SITE_URL', 'https://www.needher.ai'));
  await pageSettled(s.page);
  if (
    action === 'umami_track_custom_event' &&
    process.env.SELECTOR_OR_CODE_PATH
  ) {
    const target = s.page.locator(process.env.SELECTOR_OR_CODE_PATH).first();
    await humanClickLocator(s.page, target);
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
  if (
    action === 'umami_verify_tracking_script' &&
    !text.includes(input('WEBSITE_ID'))
  ) {
    throw new Error(
      `Umami website id ${input('WEBSITE_ID')} not found on target site`,
    );
  }
  if (action === 'umami_track_custom_event' && !/umami/i.test(text)) {
    throw new Error(
      'Umami tracking script not found on target site; custom event cannot be tracked',
    );
  }
  if (
    (action === 'googleanalytics_install_gtag' ||
      action === 'googleanalytics_verify_realtime') &&
    !text.includes(input('MEASUREMENT_ID'))
  ) {
    throw new Error(
      `GA measurement id ${input('MEASUREMENT_ID')} not found on target site`,
    );
  }
  return data;
}

async function captureEvidence(s, cfg, extra = {}) {
  const dir = runRecordingsDir(actionName());
  mkdirSync(dir, { recursive: true });
  const text = await waitRendered(s.page);
  const formValues = await s.page.evaluate(() =>
    Array.from(document.querySelectorAll('input, textarea, select'))
      .map((node) => ({
        name: node.getAttribute('name') || '',
        label:
          node.getAttribute('aria-label') || node.getAttribute('title') || '',
        value: node.value || '',
      }))
      .filter((item) => item.value),
  );
  const evidence = {
    action: actionName(),
    platform: cfg.platform,
    risk: cfg.risk,
    objective: cfg.objective,
    url: s.page.url(),
    title: await s.page.title(),
    required: cfg.required,
    inputs: Object.fromEntries(
      cfg.required.map((key) => [key, process.env[key] ?? null]),
    ),
    bodyText: text,
    formValues,
    capturedRequests: s.capturedResponses.map((r) => ({
      method: r.method,
      url: r.url,
      status: r.status,
    })),
    ...extra,
  };
  writeFileSync(
    join(dir, 'service_action_result.json'),
    JSON.stringify(evidence, null, 2),
  );
  writeFileSync(join(dir, 'dashboard-text.txt'), text);
  evidence.dashboardHtml = await s.page.content().then(
    (html) => {
      writeFileSync(join(dir, 'dashboard.html'), html);
      return { captured: true, file: 'dashboard.html' };
    },
    (htmlError) => ({
      captured: false,
      reason: `dashboard.html was not captured: ${htmlError.message}`,
    }),
  );
  evidence.dashboardImage = await s.page
    .screenshot({
      path: join(dir, 'dashboard.png'),
      fullPage: cfg.platform !== 'googleanalytics',
    })
    .then(
      () => ({ captured: true, file: 'dashboard.png' }),
      (imageError) => ({
        captured: false,
        reason: `dashboard.png was not captured: ${imageError.message}`,
      }),
    );
  if (!evidence.dashboardHtml.captured)
    console.log(evidence.dashboardHtml.reason);
  if (!evidence.dashboardImage.captured)
    console.log(evidence.dashboardImage.reason);
  return evidence;
}

function assertExpectedEvidence(evidence) {
  const action = actionName();
  const text = evidence.bodyText || '';
  if (action.endsWith('_realtime') && !evidence.url.includes('realtime')) {
    throw new Error(`GA realtime view did not open; final_url=${evidence.url}`);
  }
  if (
    action === 'googleanalytics_get_measurement_id' &&
    !/Measurement ID:G-[A-Z0-9]+/i.test(text)
  ) {
    throw new Error('GA measurement id was not visible in the captured page');
  }
  // The global site tag is its loader script, whatever the page calls it.
  if (
    action === 'googleanalytics_get_global_site_tag' &&
    !text.includes('googletagmanager.com/gtag/js')
  ) {
    throw new Error(
      'GA global site tag snippet was not visible in the captured page',
    );
  }
  if (
    action === 'googleanalytics_view_debugview' &&
    !/debugview/i.test(evidence.url)
  ) {
    throw new Error(`GA DebugView did not open; final_url=${evidence.url}`);
  }
  if (
    action === 'googleanalytics_view_key_events' &&
    /\/admin$/.test(evidence.url)
  ) {
    throw new Error(
      `GA events settings did not open; final_url=${evidence.url}`,
    );
  }
  if (
    action === 'googleanalytics_run_data_api_report' &&
    evidence.url.includes('/reports/intelligenthome')
  ) {
    throw new Error(`GA data report did not run; final_url=${evidence.url}`);
  }
  if (
    action === 'googleanalytics_export_report' &&
    evidence.url.includes('/reports/intelligenthome')
  ) {
    throw new Error(
      `GA export report did not open an exportable report; final_url=${evidence.url}`,
    );
  }
  if (
    (action === 'umami_find_website' || action === 'umami_get_website_id') &&
    !new RegExp(escapeRegExp(input('DOMAIN_OR_NAME')), 'i').test(text)
  ) {
    throw new Error(
      `Umami website ${input('DOMAIN_OR_NAME')} was not visible in the captured page`,
    );
  }
  const valueText = JSON.stringify(evidence.formValues ?? {});
  if (
    action === 'umami_get_tracking_snippet' &&
    (!`${text} ${valueText}`.includes(input('WEBSITE_ID')) ||
      !/data-website-id|\/script\.js|\/c\.js|Tracking code|Install/i.test(
        `${text} ${valueText}`,
      ))
  ) {
    throw new Error(
      `Umami tracking snippet was not visible for website ${input('WEBSITE_ID')}; final_url=${evidence.url}`,
    );
  }
  if (
    action === 'umami_create_website' &&
    !new RegExp(escapeRegExp(input('DOMAIN')), 'i').test(text)
  ) {
    throw new Error(
      `Umami website ${input('DOMAIN')} was not visible in the captured page`,
    );
  }
  if (
    action === 'umami_register' &&
    !/verify|verification|check your email|confirm your email|dashboard|websites|analytics\/us/i.test(
      text,
    )
  ) {
    throw new Error(
      'Umami registration did not reach a verification or account state',
    );
  }
  if (
    (action === 'googleanalytics_register' ||
      action === 'googleanalytics_register_needher') &&
    !extractGaMeasurementId(
      `${text} ${JSON.stringify(evidence.registration ?? {})}`,
    )
  ) {
    throw new Error('GA registration did not expose a measurement id');
  }
  const expectedSections = {
    googleanalytics_view_acquisition: /Acquisition/i,
    googleanalytics_view_engagement: /Engagement/i,
    googleanalytics_view_pages: /Pages and screens|Page title and screen name/i,
    googleanalytics_view_key_events: /Events|Key events/i,
  };
  const sectionPattern = expectedSections[action];
  if (
    sectionPattern &&
    (evidence.url.includes('/reports/intelligenthome') ||
      !sectionPattern.test(text))
  ) {
    throw new Error(
      `${action} did not open the expected GA section; final_url=${evidence.url}`,
    );
  }
}

function writeBanSignal(signal, healthy, details = {}) {
  const dir = runRecordingsDir(actionName());
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'ban_signal.json'),
    JSON.stringify(
      {
        action: actionName(),
        signal,
        healthy,
        details,
        ts: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

export {
  prepareWrite,
  performConfirmedWrite,
  verifyTargetSite,
  captureEvidence,
  assertExpectedEvidence,
  writeBanSignal,
};
