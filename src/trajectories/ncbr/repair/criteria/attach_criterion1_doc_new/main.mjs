// Criterion-1 attachments for the NCBR wniosek NCBR_PROJECT_ID names. Never submits.
// MODE=read compares the saved attachment row; MODE=apply saves attachments and verifies downloaded bytes.
// NCBR_CRITERION1_PACKAGE_DIR names the package folder; its PDFs in file-name order are the attachments.
// MODE=apply also needs NCBR_CRITERION1_MAX_FILES and NCBR_CRITERION1_MAX_FILE_BYTES, the live field's limits.
// EDIT_EXISTING=1 selects the current row; REPLACE_FILE names its exact superseded PDF; REPORT_DIR retains evidence.
// DIAG=1 only inspects. RESUME_STAGED=1 continues an interrupted open drawer without navigating or duplicating uploads.

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  humanClickLocator,
  humanIdlePause,
} from '../../../../../../dist/human/mouse.js';
import { declaredRun, errorText } from './declared.mjs';
import {
  APPLICANT,
  closeDrawer,
  compareFiles,
  downloadFile,
  fileLabel,
  openCriterion1Add,
  openExistingCriterion1Edit,
  readUploaded,
  selectApplicant,
  waitReady,
} from './drawer.mjs';

const LSI_ORIGIN = 'https://lsi2.ncbr.gov.pl/';
const INDENT = '  ';
const UNSUBMITTED_STATUS = 'Rekomendacje poprawy przekazane wnioskodawcy';

const settings = await import('#ncbr-settings');
const endpoint = settings.cdpEndpoint();
const projectId = settings.projectId();
const projectUrl = `${LSI_ORIGIN}projekt/${projectId}`;
const run = declaredRun();
const declared = run.files;
const declaredNames = declared.map((file) => file.name);

const browser = await chromium.connectOverCDP(endpoint);
const [context] = browser.contexts();
const page = context
  ?.pages()
  .find((candidate) => candidate.url().startsWith(LSI_ORIGIN));
if (!page) throw new Error(`no ${LSI_ORIGIN} page is open over ${endpoint}`);

if (!run.resumeStaged) {
  await page.goto(projectUrl, { waitUntil: 'domcontentloaded' });
  await humanIdlePause('long');
  if (page.url().includes('/logowanie'))
    throw new Error(`LSI2 login required at ${page.url()}`);
  const documentsButton = page
    .getByText('Dokumenty', { exact: true })
    .filter({ visible: true })
    .first();
  if (!(await documentsButton.count()))
    throw new Error('Dokumenty control not found');
  await humanClickLocator(page, documentsButton);
  await humanIdlePause('long');
} else if (
  !page.url().startsWith(`${projectUrl}/dokumenty/`) ||
  !(await page.locator('#collection-obj-form-save-btn').isVisible())
) {
  throw new Error(
    'RESUME_STAGED requires the existing open attachment drawer; nothing changed',
  );
}

const reportDir = process.env.REPORT_DIR;
const report = {
  mode: run.mode,
  resumeStaged: run.resumeStaged,
  package: run.dir,
  projectId,
  startedAt: new Date().toISOString(),
  files: declared,
  events: [],
  submitted: false,
};
function record(phase, data = {}) {
  report.events.push({ at: new Date().toISOString(), phase, ...data });
  if (reportDir) {
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(
      join(reportDir, 'report.json'),
      JSON.stringify(report, null, INDENT),
    );
  }
  console.log(JSON.stringify({ phase, ...data }));
}

if (!run.resumeStaged) {
  if (run.read || process.env.EDIT_EXISTING)
    await openExistingCriterion1Edit(page);
  else await openCriterion1Add(page);
}
const before = await readUploaded(page);
record('before', { state: compareFiles(before, declaredNames) });
if (run.read) {
  const state = compareFiles(before, declaredNames);
  if (reportDir)
    await page.screenshot({
      path: join(reportDir, 'page.png'),
      fullPage: true,
    });
  await closeDrawer(page);
  console.log(JSON.stringify(state, null, INDENT));
  if (!state.complete)
    throw new Error(
      `the saved criterion-1 row differs from the package: missing ${state.missing.join(', ')}; extra ${state.extra.join(', ')}`,
    );
  process.exit();
}

if (process.env.DIAG) {
  record('diagnostic', {
    url: page.url(),
    text: await page.locator('body').innerText(),
    buttons: await page.locator('button').evaluateAll((buttons) =>
      buttons.map((button) => ({
        id: button.id,
        text: button.innerText,
        label: button.getAttribute('aria-label'),
        disabled: button.disabled,
      })),
    ),
  });
  process.exit();
}

if (!reportDir)
  throw new Error(
    'MODE=apply requires REPORT_DIR to retain the original attachment and upload evidence',
  );
const replaceName = process.env.REPLACE_FILE;
const unexpected = before.filter(
  (file) => !declaredNames.includes(file.name) && file.name !== replaceName,
);
if (unexpected.length)
  throw new Error(
    `Unexpected attachments; nothing changed: ${unexpected.map((file) => file.name).join(', ')}`,
  );
const applicant = process.env.EDIT_EXISTING
  ? `existing ${APPLICANT} row`
  : await selectApplicant(page);
const documentsUrl = page.url();

try {
  let changed = run.resumeStaged;
  if (replaceName && before.some((file) => file.name === replaceName)) {
    const backup = await downloadFile(
      page,
      replaceName,
      join(reportDir, 'previous'),
    );
    record('backed-up-original', backup);
    const row = fileLabel(page, replaceName).locator('..');
    await humanClickLocator(
      page,
      row.locator('button:has(svg[data-testid="CloseIcon"])'),
    );
    await fileLabel(page, replaceName).waitFor({ state: 'detached' });
    changed = true;
    record('removed-from-form', { name: replaceName });
  }

  for (const file of declared) {
    const existing = (await readUploaded(page)).find(
      (row) => row.name === file.name,
    );
    if (existing?.ready) continue;
    if (existing)
      throw new Error(`Existing attachment is not ready: ${file.name}`);
    // This widget accepts one file per selection even though the row holds several PDFs.
    await page
      .locator('input[type="file"][accept*=".pdf"]')
      .last()
      .setInputFiles(file.path);
    await waitReady(page, file.name);
    changed = true;
    record('uploaded', {
      name: file.name,
      bytes: file.bytes,
      sha256: file.sha256,
    });
  }

  const staged = compareFiles(await readUploaded(page), declaredNames);
  record('staged', { state: staged });
  if (!staged.complete)
    throw new Error(
      'The staged attachments do not match the complete declared package',
    );
  await page.screenshot({
    path: join(reportDir, 'staged.png'),
    fullPage: true,
  });

  if (changed) {
    const save = page
      .getByRole('button', { name: 'Zapisz', exact: true })
      .filter({ visible: true })
      .last();
    if (!(await save.isEnabled()))
      throw new Error('The attachment-row Save button is disabled');
    await save.press('Enter'); // activate only this Save button; the cookie notice covers its click target
    await page
      .getByRole('button', { name: 'close side drawer', exact: true })
      .waitFor({ state: 'hidden' });
    record('saved-row');
    const parentSave = page.locator('#section-form-save-btn');
    await parentSave.waitFor({ state: 'visible' });
    await page.screenshot({
      path: join(reportDir, 'parent-before-save.png'),
      fullPage: true,
    });
    if (await parentSave.isEnabled()) {
      await parentSave.press('Enter');
      await page.waitForFunction(() => {
        const button = Array.from(document.querySelectorAll('button')).find(
          (element) => element.innerText.trim() === 'Zapisz',
        );
        return button?.disabled === true;
      });
      record('saved-document-section');
    }
  } else {
    await closeDrawer(page);
  }

  // Prove persistence from a newly loaded page, not the unsaved drawer's local state.
  await page.goto(documentsUrl, { waitUntil: 'domcontentloaded' });
  await humanIdlePause('long');
  const status = await page.locator('body').innerText();
  if (!status.includes(UNSUBMITTED_STATUS)) {
    throw new Error(
      'Unexpected application status after attachment save; no submission was requested',
    );
  }
  await openExistingCriterion1Edit(page);
  const persisted = compareFiles(await readUploaded(page), declaredNames);
  record('persisted', { state: persisted });
  if (!persisted.complete)
    throw new Error(
      'Reloaded LSI2 attachments do not match the declared package',
    );
  await page.screenshot({
    path: join(reportDir, 'persisted.png'),
    fullPage: true,
  });

  for (const file of declared) {
    const downloaded = await downloadFile(
      page,
      file.name,
      join(reportDir, 'downloaded'),
    );
    if (downloaded.sha256 !== file.sha256 || downloaded.bytes !== file.bytes) {
      throw new Error(
        `The saved PDF bytes differ from the declared source: ${file.name}`,
      );
    }
    record('download-verified', downloaded);
  }
  await closeDrawer(page);
  record('complete', {
    applicant,
    url: page.url(),
    attachmentCount: persisted.rows.length,
    submitted: false,
  });
} catch (error) {
  record('failed', { error: errorText(error), url: page.url() });
  throw error;
}
process.exit();
