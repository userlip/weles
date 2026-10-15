// Getting one harvest onto this machine. The keeper session owns the logged-in
// Google Ads browser profile, so this module proves the keeper is answering on
// its socket, then runs the keeper runner (keyword_planner/keeper.mjs) as a
// child for this one request and reads back the result file it wrote —
// rewritten with credentials redacted before anyone else sees it. It never
// starts a keeper: a detached keeper would outlive the request as a second
// permanent Weles process. A keeper that does not answer, a runner that cannot
// start and a result file that cannot be read or redacted are thrown with
// their cause, marked as upstream failures. The child inherits the process's
// recording and instrumentation switches as they are; none is set here.

import {
  keeperRequest,
  keeperSocket,
} from '../../../../_shared/keeper/client.mjs';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DIAG_DIR,
  REPO,
  RUNNER,
  redact,
  stripAmbientCredentialEnv,
} from './service_settings.mjs';
import { safeSlug } from './request_intake.mjs';
import { HTTP_UPSTREAM_FAILED } from '../../../../../worker/weles-api-server/routes/http-status.mjs';

const INDENT = '  ';

/** An error the route answers as an upstream failure, with its cause. */
function upstreamFailure(message, cause) {
  return Object.assign(new Error(message, { cause }), {
    status: HTTP_UPSTREAM_FAILED,
  });
}

/** Refuses unless the keeper answers on its socket. */
async function ensureKeeper(session) {
  const socket = keeperSocket(session);
  const answer = await keeperRequest(socket, { action: 'url' }).catch(
    (error) => {
      throw upstreamFailure(
        `KEEPER_NOT_READY: keeper session ${session} does not answer on ${socket}: ${error.message}`,
        error,
      );
    },
  );
  if (!answer.ok)
    throw upstreamFailure(
      `KEEPER_NOT_READY: keeper session ${session} refused the url action: ${answer.error ? answer.error : 'it gave no reason'}`,
    );
}

// The child writes its metrics unredacted; nobody reads that file until it has
// been rewritten with credentials redacted.
function readRedactedPlannerResult(resultFile) {
  const report = JSON.parse(readFileSync(resultFile, 'utf8'));
  writeFileSync(
    resultFile,
    JSON.stringify(JSON.parse(redact(JSON.stringify(report))), null, INDENT),
  );
  return report;
}

export async function runKeywordPlanner(input) {
  mkdirSync(DIAG_DIR, { recursive: true });
  const [firstKeyword] = input.keywords;
  const resultFile = join(
    DIAG_DIR,
    `${Date.now()}-${process.pid}-${safeSlug(firstKeyword)}.json`,
  );
  await ensureKeeper(input.session);

  return await new Promise((resolveRun, rejectRun) => {
    const childEnv = stripAmbientCredentialEnv({
      ...process.env,
      SESSION: input.session,
      GOOGLE_ADS_CUSTOMER_ID: input.customerId,
      GOOGLE_ADS_KEYWORDS: input.keywords.join('\n'),
      GOOGLE_ADS_RESULT_FILE: resultFile,
      GOOGLE_ADS_KEYWORD_BROWSER_AUTOMATION: '1',
    });

    const child = spawn(process.execPath, [RUNNER], {
      cwd: REPO,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      rejectRun(
        upstreamFailure(
          `KEYWORD_PLANNER_RUNNER_FAILED: the keeper runner ${RUNNER} could not start: ${error.message}`,
          error,
        ),
      );
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (!existsSync(resultFile)) {
        resolveRun({
          ok: false,
          exitCode: code,
          stdout,
          stderr,
          resultFile,
          report: null,
        });
        return;
      }
      let report;
      try {
        report = readRedactedPlannerResult(resultFile);
      } catch (error) {
        rejectRun(
          upstreamFailure(
            `KEYWORD_PLANNER_RESULT_UNREADABLE: ${resultFile} could not be read and rewritten with credentials redacted: ${error.message}`,
            error,
          ),
        );
        return;
      }
      resolveRun({
        ok: !code && Boolean(report.ok),
        exitCode: code,
        stdout,
        stderr,
        resultFile,
        report,
      });
    });
  });
}
