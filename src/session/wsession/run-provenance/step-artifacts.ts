// The screenshot and DOM dump WSession.runStep takes around every step, plus a
// named record of any artifact that could not be written. A missing
// screenshot never aborts the step it belongs to, but it never disappears
// either: the reason lands in the run log, on the session as
// stepArtifactFailures, and in step_artifact_failures.json next to the
// artifacts it was supposed to join.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WSession } from '../../wsession.js';
import { recordingsDir } from '../../run-recordings.js';
import {
  JSON_INDENT,
  type StepArtifactFailure,
  type StepPhase,
} from '../run-provenance.js';

/**
 * Take the screenshot + DOM dump for one step phase. Neither artifact aborts
 * the step: an artifact that could not be written is recorded by name instead.
 * `cause` carries the step's own failure in the 'error' phase, so a recorder
 * that cannot even write its ledger reports both failures rather than
 * replacing the one the caller is about to throw.
 */
export async function captureStepArtifacts(
  ws: WSession,
  phase: StepPhase,
  step: string,
  cause?: unknown,
): Promise<void> {
  const at = new Date().toISOString();
  const failures: StepArtifactFailure[] = [];
  // The capture surface is private to WSession; this is the same session
  // object, viewed through the one member this recorder needs.
  const capture = ws as unknown as {
    _cap: { screenshot(page: unknown, label: string): Promise<string> };
  };
  try {
    await capture._cap.screenshot(ws.page, `${phase}_${step}`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    failures.push({
      step,
      phase,
      artifact: 'screenshot',
      reason: `the ${phase} screenshot could not be taken: ${reason}`,
      at,
    });
  }
  try {
    const html = await ws.page.content?.();
    if (html)
      writeFileSync(
        join(recordingsDir(ws.label), `${phase}_${step}_dom.html`),
        html,
      );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    failures.push({
      step,
      phase,
      artifact: 'dom',
      reason: `the ${phase} DOM dump could not be written: ${reason}`,
      at,
    });
  }
  if (!failures.length) return;
  for (const failure of failures)
    console.log(
      `[wsession] ${step} ARTIFACT MISSING ${failure.artifact} — ${failure.reason}`,
    );
  ws.stepArtifactFailures.push(...failures);
  try {
    writeFileSync(
      join(recordingsDir(ws.label), 'step_artifact_failures.json'),
      JSON.stringify(ws.stepArtifactFailures, null, JSON_INDENT),
    );
  } catch (ledgerError) {
    const ledgerReason =
      ledgerError instanceof Error ? ledgerError.message : String(ledgerError);
    if (cause !== undefined) {
      const stepReason = cause instanceof Error ? cause.message : String(cause);
      throw new Error(
        `step ${step} failed and its missing-artifact record could not be written: ${stepReason}; and the record write failed: ${ledgerReason}`,
        { cause },
      );
    }
    throw ledgerError;
  }
}
