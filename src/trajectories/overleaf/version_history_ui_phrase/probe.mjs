// Probing the history state: revealing the phrase in the editor, clicking an
// entry by the label the page itself gave it, and recording one probe. A
// step that fails throws with its cause.
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { humanType } from '../../../../dist/human/keyboard.js';
import { pageSettled } from '../../_shared/page/settled.mjs';
import { dump, norm } from './page.mjs';
import { summarizeVisible } from './summarize.mjs';

/** Brings the phrase into the editor's view through its search, unless the page already shows it. */
export async function revealQueryInEditor(page, queryText) {
  const wanted = norm(queryText);
  const before = await summarizeVisible(page, wanted);
  if (before.targetIndex === Math.abs(before.targetIndex))
    return { attempted: false, reason: 'already-found', targetMatchKind: before.targetMatchKind, targetScore: before.targetScore };
  await page.keyboard.press('ControlOrMeta+f');
  await pageSettled(page);
  await humanType(page, wanted);
  await page.keyboard.press('Enter');
  await pageSettled(page);
  await page.keyboard.press('Escape');
  await pageSettled(page);
  const after = await summarizeVisible(page, wanted);
  return { attempted: true, method: 'editor-search', targetMatchKind: after.targetMatchKind, targetScore: after.targetScore, targetIndex: after.targetIndex };
}

/** Clicks the visible element whose text is `text` (exactly, when `exact`); answers whether one was there. */
export async function clickVisibleText(page, text, tag, exact) {
  const found = page.getByText(text, { exact: exact === true }).filter({ visible: true }).first();
  if (!(await found.count())) return { tag, text, clicked: false };
  await found.scrollIntoViewIfNeeded();
  await humanClickLocator(page, found);
  await pageSettled(page);
  return { tag, text, clicked: true };
}

/** One probe of the history state under `tag`, after revealing the phrase when `reveal`. */
export async function probeHistoryState(s, tag, queryText, reveal) {
  const revealResult = reveal === true ? await revealQueryInEditor(s.page, queryText) : null;
  const d = await dump(s, tag);
  const summary = await summarizeVisible(s.page, queryText);
  return {
    tag,
    path: d.text,
    url: s.page.url(),
    targetIndex: summary.targetIndex,
    targetMatchKind: summary.targetMatchKind,
    targetScore: summary.targetScore,
    targetContext: summary.targetContext,
    documentText: summary.documentText,
    documentTextSource: summary.documentTextSource,
    documentTextLength: summary.documentTextLength,
    editorTextSources: summary.editorTextSources,
    revealResult,
    bodyHead: summary.bodyHead,
    visibleItems: summary.visibleItems,
  };
}
