// Whether text a page shows names a wanted value: the same words, or their
// start closed by the ellipsis a page draws when it cuts a long value. How
// much of a value a page shows is the page's own choice, so no prefix length
// is chosen by the caller; a CSS cut leaves the text whole, and a cut in the
// text marks itself.
//
// `shows` runs in Node; `cellShowsSource` and `rowShowingSource` are the same
// rule as functions a page evaluates over its table cells
// (page.evaluate(cellShowsSource, value)), because a function passed to the
// browser cannot close over this module.
export function shows(shown, wanted) {
  const words = (text) => text.replace(/\s+/g, ' ').trim();
  const [seen, name] = [words(shown), words(wanted)];
  if (seen === name) return true;
  const cut = seen.match(/^(?<start>.+?)\s*(…|\.\.\.)$/);
  return cut !== null && name.startsWith(cut.groups.start);
}

export function cellShowsSource(wanted) {
  const words = (text) => text.replace(/\s+/g, ' ').trim();
  const name = words(wanted);
  return Array.from(document.querySelectorAll('table td')).some((td) => {
    const seen = words(td.innerText);
    if (seen === name) return true;
    const cut = seen.match(/^(?<start>.+?)\s*(…|\.\.\.)$/);
    return cut !== null && name.startsWith(cut.groups.start);
  });
}

// The index among `table tbody tr` of the unique row showing the wanted
// value, or -1 when absent. Ambiguous displayed prefixes must never pick a row.
export function rowShowingSource(wanted) {
  const words = (text) => text.replace(/\s+/g, ' ').trim();
  const name = words(wanted);
  const rows = Array.from(document.querySelectorAll('table tbody tr'));
  const matches = rows.filter((tr) =>
    Array.from(tr.querySelectorAll('td')).some((td) => {
      const seen = words(td.innerText);
      if (seen === name) return true;
      const cut = seen.match(/^(?<start>.+?)\s*(…|\.\.\.)$/);
      return cut !== null && name.startsWith(cut.groups.start);
    }),
  );
  const [match, ...duplicates] = matches;
  if (duplicates.length) {
    throw new Error(
      `row_source_ambiguous: ${JSON.stringify({
        wanted: name,
        rows: matches.map((row) => words(row.innerText)),
      })}`,
    );
  }
  return rows.indexOf(match);
}

// Whether text a trajectory typed now shows on the page as posted content.
// A composer keeps the typed draft until the send goes through, and a
// contenteditable composer's draft is page text, so finding the text anywhere
// on the page proves nothing: a send that failed leaves it in the composer.
// The text counts only when it shows outside every editable field.
export async function textShownOutsideEditors(page, text) {
  return page.evaluate((wanted) => {
    const body = document.body.cloneNode(true);
    body
      .querySelectorAll('[contenteditable="true"], textarea, input')
      .forEach((field) => field.remove());
    return body.textContent.includes(wanted);
  }, text);
}
