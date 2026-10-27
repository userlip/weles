// App Store Connect analytics: each app's overview metrics (impressions,
// downloads, sales, crashes), read from its analytics page by the vision model
// in whatever wording App Store Connect prints them. Requires the Apple
// session apple/login.mjs stores (./asc_session.mjs refuses an expired one).
// Prints the per-app metrics as JSON.
import { shownText } from '../_shared/page/judged/seen.mjs';
import { getSocialAccount } from '../../../dist/utils/credentials.js';
import { WSession } from '../../../dist/session/wsession.js';
import { statedProxy } from '../_shared/inputs/stated.mjs';
import { openAppStoreConnect } from './asc_session.mjs';

const METRICS = {
  impressions: 'the Impressions figure',
  downloads: 'the total downloads figure',
  sales: 'the sales or proceeds figure',
  crashes: 'the Crashes figure',
};

const acct = await getSocialAccount('apple');
if (!acct) throw new Error('ASC_ACCOUNT_ABSENT: no Apple account is stored');

const s = await WSession.start({
  label: 'apple_asc_analytics',
  proxy: statedProxy('the App Store Connect analytics read'),
});
try {
  await openAppStoreConnect(s, '/apps');
  // Each app row carries its id (data-app-id, or the /apps/<id> link) and name.
  const apps = await s.page.evaluate(() =>
    Array.from(document.querySelectorAll('tr[data-app-id], a[href*="/apps/"]'))
      .map((row) => {
        const title = row.querySelector('[class*=name], [class*=title]');
        const linked = row.href ? row.href.match(/apps\/(?<id>\d+)/) : null;
        return {
          id: row.getAttribute('data-app-id')
            ? row.getAttribute('data-app-id')
            : linked?.groups.id,
          name: (title ? title : row).textContent.trim(),
        };
      })
      .filter((app) => app.id),
  );
  console.log(`[asc-analytics] found ${apps.length} apps`);
  const results = [];
  for (const app of apps) {
    await openAppStoreConnect(s, `/analytics/app/${app.id}/overview`);
    const metrics = {};
    for (const [name, what] of Object.entries(METRICS))
      metrics[name] = await shownText(s.page, what);
    results.push({ ...app, ...metrics });
    console.log(`[asc-analytics] ${app.name}:`, JSON.stringify(metrics));
  }
  console.log('PASS:', JSON.stringify(results));
} finally {
  await s.close();
}
