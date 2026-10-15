// Persisting a market scrape through Trading Tools' authenticated ingest API.
// Trading Tools owns storage and rows; Weles sends one body-bound request,
// bearer-authenticated and HMAC-signed, and never receives Trading Tools
// credentials of its own.
//
// Env (each required, refused by name):
//   TRADING_TOOLS_INGEST_URL          the ingest endpoint, ending /v1/ingest/stock-context:
//                                     HTTPS, or HTTP to an address of this host
//   TRADING_TOOLS_INGEST_TOKEN        the bearer
//   TRADING_TOOLS_INGEST_HMAC_SECRET  the signing secret, distinct from the bearer
import { createHash, createHmac } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { readFileSync, statSync } from 'node:fs';
import { STATUS_CODES } from 'node:http';
import { networkInterfaces } from 'node:os';
import { statedText } from '../inputs/stated.mjs';

const INGEST_PATH_SUFFIX = '/v1/ingest/stock-context';
const CALLER_ID = 'weles';
const SCREENSHOT_URI_PREFIX = 'stado://trading-tools/stock-context/';
// The ingest answers a stored row with HTTP Created.
const [CREATED] = Object.entries(STATUS_CODES).find(([, text]) => text === 'Created');
// Milliseconds in one second, as the clock measures it; the signature's
// timestamp is in whole seconds.
const MS_PER_SECOND = new Date('1970-01-01T00:00:01Z').getTime();

/** Whether `hostname` resolves to an address of one of this host's own (internal) interfaces. */
async function onThisHost(hostname) {
  const own = new Set(
    Object.values(networkInterfaces())
      .flat()
      .filter((address) => address.internal)
      .map((address) => address.address),
  );
  const { address } = await lookup(hostname.replace(/^\[|\]$/g, ''));
  return own.has(address);
}

async function ingestConfig() {
  const raw = statedText(['TRADING_TOOLS_INGEST_URL'], 'the Trading Tools stock-context ingest endpoint');
  const token = statedText(['TRADING_TOOLS_INGEST_TOKEN'], 'the bearer of the Trading Tools ingest');
  const hmacSecret = statedText(
    ['TRADING_TOOLS_INGEST_HMAC_SECRET'],
    'the secret the Trading Tools ingest request is signed with',
  );
  if (token === hmacSecret)
    throw new Error('TRADING_TOOLS_INGEST_TOKEN and TRADING_TOOLS_INGEST_HMAC_SECRET must be distinct');
  if (!URL.canParse(raw)) throw new Error(`TRADING_TOOLS_INGEST_URL is not a URL: ${raw}`);
  const endpoint = new URL(raw);
  if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && (await onThisHost(endpoint.hostname))))
    throw new Error(
      `TRADING_TOOLS_INGEST_URL must use HTTPS, or HTTP to an address of this host: ${endpoint.origin}`,
    );
  if (
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    !endpoint.pathname.endsWith(INGEST_PATH_SUFFIX)
  )
    throw new Error(
      `TRADING_TOOLS_INGEST_URL must be a credential-free endpoint ending ${INGEST_PATH_SUFFIX}`,
    );
  return { endpoint: endpoint.toString(), token, hmacSecret };
}

/** The PNG at `path` as the ingest takes it; a stated screenshot that is not a readable file is refused. */
function screenshotBody(path) {
  if (!statSync(path).isFile()) throw new Error(`the screenshot ${path} is not a file`);
  return { content_type: 'image/png', base64: readFileSync(path).toString('base64') };
}

async function ingestStockContext(body) {
  const config = await ingestConfig();
  const serialized = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / MS_PER_SECOND));
  const bodyDigest = createHash('sha256').update(serialized, 'utf8').digest('hex');
  const signature = createHmac('sha256', config.hmacSecret)
    .update(`${CALLER_ID}:${timestamp}:${bodyDigest}`, 'utf8')
    .digest('hex');
  const response = await fetch(config.endpoint, {
    method: 'POST',
    redirect: 'error',
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
      'x-agent-id': CALLER_ID,
      'x-agent-timestamp': timestamp,
      'x-agent-signature': signature,
    },
    body: serialized,
  });
  const text = await response.text();
  if (String(response.status) !== CREATED)
    throw new Error(`Trading Tools stock-context ingest failed (HTTP ${response.status}): ${text}`);
  let stored;
  try {
    stored = JSON.parse(text);
  } catch (cause) {
    throw new Error(`Trading Tools stock-context ingest answered something other than JSON: ${text}`, { cause });
  }
  if (typeof stored?.id !== 'string' || !stored.id)
    throw new Error(`Trading Tools stock-context ingest answered no row id: ${text}`);
  if (
    stored.screenshot_uri !== undefined &&
    stored.screenshot_uri !== null &&
    !(typeof stored.screenshot_uri === 'string' && stored.screenshot_uri.startsWith(SCREENSHOT_URI_PREFIX))
  )
    throw new Error(`Trading Tools stock-context ingest answered an invalid screenshot URI: ${text}`);
  return stored;
}

/**
 * Persist one scraped page through the Trading Tools ingest: `ticker`, the
 * catalog `page` and its optional `tab`, the scraped `data`, the scrape's
 * `metadata` and an optional screenshot file. Answers the stored row.
 */
export async function persistContext({ ticker, page, tab, data, screenshotPath, metadata }) {
  if (!ticker) throw new Error('persistContext: ticker required');
  if (!page) throw new Error('persistContext: page required');
  for (const [name, value] of Object.entries({ data, metadata }))
    if (!value || typeof value !== 'object')
      throw new Error(`persistContext: the ${name} of ${ticker} ${page} is not an object`);
  const body = { ticker, page, data, metadata };
  if (tab) body.tab = tab;
  if (screenshotPath) body.screenshot = screenshotBody(screenshotPath);
  return ingestStockContext(body);
}
