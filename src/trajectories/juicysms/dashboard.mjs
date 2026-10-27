// JuicySMS dashboard order-history inspection via Google SSO (the account is
// Google-linked, not password-secured; the same sign-in balance.mjs uses).
// After SSO, the selected account pages are kept as HTML and the order
// history is read page by page through the paginator's own next link, every
// order kept once, into all_orders.json and orders_pages.json.
import { WSession } from '../../../dist/session/wsession.js';
import { getGoogleSsoCreds } from '../_shared/services/google_sso.mjs';
import { pageSettled, urlMatching } from '../_shared/page/settled.mjs';
import { openJuicyPage, signInWithGoogle } from './page.mjs';
import { runOutputPath } from '#run-output';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const HOST = 'juicysms.com';
const OUT_DIR = runOutputPath('juicysms_dashboard');
const INDENT = '  ';
const PAGES = [
  '/',
  '/myaccount',
  '/addfunds',
  '/hire-panel',
  '/webhooks',
  '/myorders',
];

const login = await getGoogleSsoCreds();
console.log(`[dash] Using Google SSO: ${login.email}`);

const s = await WSession.start({
  label: 'juicysms_dashboard',
  browser: 'chromium',
});
try {
  if (!(await signInWithGoogle(s, login)))
    throw new Error(`JUICYSMS_SSO_INCOMPLETE: observed ${s.page.url()}`);
  // The OAuth round trip lands back on a juicysms.com route other than
  // /login; the next page is opened only once it has.
  await urlMatching(
    s.page,
    (url) =>
      new URL(url).hostname.endsWith(HOST) &&
      !new URL(url).pathname.startsWith('/login'),
  );
  await pageSettled(s.page);
  mkdirSync(OUT_DIR, { recursive: true });

  // The signed-in application routes, including the ones its user menu
  // offers rather than the public navigation.
  for (const path of PAGES) {
    await openJuicyPage(s, `https://${HOST}${path}`);
    const slug =
      path === '/'
        ? 'home'
        : path.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '');
    const html = await s.page.content();
    writeFileSync(join(OUT_DIR, `${slug}.html`), html);
    console.log(
      `[dash] ${path} rendered ${html.length}b at url=${s.page.url()}`,
    );
  }

  // MyOrders renders its Inertia page state (data-page) with the orders as a
  // paginator: its data, and the next page's address (next_page_url, null on
  // the last page). The history is read through those addresses.
  const history = await s.page.evaluate(async () => {
    // allow-raw-playwright: read-only fetch loop, no synthetic events
    const decode = (text) =>
      new DOMParser().parseFromString(text, 'text/html').documentElement
        .textContent;
    const orders = [];
    const pages = [];
    const ids = new Set();
    let address = new URL('/myorders', location.origin);
    const fail = (code, details) => {
      throw new Error(
        `${code}: ${JSON.stringify({ url: address.href, ...details })}`,
      );
    };
    while (address) {
      const response = await fetch(address.href, {
        credentials: 'include',
        redirect: 'manual',
      });
      if (response.type === 'opaqueredirect')
        fail('JUICYSMS_ORDERS_REDIRECTED', {});
      if (!response.ok)
        fail('JUICYSMS_ORDERS_HTTP_ERROR', {
          status: response.status,
          responseUrl: response.url,
        });
      const state = (await response.text()).match(/data-page="(?<state>[^"]+)"/)
        ?.groups.state;
      if (!state)
        fail('JUICYSMS_ORDERS_STATE_MISSING', { status: response.status });
      const collection = JSON.parse(decode(state)).props?.orders;
      if (
        !Array.isArray(collection?.data) ||
        !Object.hasOwn(collection, 'next_page_url')
      )
        fail('JUICYSMS_ORDERS_SHAPE_INVALID', {
          keys: collection ? Object.keys(collection) : null,
        });
      for (const order of collection.data) {
        if (
          !(typeof order?.id === 'string' && order.id) &&
          !Number.isSafeInteger(order?.id)
        )
          fail('JUICYSMS_ORDER_ID_UNAVAILABLE', { order });
        const key = String(order.id);
        if (ids.has(key)) fail('JUICYSMS_ORDER_REPEATED', { orderId: key });
        ids.add(key);
        orders.push(order);
      }
      pages.push({
        url: response.url,
        status: response.status,
        count: collection.data.length,
      });
      if (collection.next_page_url === null) break;
      if (!collection.data.length)
        fail('JUICYSMS_ORDERS_EMPTY_BEFORE_NEXT_PAGE', {});
      const next = new URL(collection.next_page_url, address);
      if (
        next.origin !== location.origin ||
        next.pathname !== '/myorders' ||
        next.username ||
        next.password ||
        next.hash
      )
        fail('JUICYSMS_ORDERS_LINK_OUTSIDE_HISTORY', { target: next.href });
      address = next;
    }
    return { orders, pages };
  });
  writeFileSync(
    join(OUT_DIR, 'all_orders.json'),
    JSON.stringify(history.orders, null, INDENT),
  );
  writeFileSync(
    join(OUT_DIR, 'orders_pages.json'),
    JSON.stringify(history.pages, null, INDENT),
  );
  console.log(
    `[dash] aggregated ${history.orders.length} orders across ${history.pages.length} page(s) into ${join(OUT_DIR, 'all_orders.json')}`,
  );
  console.log('[dash] PASS');
} finally {
  await s.close();
}
