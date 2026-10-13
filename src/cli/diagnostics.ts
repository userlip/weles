import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { WELES_AGENT_MODEL } from '../agent/jeden.js';
import { resolveSkarbiecEndpoint } from '../utils/runtime/endpoint-resolution.js';
import { listLoginAccounts } from '../utils/login-accounts.js';
import { printAnswer } from './usage.js';
export async function runDoctor(
  pkg: { version?: string; bin?: unknown },
  json: boolean,
): Promise<void> {
  const report: Record<string, unknown> = {
    ok: true,
    version: pkg.version ?? null,
    node: process.version,
    bin: pkg.bin ?? null,
    env: {
      CHROMIUM_PATH: process.env.CHROMIUM_PATH ? 'set' : 'unset',
      WELES_USE_STOCK_CHROMIUM: process.env.WELES_USE_STOCK_CHROMIUM
        ? 'set'
        : 'unset',
    },
    dependencies: {
      skarbiec: null as unknown,
      browserRuntime: null as unknown,
    },
  };

  try {
    const skarbiecResult = await resolveSkarbiecEndpoint();
    if (skarbiecResult.resolved) {
      report.dependencies = {
        skarbiec: {
          resolved: skarbiecResult.resolved.url,
          source: skarbiecResult.resolved.source,
          sourceDetail: skarbiecResult.resolved.sourceDetail,
          isListening: skarbiecResult.resolved.isListening,
        },
      };
      if (!skarbiecResult.resolved.isListening) {
        report.ok = false;
      }
    }
  } catch (error) {
    report.dependencies = {
      skarbiec: {
        error: error instanceof Error ? error.message : String(error),
      },
    };
    report.ok = false;
  }

  // A worker that will die on its first browser task should say so here
  // rather than at the fourth failed job. `browserContext.newPage` needs the
  // recording dependency before it will open a page at all, so an absent
  // ffmpeg is not a degraded run, it is every browser task on the host
  // failing -- and it reported itself only as a run failure hours later.
  const runtime = inspectBrowserRuntime();
  report.dependencies = {
    ...(report.dependencies as Record<string, unknown>),
    browserRuntime: runtime,
  };
  if (!runtime.ok) {
    report.ok = false;
  }

  // Which revision this host actually built, against the revision the
  // deployment declares, and the Brama alias that revision will ask for. A
  // managed runtime weeks behind its own repository can ask Brama for a
  // route whose credentials have lapsed, so every browser task on the host
  // fails while the host's own bearer is being served; a `doctor` that
  // reports the version in `package.json` reports the repository's, not the
  // runtime's, and never names the gap.
  const managed = inspectManagedRuntime();
  report.managedRuntime = managed;
  if (!managed.ok) {
    report.ok = false;
  }

  try {
    const identities = listLoginAccounts();
    report.subscriptionAuthentication = { source: 'skarbiec', ...identities };
    if (identities.errors.length) report.ok = false;
  } catch (error) {
    report.subscriptionAuthentication = {
      source: 'skarbiec',
      accounts: [],
      errors: [
        {
          code: 'skarbiec_inventory_unavailable',
          detail: error instanceof Error ? error.message : String(error),
        },
      ],
    };
    report.ok = false;
  }

  printAnswer(report, json);
  if (!report.ok) {
    process.exitCode = 1;
  }
}

type ManagedRuntimeReport = {
  ok: boolean;
  root: string;
  builtRevision: string | null;
  declaredRevision: string | null;
  agentModelAlias: string;
  detail?: string;
};

// Compare the deployment's revision marker with its declaration; absence is
// healthy only when no managed runtime is declared. This is metadata, not
// proof that the browser or its dependencies work.
function inspectManagedRuntime(): ManagedRuntimeReport {
  const root = join(homedir(), '.stado', 'build-work', 'weles-api-managed');
  const alias = process.env.WELES_AGENT_MODEL?.trim() || WELES_AGENT_MODEL;
  const declaredRevision = revision(process.env.WELES_API_DECLARED_REVISION);
  let builtRevision: string | null;
  try {
    builtRevision = readRevisionMarker(join(root, '.weles-api-revision'));
  } catch (error) {
    return {
      ok: false,
      root,
      builtRevision: null,
      declaredRevision,
      agentModelAlias: alias,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  if (!builtRevision) {
    return {
      ok: !declaredRevision,
      root,
      builtRevision: null,
      declaredRevision,
      agentModelAlias: alias,
      detail: declaredRevision
        ? `managed Weles API revision marker ${join(root, '.weles-api-revision')} is missing; cannot verify declared revision ${declaredRevision}`
        : 'this host runs no managed Weles API runtime',
    };
  }
  if (!declaredRevision) {
    return {
      ok: true,
      root,
      builtRevision,
      declaredRevision: null,
      agentModelAlias: alias,
      detail:
        'the unit declares no revision, so this reports what is installed and compares nothing',
    };
  }
  if (builtRevision !== declaredRevision) {
    return {
      ok: false,
      root,
      builtRevision,
      declaredRevision,
      agentModelAlias: alias,
      detail: `the installed runtime is ${builtRevision.slice(0, 12)} and the unit declares ${declaredRevision.slice(0, 12)}; move it with \`stado host weles-api-runtime <host> --revision ${declaredRevision.slice(0, 12)}\``,
    };
  }
  return {
    ok: true,
    root,
    builtRevision,
    declaredRevision,
    agentModelAlias: alias,
  };
}

function revision(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return /^[0-9a-f]{40}$/.test(trimmed) ? trimmed : null;
}

function readRevisionMarker(path: string): string | null {
  try {
    const observed = revision(readFileSync(path, 'utf8'));
    if (!observed)
      throw new Error('expected a full hexadecimal source revision');
    return observed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(
      `read managed Weles API revision marker ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/// The components this worker takes from Playwright's own cache.
///
/// Not every browser Playwright pins: the worker launches its own Chromium
/// and Firefox releases, pinned by digest, so Playwright's bundled browsers
/// are absent on a healthy host. `ffmpeg` is what the recording path uses and
/// what its absence breaks.
const REQUIRED_PLAYWRIGHT_COMPONENTS = ['ffmpeg'] as const;

type BrowserRuntimeReport = {
  ok: boolean;
  components?: Array<{
    name: string;
    revision: string | null;
    expectedPath: string | null;
    present: boolean;
    error?: string;
  }>;
  error?: string;
};

/// Whether the browser runtime this release pins is actually on disk.
///
/// The revisions are read from the Playwright the release itself carries,
/// never hardcoded: the cache directory is `<name>-<revision>` with
/// underscores for hyphenated names, so a constant would check the wrong path
/// the moment the dependency moved. Presence is Playwright's own
/// `INSTALLATION_COMPLETE` marker, so a directory left behind by an
/// interrupted download is reported missing rather than present.
function inspectBrowserRuntime(): BrowserRuntimeReport {
  let declared: Array<{ name: string; revision: string }>;
  try {
    // Resolved through the package's main entry and then walked up to the
    // manifest beside it. `require.resolve('playwright-core/browsers.json')`
    // is refused: the package's `exports` map does not publish that subpath,
    // even though the file is what Playwright itself reads for its revisions.
    // Asking the resolver for the entry point and walking from there uses the
    // same copy the runtime will load, which a hardcoded node_modules path
    // would not.
    const manifestPath = findPlaywrightManifest();
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      browsers?: Array<{ name?: string; revision?: string }>;
    };
    if (!Array.isArray(parsed.browsers)) {
      throw new Error(`${manifestPath} carries no browsers list`);
    }
    declared = parsed.browsers.flatMap((entry) =>
      isText(entry.name) && isText(entry.revision) ? [{ name: entry.name, revision: entry.revision }] : [],
    );
  } catch (error) {
    return {
      ok: false,
      error: `cannot read playwright-core/browsers.json, so the browser runtime this release needs is unknown: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  const cacheRoot = playwrightCacheRoot();
  const components = REQUIRED_PLAYWRIGHT_COMPONENTS.map((name) => {
    const found = declared.find((entry) => entry.name === name);
    // An undeclared component has no revision and so no path: both are null
    // and the error names what browsers.json lacks.
    if (!found) {
      const error = `playwright-core/browsers.json declares no ${name}, so its revision and install path cannot be named`;
      return { name, revision: null, expectedPath: null, present: false, error };
    }
    const expectedPath = join(
      cacheRoot,
      `${name.replace(/-/g, '_')}-${found.revision}`,
      'INSTALLATION_COMPLETE',
    );
    return {
      name,
      revision: found.revision,
      expectedPath,
      present: existsSync(expectedPath),
    };
  });
  return { ok: components.every((component) => component.present), components };
}

const isText = (value: unknown): value is string => typeof value === 'string';

/// The `browsers.json` beside the resolved `playwright-core`.
function findPlaywrightManifest(): string {
  let directory = dirname(require.resolve('playwright-core'));
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(directory, 'browsers.json');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error('no browsers.json beside the resolved playwright-core');
}

/// Where Playwright keeps its downloads on this platform.
function playwrightCacheRoot(): string {
  const override = process.env.PLAYWRIGHT_BROWSERS_PATH?.trim();
  if (override) return override;
  const home = homedir();
  if (process.platform === 'darwin')
    return join(home, 'Library', 'Caches', 'ms-playwright');
  if (process.platform === 'win32')
    return join(home, 'AppData', 'Local', 'ms-playwright');
  return join(home, '.cache', 'ms-playwright');
}
