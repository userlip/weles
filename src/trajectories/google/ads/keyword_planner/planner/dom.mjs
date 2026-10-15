// The keyword rows and controls as the planner page renders them, shadow
// roots included. What is visible is the browser's own answer
// (`checkVisibility`); a page that cannot be read fails with its error.
import { keywords, norm } from './settings.mjs';

export async function collectDom(page) {
  return await page.evaluate(() => {
    const textOf = (el) =>
      ('innerText' in el ? el.innerText : el.textContent)
        .replace(/\s+/g, ' ')
        .trim();
    const nodes = [];
    const seen = new Set();
    const visit = (root) => {
      for (const el of root.querySelectorAll('*')) {
        if (seen.has(el)) continue;
        seen.add(el);
        nodes.push(el);
        if (el.shadowRoot) visit(el.shadowRoot);
      }
    };
    visit(document);
    const shown = nodes.filter((el) => el.checkVisibility());
    const rows = shown
      .filter((el) => el.matches('tr, material-list-item, [role="row"]'))
      .map(textOf)
      .filter(Boolean);
    // Every interactive element the page shows, by its markup.
    const controls = shown
      .filter((el) =>
        el.matches(
          'a, button, input, textarea, material-button, [role="button"], [role="menuitem"], [role="textbox"], [aria-label]',
        ),
      )
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role'),
        text: textOf(el),
        aria: el.getAttribute('aria-label'),
        title: el.getAttribute('title'),
        placeholder: el.getAttribute('placeholder'),
        value: typeof el.value === 'string' ? el.value : null,
      }));
    return {
      url: location.href,
      title: document.title,
      text: textOf(document.body),
      rows,
      controls,
    };
  });
}

/** The search volume a row prints: a range such as "1K – 10K", or one figure. */
export function parseVolumeText(value) {
  const text = norm(value);
  const range = text.match(
    /\b(\d+(?:[,.]\d+)?\s*[KM]?)\s*(?:-|–|to)\s*(\d+(?:[,.]\d+)?\s*[KM]?)\b/i,
  );
  if (range) {
    const [found] = range;
    return found.replace(/\s+/g, ' ');
  }
  const number = text.match(/\b\d+(?:[,.]\d+)?\s*[KM]?\b/i);
  if (!number) return null;
  const [found] = number;
  return found.replace(/\s+/g, ' ');
}

// The page's rows that name one of this run's keywords, with the volume and
// bids they show. The competition level is Google's own field, read from the
// planner's API answer (`summarizeKeywordPlannerResponses`), not from the
// words a row prints.
export function parseKeywordRows(rows) {
  const parsed = [];
  for (const row of rows.map(norm).filter(Boolean)) {
    const matchedKeyword = keywords.find((keyword) =>
      row.toLowerCase().includes(keyword.toLowerCase()),
    );
    if (!matchedKeyword) continue;
    const bidMentions = [
      ...row.matchAll(/(?:US)?[$£€]\s?\d+(?:[,.]\d+)?/g),
    ].map((match) => match.shift());
    parsed.push({
      keyword: matchedKeyword,
      averageMonthlySearchesText: parseVolumeText(row),
      bidMentions,
      raw: row,
    });
  }
  return parsed;
}
