// What the Apple Ads API page and the local key files say about the API client
// setup. An existing client is one whose three credentials (client, team and
// key id) can be read off the page; whether the page offers to generate a
// client or upload a public key is judged by the vision model
// (`_shared/page/judged/seen.mjs`) rather than matched against button words.
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIAG_DIR, PRIVATE_KEY_PATH, PUBLIC_KEY_PATH } from './settings.mjs';
import { pageShows } from '../../../_shared/page/judged/seen.mjs';

const INDENT = '  ';

export function extractValuesNearLabels(text) {
  const compact = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  const patterns = {
    clientId: /Client ID\s*[:\-]?\s*([A-Za-z0-9._-]{6,})/i,
    teamId: /Team ID\s*[:\-]?\s*([A-Z0-9]{6,})/i,
    keyId: /Key ID\s*[:\-]?\s*([A-Z0-9]{6,})/i,
  };
  const out = {};
  for (const [key, pattern] of Object.entries(patterns)) {
    const match = compact.match(pattern);
    if (match?.[1]) out[key] = match[1];
  }
  return out;
}

export function summarizeAppleArtifacts(pageState, localState, judged) {
  const frames = Array.isArray(pageState?.frames) ? pageState.frames : [];
  const frameText = frames.map((frame) => frame.text || '').join('\n');
  const text = [pageState?.text || '', frameText].join('\n');
  const values = extractValuesNearLabels(text);
  return {
    hasExistingAppleAdsApiClient: Boolean(
      values.clientId && values.teamId && values.keyId,
    ),
    hasAppleAdsApiSurface: judged.apiSurface,
    canGenerateApiClient: judged.canGenerate,
    extracted: values,
    local: localState,
  };
}

export async function inspectExistingAppleAdsApi(page, pageState) {
  const localState = {
    publicKeyPath: PUBLIC_KEY_PATH,
    hasPublicKey: existsSync(PUBLIC_KEY_PATH),
    privateKeyPath: PRIVATE_KEY_PATH,
    hasPrivateKey: existsSync(PRIVATE_KEY_PATH),
    env: {
      hasClientId: Boolean(process.env.ASC_ADS_CLIENT_ID),
      hasTeamId: Boolean(process.env.ASC_ADS_TEAM_ID),
      hasKeyId: Boolean(process.env.ASC_ADS_KEY_ID),
      hasOrgId: Boolean(process.env.ASC_ADS_ORG_ID),
      hasPrivateKeyPath: Boolean(process.env.ASC_ADS_PRIVATE_KEY_PATH),
    },
  };
  const judged = {
    apiSurface: await pageShows(
      page,
      'Is this the Apple Ads API settings page (the Campaign Management API section of account settings)?',
    ),
    canGenerate: await pageShows(
      page,
      'Does the page offer to generate or create an API client, or ask for a public key to be uploaded?',
    ),
  };
  const controls = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button, [role="button"], a'))
      .filter((el) => el.getClientRects().length)
      .map((el) => ({
        text: el.innerText.replace(/\s+/g, ' ').trim(),
        href: el.href,
      })),
  );
  const summary = {
    ...summarizeAppleArtifacts(pageState, localState, judged),
    controls,
    url: page.url(),
    title: pageState?.title,
  };
  const outPath = join(DIAG_DIR, 'apple_ads_api_existing.json');
  writeFileSync(outPath, JSON.stringify(summary, null, INDENT));
  console.log(`[apple-ads-api-setup] existing_api json=${outPath}`);
  const brief = {
    hasExistingAppleAdsApiClient: summary.hasExistingAppleAdsApiClient,
    hasAppleAdsApiSurface: summary.hasAppleAdsApiSurface,
    canGenerateApiClient: summary.canGenerateApiClient,
    extracted: summary.extracted,
    local: summary.local,
  };
  console.log(
    `[apple-ads-api-setup] existing_api ${JSON.stringify(brief, null, INDENT)}`,
  );
  return summary;
}
