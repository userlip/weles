// The tab of the declared NCBR project in the signed-in browser a run
// attached to over DevTools. NCBR trajectories drive only that tab: a run
// whose browser shows no page of the project is refused, instead of taking
// whichever tab happens to be first.

/** The open page of `projectUrl` in `browser`'s signed-in context. */
export function projectPage(browser, projectUrl) {
  const [context] = browser.contexts();
  const page = context
    ?.pages()
    .find((candidate) => candidate.url().startsWith(projectUrl));
  if (!page)
    throw new Error(
      `NCBR_PROJECT_TAB_MISSING: no open browser page belongs to ${projectUrl}`,
    );
  return page;
}
