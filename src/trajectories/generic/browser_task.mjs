// A generic browser task: the agent completes GENERIC_TASK_OBJECTIVE from
// GENERIC_TASK_URL, under the task's constraints, starting from a saved
// replay, a keeper-first discovery, or a written draft. The proxy is
// GENERIC_TASK_PROXY or PROXY_URL ('direct' for none). The run's result is
// kept in generic_task_result.json and its verdict through the shared
// verdict writer; a task that asks for a person's approval ends with
// pending_review.json instead of failing; any other failure is thrown.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { WSession } from '../../../dist/session/wsession.js';
import { execute, AgentFailure } from '../../../dist/agent/index.js';
import { runRecordingsDir } from '../../../dist/session/run-recordings.js';
import { writeWelesTrajectoryDraft } from '../../../dist/trajectories/writer.js';
import { envString, normalizedReplay, requireHttpUrl, safeStringMap } from './browser_task/inputs.mjs';
import {
  identityInstructions,
  identityPlatformFromConstraints,
  sessionPlatformFromConstraints,
} from './browser_task/identity.mjs';
import { ensureFigmaSession, ensureSupabaseSession } from './browser_task/sso_sessions.mjs';
import { captureRequiredBrowserEvidence } from './browser_task/evidence.mjs';
import { applyCredentialPrefill } from './browser_task/credentials/prefill.mjs';
import { parseJsonEnv, statedProxy } from '../_shared/inputs/stated.mjs';
import { keepVerdict } from '../_shared/action/verdict.mjs';

// The run records under the caller's session label, or under this action.
const label = envString('GENERIC_TASK_LABEL') ? envString('GENERIC_TASK_LABEL') : 'generic_browser_task';
const INDENT = '  ';
const EVIDENCE_POLICY = 'spis-browser-evidence.1';
// The agent's own reason code for a step only a person may approve.
const APPROVAL_REASON = 'needs_human_approval';

function writeJson(name, value) {
  const dir = runRecordingsDir(label);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), JSON.stringify(value, null, INDENT));
}

const url = requireHttpUrl(envString('GENERIC_TASK_URL'));
const objective = envString('GENERIC_TASK_OBJECTIVE');
if (!objective?.trim()) throw new Error('GENERIC_TASK_OBJECTIVE is required');
const constraints = parseJsonEnv('GENERIC_TASK_CONSTRAINTS', {});
const browserEvidencePolicy = parseJsonEnv('WELES_BROWSER_EVIDENCE_POLICY_JSON');
const browserEvidencePolicyActive = envString('WELES_BROWSER_EVIDENCE_POLICY') === EVIDENCE_POLICY;
if (browserEvidencePolicyActive && browserEvidencePolicy?.version !== EVIDENCE_POLICY)
  throw new Error('Spis browser-evidence policy document is missing or inconsistent');
const storesCredentialInSkarbiec = constraints.store_secret_target === 'skarbiec';
if (storesCredentialInSkarbiec) {
  process.env.WELES_SECURE_CREDENTIAL_TASK = '1';
  process.env.WELES_NO_INSTRUMENT = '1';
  process.env.WELES_DISABLE_RECORDING = '1';
  process.env.WELES_PAGE_DIAGNOSTICS = '0';
}
if (browserEvidencePolicyActive && storesCredentialInSkarbiec)
  throw new Error('Spis browser-evidence tasks cannot acquire or store credentials');
const envHints = safeStringMap(parseJsonEnv('GENERIC_TASK_ENV'));
for (const [key, value] of Object.entries(envHints)) process.env[key] = value;

const flowName = envString('GENERIC_TASK_FLOW_NAME')
  ? envString('GENERIC_TASK_FLOW_NAME')
  : `generic:${new URL(url).hostname}:${objective.toLowerCase().replace(/[^a-z\d]+/g, '-')}`;
const proxy = statedProxy('the generic browser task', 'GENERIC_TASK_PROXY');
const keeperFirst = envString('GENERIC_TASK_KEEPER_FIRST') === '1';
const replay = normalizedReplay(parseJsonEnv('GENERIC_TASK_REPLAY'));
const replayOnly = envString('GENERIC_TASK_REPLAY_ONLY') === '1';
const skipSavedFlowReplay =
  keeperFirst || envString('GENERIC_TASK_SKIP_SAVED_FLOW_REPLAY') === '1' || Boolean(replay);

/** The draft the agent starts from: a saved replay, a keeper-first discovery, or a written draft. */
async function initialDraft() {
  if (replay)
    return {
      source: 'saved-replay',
      guidance:
        'Replay-only validation mode: execute the persisted trajectory steps from the database. Do not ask the model to invent replacement steps if replay fails.',
      steps: replay,
    };
  if (keeperFirst)
    return {
      source: 'keeper-first',
      guidance: storesCredentialInSkarbiec
        ? 'Keeper-first discovery mode: complete the live browser flow. Credential material must be finalized only through store_credential; a stored confirmation saves the executed action history as the trajectory.'
        : 'Keeper-first discovery mode: complete the live browser flow before creating a reusable trajectory. A successful done(value) saves the executed action history as the trajectory.',
      steps: [],
    };
  return writeWelesTrajectoryDraft({ objective });
}

/** The goal text handed to the agent. */
function goalFor(trajectoryDraft, completedPrefills) {
  return [
    objective,
    '',
    ...identityInstructions(identityPlatformFromConstraints(constraints)),
    '',
    trajectoryDraft.guidance,
    'Draft guidance remains subordinate to the objective, constraints and current page:',
    ...trajectoryDraft.steps.filter((step) => typeof step === 'string'),
    ...(completedPrefills.length
      ? [
          `Already completed credential fills: ${JSON.stringify(completedPrefills)}`,
          'Their single-use capabilities are consumed and are not available to fill again. Continue from the current page instead of repeating initialization. Navigation may clear these fields; if no unspent capability remains, stop and report that state rather than inventing credentials.',
        ]
      : []),
    '',
    `Initial URL: ${url}`,
    `Constraints: ${JSON.stringify(constraints)}`,
    ...(browserEvidencePolicyActive
      ? [
          'The Weles service enforces the attached browser-evidence policy before every interactive tool and inside page permission APIs. Treat policy_withheld results as retained evidence and continue only with non-interactive observation.',
          `Browser-evidence policy: ${JSON.stringify(browserEvidencePolicy)}`,
        ]
      : []),
    'Do not make purchases, submit payments, delete data, or perform irreversible/destructive actions.',
    storesCredentialInSkarbiec
      ? 'Do not call done with extracted credential data. Finish only after store_credential has confirmed encrypted storage; return only its non-secret receipt.'
      : 'When finished, call done(value) with a concise JSON-serializable summary and any extracted data.',
  ].join('\n');
}

function draftSummary(trajectoryDraft) {
  if (!trajectoryDraft) return null;
  const { source, model, steps, error } = trajectoryDraft;
  return { source, model, steps, error };
}

let session = null;
let result = null;
let trajectoryDraft = null;
let verdict;
let failure;
const initialHistory = [];
try {
  console.log(
    `[generic] url=${url} flow=${flowName} mode=${keeperFirst ? 'keeper_first' : replay ? 'saved_replay' : 'draft_first'}`,
  );
  trajectoryDraft = await initialDraft();
  session = await WSession.start({
    label,
    proxy,
    targetHost: new URL(url).hostname,
    headless: envString('GENERIC_TASK_HEADLESS') === '1',
    browser: envString('GENERIC_TASK_BROWSER'),
    os: envString('GENERIC_TASK_OS'),
    locale: envString('GENERIC_TASK_LOCALE'),
    platform: sessionPlatformFromConstraints(constraints),
    pageDiagnostics: keeperFirst ? false : undefined,
  });
  initialHistory.push({ tool: 'navigate', args: { url }, result: await session.goto(url) });
  const completedPrefills = await applyCredentialPrefill(session, constraints, initialHistory);
  await ensureSupabaseSession(session, constraints);
  await ensureFigmaSession(session, constraints);
  result = await execute(session, goalFor(trajectoryDraft, completedPrefills), {
    envHints,
    initialHistory,
    flowName,
    replay,
    replayOnly,
    skipSavedFlowReplay,
    disableFlowPersistence: browserEvidencePolicyActive || Boolean(completedPrefills.length),
    disableArtifacts: browserEvidencePolicyActive,
  });
  const history = result.history.slice(initialHistory.length);
  if (browserEvidencePolicyActive) await captureRequiredBrowserEvidence(session);
  const finalUrl = session.page.url();
  writeJson(
    'generic_task_result.json',
    browserEvidencePolicyActive
      ? { ok: true, url, final_url: finalUrl, step_count: history.length, completed_at: new Date().toISOString() }
      : {
          ok: true,
          url,
          final_url: finalUrl,
          value: result.value,
          initialization_history: initialHistory,
          history,
          trajectory_draft: draftSummary(trajectoryDraft),
          completed_at: new Date().toISOString(),
        },
  );
  verdict = { signal: 'healthy', healthy: true, details: { final_url: finalUrl, steps: history.length } };
  console.log(`PASS: ${label}`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const steps = error instanceof AgentFailure ? error.history : result ? result.history : [];
  const history = steps.slice(initialHistory.length);
  const finalUrl = session ? session.page.url() : null;
  const needsHumanApproval =
    message.includes(APPROVAL_REASON) ||
    history.some((step) => String(step?.args?.reason).includes(APPROVAL_REASON));
  writeJson(
    'generic_task_result.json',
    browserEvidencePolicyActive
      ? { ok: false, url, final_url: finalUrl, error: message, history_steps: history.length, completed_at: new Date().toISOString() }
      : {
          ok: false,
          url,
          final_url: finalUrl,
          error: message,
          initialization_history: initialHistory,
          history,
          trajectory_draft: draftSummary(trajectoryDraft),
          completed_at: new Date().toISOString(),
        },
  );
  verdict = {
    signal: needsHumanApproval ? 'pending_review' : 'task_failed',
    healthy: needsHumanApproval,
    details: { final_url: finalUrl, error: message, steps: history.length },
  };
  if (needsHumanApproval)
    writeJson('pending_review.json', {
      status: APPROVAL_REASON,
      reason: message,
      final_url: finalUrl,
      history_steps: history.length,
      completed_at: new Date().toISOString(),
    });
  else failure = error;
  console.log(`${needsHumanApproval ? 'PENDING' : 'FAIL'}: ${message}`);
} finally {
  if (session) await session.close();
}
try {
  await keepVerdict(label, null, verdict);
} catch (keepError) {
  failure = failure
    ? new AggregateError([failure, keepError], `${failure.message}; and its verdict was not kept: ${keepError.message}`)
    : keepError;
}
if (failure) throw failure;
