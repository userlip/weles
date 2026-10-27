// What every step of an account purchase does with a page: name the failure
// with the DOM it failed on, and click the first visible control a pattern
// names.

import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { pageSettled } from '../../_shared/page/settled.mjs';
import { AuthenticationFailure } from '../../_shared/subscription-auth/oauth.mjs';
import { dumpGisFailureDom } from '../google_sso/failure_dom.mjs';

/** Fail `stage` with `code`, saving the page's DOM beside the run. */
export async function failOnPage(page, code, stage, sentence) {
  const [read] = await Promise.allSettled([page.title()]);
  const title =
    read.status === 'fulfilled'
      ? read.value
      : `(title unreadable: ${read.reason.message})`;
  const dump = await dumpGisFailureDom(
    [{ p: page, st: { url: page.url(), title }, variant: code }],
    code,
  );
  const evidence = dump.written.length
    ? dump.written.map((entry) => entry.path).join(', ')
    : `index ${dump.indexPath}`;
  throw new AuthenticationFailure(
    code,
    stage,
    `${sentence}; page ${page.url()} titled "${title}"; DOM snapshot: ${evidence}`,
  );
}

/** Click the first visible control - a button, link, radio or option - whose
 * text matches `pattern`; false when the page shows none. */
export async function clickNamed(page, pattern) {
  const control = page
    .locator(
      'button, a, [role="button"], [role="link"], [role="radio"], [role="option"]',
    )
    .filter({ hasText: pattern, visible: true })
    .first();
  if (!(await control.count())) return false;
  await humanClickLocator(page, control);
  await pageSettled(page);
  return true;
}
