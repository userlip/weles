// Google Scholar citation counts for arXiv ids or free-text queries, through
// the stated proxy. The first result tile is read: its title, and its
// citation count from the "cited by" link (the one to ?cites=), which Scholar
// leaves out when nothing cites the paper. Google's rate-limit page or
// captcha is solved once by the session's captcha solver; a second one means
// Google is limiting this exit, which another token does not change.
//
// Output: TSV on stdout, `<key>\t<citations>\t<title>`; a query that fails
// prints ERR with its cause, and the run fails after every query was tried.
//
// Usage: node src/trajectories/google/scholar/citations.mjs <arxiv_id|"title"> [...]
// Env: PROXY_URL (required: the proxy each query goes through, or 'direct').
import { WSession } from '../../../../dist/session/wsession.js';
import { exitStatusFor } from '../../../../dist/cli/usage.js';
import { statedProxy } from '../../_shared/inputs/stated.mjs';
import { pageSettled } from '../../_shared/page/settled.mjs';

const [, , ...QUERIES] = process.argv;
if (!QUERIES.length)
  throw new Error(
    'SCHOLAR_QUERY_REQUIRED: name at least one arXiv id or title',
  );

/** Whether Google shows its rate-limit page or a captcha in place of the results. */
const gated = (page) =>
  page.evaluate(
    () =>
      location.pathname.startsWith('/sorry') ||
      Boolean(
        document.querySelector(
          '#captcha-form, #gs_captcha_f, iframe[src*="recaptcha"]',
        ),
      ),
  );

async function citations(s, query) {
  await s.goto(
    `https://scholar.google.com/scholar?q=${encodeURIComponent(query)}`,
  );
  await pageSettled(s.page);
  if (await gated(s.page)) {
    const answer = await s.solveCaptcha();
    if (answer !== 'captcha solved')
      throw new Error(`scholar_captcha_unsolved: ${answer}`);
    await pageSettled(s.page);
    if (await gated(s.page))
      throw new Error(
        'scholar_rate_limited: the captcha came back after it was solved',
      );
  }
  const tile = await s.page.evaluate(() => {
    const result = document.querySelector('.gs_r.gs_or.gs_scl');
    if (!result) return null;
    const cites = result.querySelector('a[href*="cites="]');
    const title = result.querySelector('.gs_rt');
    return {
      title: title ? title.textContent.trim() : null,
      cites: cites ? cites.textContent.match(/\d+/)?.[0] : null,
    };
  });
  if (!tile)
    throw new Error(
      `scholar_no_results: the settled page shows no result tile (${s.page.url()})`,
    );
  return {
    title: tile.title,
    citations: tile.cites ? Number(tile.cites) : Number(Boolean(tile.cites)),
  };
}

const s = await WSession.start({
  label: 'scholar_citations',
  proxy: statedProxy('each Google Scholar query'),
});
const failures = [];
try {
  console.log('key\tcitations\ttitle');
  for (const query of QUERIES)
    await citations(s, query).then(
      (found) => console.log(`${query}\t${found.citations}\t${found.title}`),
      (error) => {
        failures.push(error);
        console.log(`${query}\tERR\t${error.message}`);
      },
    );
  if (failures.length)
    throw new AggregateError(
      failures,
      `${failures.length} of ${QUERIES.length} queries failed`,
    );
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = exitStatusFor(error);
} finally {
  await s.close();
}
