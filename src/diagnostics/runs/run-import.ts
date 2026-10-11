// Shared run-diagnostics provenance import used by queued worker jobs and
// persistent keeper sessions.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  analyzeChallengeOutcome,
  type ChallengeOutcome,
} from './challenge_outcome.js';
import { snapshotSanitizedEnvironment } from '../../utils/sanitize-env.js';

const RECORDINGS_ROOT = process.env.RECORDINGS_ROOT ?? 'recordings';

// Artifacts live under recordings/<run_uuid>/ across varying sub-action/label
// dirs. Find a file by name anywhere in the run's tree.
async function findInRun(
  runId: string,
  filename: string,
): Promise<string | null> {
  async function walk(dir: string): Promise<string | null> {
    let entries: any[];
    try {
      entries = (await readdir(dir, { withFileTypes: true } as any)) as any;
    } catch (error) {
      // A directory that is not there holds nothing; one that cannot be
      // listed is thrown with its path, so a file in it is not taken as absent.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new Error(
        `run directory ${dir} cannot be listed: ${(error as Error).message}`,
      );
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        const r = await walk(full);
        if (r) return r;
      } else if (e.name === filename) return full;
    }
    return null;
  }
  return walk(join(RECORDINGS_ROOT, runId));
}
// The run's file and its parsed content: value null when the file is absent;
// failure names a file that exists but cannot be read or is not JSON, which
// is not the same as absent (an unreadable session_meta.json used to read as
// a run that died before any session existed).
async function readJsonInRun(
  runId: string,
  filename: string,
): Promise<{ value: any | null; failure: string | null }> {
  let p: string | null;
  try {
    p = await findInRun(runId, filename);
  } catch (error) {
    return { value: null, failure: (error as Error).message };
  }
  if (!p) return { value: null, failure: null };
  try {
    return { value: JSON.parse(await readFile(p, 'utf8')), failure: null };
  } catch (error) {
    return { value: null, failure: `${p}: ${(error as Error).message}` };
  }
}

export interface RunProvenance {
  session?: Record<string, unknown>;
  identity?: unknown;
  run?: { timing_seed: number };
  challenge_outcome?: ChallengeOutcome;
}

// Decode the captcha/challenge outcome (type, grid, objects, verdicts, whether
// LinkedIn accepted) from the run's HAR — the only artifact that carries the
// reCAPTCHA response bodies. Best-effort; null when no HAR or no challenge.
export async function readChallengeOutcome(
  runId: string,
): Promise<ChallengeOutcome | null> {
  const har = await readJsonInRun(runId, 'session.har');
  const entries = har.value?.log?.entries;
  if (!Array.isArray(entries)) return null;
  try {
    const co = analyzeChallengeOutcome(entries);
    return co.present ? co : null;
  } catch {
    return null;
  }
}

// Build the rich result.session (+ identity + run) from session_meta.json /
// proxy_preflight.json written by WSession. Falls back to a meta_missing
// envelope (requested proxy + full env) when the run died before any session
// existed — so a run is never a black hole. Mirrors the worker importer exactly.
export async function importRunProvenance(
  runId: string,
  params?: Record<string, unknown>,
): Promise<RunProvenance> {
  const out: RunProvenance = {};
  const meta = await readJsonInRun(runId, 'session_meta.json');
  const m = meta.value;
  if (m) {
    out.session = {
      proxy_host: m.proxy_host,
      proxy_port: m.proxy_port,
      proxy_user_present: !!m.proxy_user_present,
      proxy_user_hash: m.proxy_user_hash ?? null,
      exit_ip: m.exit_ip,
      platform: m.platform,
      provider: m.provider,
      browser_provenance: m.browser_provenance,
      persona: m.persona,
      realized_fingerprint: m.realized_fingerprint,
      proxy_requested: m.proxy_requested,
      env_flags: m.env_flags,
      env_all: snapshotSanitizedEnvironment(
        m.env_all && typeof m.env_all === 'object'
          ? (m.env_all as Record<string, string | undefined>)
          : {},
      ),
      sticky_session_id: m.sticky_session_id,
      sticky_hash: m.sticky_hash,
      exit_reputation: m.exit_reputation,
    };
    if (m.identity) out.identity = m.identity;
    if (typeof m.timing_seed === 'number')
      out.run = { timing_seed: m.timing_seed };
  } else {
    out.session = {
      // An unreadable meta file is named as such, not taken for a run that
      // died before any session existed.
      ...(meta.failure ? { meta_unreadable: meta.failure } : { meta_missing: true }),
      proxy_requested:
        (params as Record<string, unknown> | undefined)?.proxy_url_override ??
        null,
      env_all: snapshotSanitizedEnvironment(),
    };
  }
  const preflight = await readJsonInRun(runId, 'proxy_preflight.json');
  const pf = preflight.value;
  if (pf) {
    if (out.session)
      (out.session as Record<string, unknown>).proxy_preflight = pf;
    else out.session = { proxy_preflight: pf };
  } else if (preflight.failure && out.session) {
    (out.session as Record<string, unknown>).proxy_preflight_unreadable =
      preflight.failure;
  }
  const chrome = await readJsonInRun(runId, 'real_chrome_session.json');
  const rc = chrome.value;
  if (rc) {
    if (out.session) (out.session as Record<string, unknown>).real_chrome = rc;
    else out.session = { real_chrome: rc };
  } else if (chrome.failure && out.session) {
    (out.session as Record<string, unknown>).real_chrome_unreadable =
      chrome.failure;
  }
  const co = await readChallengeOutcome(runId);
  if (co) out.challenge_outcome = co;
  return out;
}
