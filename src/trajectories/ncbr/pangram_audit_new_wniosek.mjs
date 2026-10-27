// Read-only Pangram audit of the written answers in an NCBR application draft.
// Extracts each selected LSI2 section's answers to a text file in the run's
// recordings (./audit/extract.mjs), then, unless COLLECT_ONLY=1, runs the
// Pangram analysis on each file as its own action of the same run and reads
// its result and verdict from that action's recordings. Never writes to LSI2
// and never submits the application.
//
// Env: NCBR_CDP_ENDPOINT, NCBR_PROJECT_ID and the NCBR_SECTION_<KEY> of every
// selected section (#ncbr-settings); SECTION_PATTERN limits the sections;
// INCLUDE_ROWS=1 also reads every table row. A section Pangram did not
// analyze fails the run after the report is written.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { exitStatusFor } from '../../../dist/cli/usage.js';
import {
  runId,
  runRecordingsDir,
} from '../../../dist/session/run-recordings.js';
import { projectPage } from '../_shared/ncbr/project_page.mjs';
import { extractSection } from './audit/extract.mjs';
import { selectedSections } from './audit/sections.mjs';

const RESULT_FILE = 'pangram_result.json';
const VERDICT_FILE = 'ban_signal.json';

const slug = (s) =>
  s
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '');

function stats(text) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return {
    chars: text.length,
    words: normalized.split(' ').filter(Boolean).length,
    sha256: createHash('sha256').update(text).digest('hex'),
    preview: normalized,
  };
}

const readJson = (path) =>
  existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;

/** Run the Pangram analysis of one section's text as its own action of this run. */
function runPangram(item, reportDir) {
  const action = `pangram_${slug(item.section_id)}`;
  const actionDir = runRecordingsDir(action);
  const resultPath = join(actionDir, RESULT_FILE);
  const verdictPath = join(actionDir, VERDICT_FILE);
  for (const path of [resultPath, verdictPath]) rmSync(path, { force: true });
  const res = spawnSync(
    process.execPath,
    ['src/trajectories/pangram/analyze_text.mjs'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ACTION: action,
        PANGRAM_TEXT_FILE: item.textFile,
        PANGRAM_REQUIRE_ACCOUNT: '1',
        WELES_CAPTURE_RESPONSE_BODIES: '1',
      },
      encoding: 'utf8',
    },
  );
  const logPath = join(reportDir, `${slug(item.section_id)}.pangram.log`);
  writeFileSync(logPath, [res.stdout, res.stderr].filter(Boolean).join('\n'));
  return {
    section_id: item.section_id,
    title: item.title,
    // A child that started, was not killed by a signal and exited cleanly.
    analyzed: !res.error && !res.signal && !res.status,
    exitCode: res.status,
    signal: res.signal,
    spawnError: res.error ? res.error.message : null,
    logPath,
    result: readJson(resultPath),
    banSignal: readJson(verdictPath),
  };
}

/** One section's Pangram reading, kept only when the run and its verdict prove it. */
function summarize(p) {
  const trusted = Boolean(
    p.analyzed &&
      p.banSignal?.healthy === true &&
      p.result?.source &&
      p.result.source !== 'none',
  );
  const reading = trusted
    ? {
        verdict: p.result.verdict,
        ai_percent: p.result.ai_percent,
        human_percent: p.result.human_percent,
        confidence_percent: p.result.confidence_percent,
        source: p.result.source,
      }
    : null;
  return {
    section_id: p.section_id,
    title: p.title,
    exitCode: p.exitCode,
    banSignal: p.banSignal ? p.banSignal.signal : null,
    trusted,
    reading,
  };
}

const settings = await import('#ncbr-settings');
const browser = await chromium.connectOverCDP(settings.cdpEndpoint());
try {
  const projectUrl = settings.projectUrl();
  const sectionPattern = process.env.SECTION_PATTERN
    ? new RegExp(process.env.SECTION_PATTERN)
    : null;
  const collectOnly = process.env.COLLECT_ONLY === '1';
  const includeRows = process.env.INCLUDE_ROWS === '1';
  const sections = selectedSections(settings, sectionPattern);
  const page = projectPage(browser, projectUrl);

  const reportDir = runRecordingsDir('ncbr_pangram_audit');
  const textDir = join(reportDir, 'sections');
  mkdirSync(textDir, { recursive: true });
  const extracted = [];
  for (const section of sections) {
    const data = await extractSection(page, section, projectUrl, includeRows);
    const textFile = join(textDir, `${slug(section.id)}.txt`);
    writeFileSync(textFile, data.text);
    extracted.push({
      section_id: section.id,
      title: section.title,
      url: section.url,
      textFile,
      answerCount: data.fields.length,
      rowAnswerCount: data.rowFields.length,
      ...stats(data.text),
    });
  }
  const header = {
    projectId: settings.projectId(),
    runId: runId(),
    collectOnly,
    includeRows,
    sectionPattern: process.env.SECTION_PATTERN,
  };
  const manifestPath = join(reportDir, 'manifest.json');
  writeFileSync(
    manifestPath,
    JSON.stringify({ ...header, extracted }, null, ' '),
  );

  const pangram = [];
  if (!collectOnly)
    for (const item of extracted) {
      console.error(
        `[ncbr-pangram] Pangram ${item.section_id} (${item.chars} chars)`,
      );
      pangram.push(runPangram(item, reportDir));
    }
  const summary = pangram.map(summarize);
  const reportPath = join(reportDir, 'report.json');
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        ...header,
        manifestPath,
        extractedCount: extracted.length,
        pangram,
        summary,
      },
      null,
      ' ',
    ),
  );
  console.log(
    JSON.stringify(
      {
        ...header,
        reportDir,
        manifestPath,
        reportPath,
        extractedCount: extracted.length,
        summary,
      },
      null,
      ' ',
    ),
  );
  const unanalyzed = pangram.filter((p) => !p.analyzed);
  if (unanalyzed.length)
    throw new Error(
      `NCBR_PANGRAM_UNANALYZED: Pangram did not analyze sections ${unanalyzed.map((p) => p.section_id).join(', ')}; their logs are in ${reportDir}`,
    );
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = exitStatusFor(error);
} finally {
  // Detaches from the signed-in browser; its pages stay open.
  await browser.close();
}
