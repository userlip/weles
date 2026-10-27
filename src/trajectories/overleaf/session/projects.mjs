// The projects Overleaf's dashboard lists, read from its project links. The
// dashboard loads rows as it is scrolled, so the last row is brought into
// view until a settled page shows no more rows than before.
import { pageSettled } from '../../_shared/page/settled.mjs';

const PROJECT_HREF = /\/project\/(?<id>[\dA-Fa-f]+)(?:[/?#]|$)/;

/** Every dashboard project as { id, name }, once each, in the dashboard's order. */
export async function dashboardProjects(page) {
  const anchors = page.locator('a[href*="/project/"]');
  await anchors.first().waitFor({ state: 'visible' });
  let previous;
  for (
    let count = await anchors.count();
    count !== previous;
    count = await anchors.count()
  ) {
    previous = count;
    await anchors.last().scrollIntoViewIfNeeded();
    await pageSettled(page);
  }
  const byId = new Map();
  for (const anchor of await anchors.all()) {
    const id = (await anchor.getAttribute('href')).match(PROJECT_HREF)?.groups
      .id;
    if (id && !byId.has(id)) byId.set(id, (await anchor.textContent()).trim());
  }
  return [...byId].map(([id, name]) => ({ id, name }));
}
