// The browser session of the harvest: the authenticated Apple Ads page and
// the network capture. The profile's persona is the shared one
// (_shared/profile/persona.mjs).
import { REPORT_URL } from './settings.mjs';
import { pageSettled } from '../../../_shared/page/settled.mjs';
import { pageShows } from '../../../_shared/page/judged/seen.mjs';

// Apple Ads answers on the host of the report page the run states; Apple
// signs people in on its own identity hosts, never on that one.
const ADS_HOST = new URL(REPORT_URL).hostname;

export function norm(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/** Whether the page stands on an Apple host other than Apple Ads' own. */
function offAppleAds(url) {
  if (url === 'about:blank') return false;
  const host = new URL(url).hostname;
  return host !== ADS_HOST && host.endsWith('.apple.com');
}

export async function requireAuthenticatedSession(s) {
  const url = s.page.url();
  if (url === 'about:blank') return false;

  const authIframe = await s.page
    .locator('iframe[src*="idmsa.apple.com"], iframe[src*="appleid.apple.com"]')
    .count();
  let authPrompt = false;
  for (const frame of s.page.frames()) {
    authPrompt ||= await frame
      .locator(
        '#account_name_text_field, #password_text_field, input[type="password"], input[aria-label*="digit" i], input[type="tel"][maxlength="1"], input[autocomplete="one-time-code"]',
      )
      .first()
      .isVisible();
    if (authPrompt) break;
  }
  if (offAppleAds(url) || authIframe || authPrompt) {
    console.log(
      'FAIL_CLOSED: Apple login/password/2FA is required; this harvester will not authenticate. An explicitly authorized apple_login is the only permitted login path.',
    );
    return false;
  }
  return true;
}

/** Open `url` and wait for it to settle; a page left blank is refused. */
export async function gotoAndWait(page, url) {
  console.log(`[apple-ads-report-harvest] goto start ${url}`);
  await page.goto(url, { waitUntil: 'commit' });
  await pageSettled(page);
  console.log(`[apple-ads-report-harvest] goto done url=${page.url()}`);
  if (page.url() === 'about:blank')
    throw new Error(`navigation to ${url} left the page blank`);
}

// The reports page has its own route; anywhere else the vision model is asked
// whether the page is the campaigns or reports view.
export async function ensureReportPage(page) {
  if (/\/report/i.test(page.url())) return true;
  return pageShows(
    page,
    'Is this the Apple Ads campaigns or reports view, with a table of campaigns?',
  );
}

/** Whether a request or response is one of Apple Ads' own API calls. */
function appleAdsApi(url) {
  const { hostname, pathname } = new URL(url);
  return (
    hostname === ADS_HOST &&
    (pathname.startsWith('/reporting/graphql') || pathname.startsWith('/cm/api'))
  );
}

/**
 * Every Apple Ads API request and answer the page makes while the harvest
 * runs, kept whole. An answer whose body could not be read is kept in
 * `failures` with its address, status and the read's error, never dropped.
 */
export function installNetworkCapture(page) {
  const requests = [];
  const responses = [];
  const failures = [];
  page.on('request', (request) => {
    const url = request.url();
    if (!appleAdsApi(url)) return;
    requests.push({
      ts: Date.now(),
      method: request.method(),
      url,
      postData: request.postData(),
    });
  });
  page.on('response', (response) => {
    const url = response.url();
    if (!appleAdsApi(url)) return;
    // The capture holds Apple Ads' own API answers only, all of them text.
    response.text().then(
      (body) =>
        responses.push({
          ts: Date.now(),
          method: response.request().method(),
          url,
          status: response.status(),
          contentType: response.headers()['content-type'],
          body,
        }),
      (error) =>
        failures.push({
          ts: Date.now(),
          url,
          status: response.status(),
          error: error instanceof Error ? error.message : String(error),
        }),
    );
  });
  return { requests, responses, failures };
}
