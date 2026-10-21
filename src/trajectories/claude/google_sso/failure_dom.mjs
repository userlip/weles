// The evidence a failed GIS handoff leaves behind: the DOM of every live page,
// written next to the run's other recordings (the dispatched action's
// directory, or the run's own), plus an index naming them.
//
// Include popup documents as well as the parent. The index names pages whose
// DOM could not be read or stored and records the corresponding failure.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runRecordingsDir } from '../../../../dist/session/run-recordings.js';

/** The indentation of the index a person reads beside the recordings. */
const JSON_INDENT = '  ';

export async function dumpGisFailureDom(pages, variant) {
  const dir = runRecordingsDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const written = [];
  const missing = [];
  for (const [index, { p, st, variant: v }] of pages.entries()) {
    if (p.isClosed()) continue;
    let html;
    try {
      html = await p.content();
    } catch (readError) {
      missing.push({
        url: st.url,
        variant: v,
        reason: `DOM not read: ${readError.message}`,
      });
      continue;
    }
    const path = join(
      dir,
      `gis_unhandled_${variant}_p${index}_${v}_${stamp}.html`,
    );
    try {
      writeFileSync(path, html);
      written.push({ path, url: st.url, title: st.title, variant: v });
    } catch (writeError) {
      missing.push({
        url: st.url,
        variant: v,
        reason: `DOM not written to ${path}: ${writeError.message}`,
      });
    }
  }
  const indexPath = join(dir, `gis_unhandled_${variant}_${stamp}.json`);
  try {
    writeFileSync(
      indexPath,
      JSON.stringify({ variant, pages: written, missing }, null, JSON_INDENT),
    );
  } catch (indexError) {
    console.log(
      `[google_sso] the DOM index ${indexPath} could not be written: ${indexError.message}`,
    );
  }
  const [first] = written;
  return {
    indexPath,
    written,
    missing,
    /** Where a refusal points a reader: the first page written, else the index. */
    where: first ? first.path : indexPath,
  };
}

/**
 * The refusal of a handoff that ended on a state this step does not drive
 * (`stuck`), or on no live page at all, with every page's DOM written.
 */
export async function unhandledVariantError(stuck, views) {
  const variant = stuck ? stuck.variant : 'no_live_page';
  const dump = await dumpGisFailureDom(views, variant);
  const where = stuck
    ? `${stuck.st.host}${stuck.st.pathname} title="${stuck.st.title}"`
    : 'no live page';
  const evidence = dump.written.length
    ? dump.written.map((w) => w.path).join(', ')
    : dump.indexPath;
  const rows = stuck?.st.rowIdentifiers.length
    ? ` rows=[${stuck.st.rowIdentifiers.join(', ')}]`
    : '';
  const live = views.map((v) => v.variant).join('+');
  return new Error(
    `gis_continue: unhandled variant '${variant}' at ${where}${rows} after its page settled; live pages=${live ? live : 'none'}; DOM snapshot: ${evidence}`,
  );
}
