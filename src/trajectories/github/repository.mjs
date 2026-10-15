// The repository a GitHub action acts on, as the caller states it: TARGET_URL
// (its page, taken first by the shared action runner), SEARCH_QUERY (the
// most-starred match of a repository search), or REPO_URL (owner/repo or its
// URL). Nothing is acted on by default: with none of them the run is refused
// rather than opening GitHub's trending page.
import { humanClickLocator } from '../../../dist/human/mouse.js';
import { statedText } from '../_shared/inputs/stated.mjs';
import { pageSettled } from '../_shared/page/settled.mjs';

export const GITHUB_ORIGIN = 'https://github.com';
const SEARCH_ROUTE = '/search';

/**
 * A repository stated as owner/repo or as its github.com address, as its
 * https://github.com/<owner>/<repo> page. Anything else is refused.
 */
export function repositoryUrl(raw) {
  const address = URL.canParse(raw)
    ? new URL(raw)
    : new URL(raw.replace(/^\/+/, ''), `${GITHUB_ORIGIN}/`);
  const [owner, repo, ...beyond] = address.pathname.split('/').filter(Boolean);
  if (
    address.origin !== GITHUB_ORIGIN ||
    address.username ||
    address.password ||
    !owner ||
    !repo ||
    beyond.length
  )
    throw new Error(
      `REPO_URL must name a GitHub repository as owner/repo or https://github.com/owner/repo, not "${raw}"`,
    );
  return `${GITHUB_ORIGIN}/${owner}/${repo}`;
}

/** The action-runner config fields that land on the stated repository. */
export function repositoryTarget(what) {
  return {
    feedUrl: () =>
      repositoryUrl(
        statedText(
          ['REPO_URL'],
          `the repository to ${what} (or TARGET_URL, or SEARCH_QUERY for its most-starred match)`,
        ),
      ),
    resolveSearchUrl: (query) =>
      `${GITHUB_ORIGIN}${SEARCH_ROUTE}?q=${encodeURIComponent(query)}&type=repositories&s=stars&o=desc`,
  };
}

/** From a repository search, open its most-starred result. */
export async function openSearchedRepository(s) {
  if (new URL(s.page.url()).pathname !== SEARCH_ROUTE) return;
  const repoLink = s.page
    .locator('article h3 a, article h2 a, a[data-hydro-click*="REPOSITORY"]')
    .filter({ visible: true })
    .first();
  await repoLink.waitFor({ state: 'visible' });
  await humanClickLocator(s.page, repoLink);
  await pageSettled(s.page);
}
