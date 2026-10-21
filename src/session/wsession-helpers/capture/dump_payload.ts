// The shape of one WSession's merged instrumentation dump, written at each
// activity checkpoint and once at close. Each member is read off the
// ws._inst* field its collector fills; a collector that never ran is null
// in the dump, never an empty list that would read as one that ran and saw
// nothing.

import { hashDiagnosticValue } from '../../wsession/run-provenance.js';
import { buildSiblingManifest, sliceStdout } from '../capture_extras.js';
import { buildCaptureCoverage } from './capture_coverage.js';

/** Each dump member and the session field its collector fills. */
const COLLECTED: Readonly<Record<string, string>> = Object.freeze({
  started_at: '_instStartedAt',
  host: '_instHost',
  browser_provenance: '_browserProvenance',
  persona: 'personaConfig',
  versions: '_versions',
  requests: '_instRequests',
  console: '_instConsole',
  pageerrors: '_instPageErrors',
  service_workers: '_instSwEvents',
  cdp_targets: '_instTargetEvents',
  cdp_attach_error: '_cdpAttachError',
  checkpoint_errors: '_instCheckpointErrors',
  last_checkpoint: '_instLastCheckpoint',
  cdp_frames: '_instFrameEvents',
  cdp_metrics: '_instMetricsHistory',
  storage_history: '_instStorageHistory',
  cdp_network: '_instCdpNetwork',
  system_info: '_instSystemInfo',
  browser_version: '_instBrowserVersion',
  histograms: '_instHistograms',
  navigation_history: '_instNavigationHistory',
  cdp_tracing: '_instTracing',
  cdp_tracing_error: '_instTracingError',
  js_coverage: '_instJsCoverageData',
  js_coverage_error: '_instJsCoverageError',
  css_coverage: '_instCssCoverageData',
  css_coverage_error: '_instCssCoverageError',
  webaudio: '_instWebAudio',
  webaudio_error: '_instWebAudioError',
  animations: '_instAnimations',
  animations_error: '_instAnimationsError',
  indexed_db: '_instIndexedDb',
  indexed_db_error: '_instIndexedDbError',
  dom_counters: '_instDomCounters',
  // Distinct rendered DOM states retained at activity and step checkpoints.
  // A closed page retains earlier captures; no clock guarantees a snapshot.
  dom_timeline: '_instDomTimeline',
  dom_snapshot: '_instDomSnapshot',
  dom_snapshot_error: '_instDomSnapshotError',
  dom_pierced_tree: '_instDomPiercedTree',
  dom_pierced_tree_error: '_instDomPiercedTreeError',
  heap_snapshot: '_instHeapSnapshot',
  heap_snapshot_error: '_instHeapSnapshotError',
  page_events: '_instPageEvents',
  runtime: '_instRuntime',
  log_entries: '_instLog',
  security: '_instSecurity',
  storage_events: '_instStorageEvents',
  playwright_events: '_instPlaywrightEvents',
  cdp_firehose: '_instCdpFirehose',
  cdp_firehose_mode: '_instCdpFirehoseMode',
  worker_surfaces: '_instWorkerSurfaces',
  worker_surfaces_error: '_instWorkerSurfacesError',
  worker_events: '_instWorkerEvents',
  host_snapshots: '_instHostSnapshots',
  pcap: '_instPcap',
});

/** The session's proxy as a dump may show it: whether credentials were set, never their values. */
function sanitizeProxyConfig(proxy: any): any {
  if (!proxy) return null;
  return {
    server: proxy.server,
    username_present: Boolean(proxy.username),
    username_hash: hashDiagnosticValue(proxy.username),
    password_present: Boolean(proxy.password),
    country: proxy.country,
    exit_ip: proxy.exit_ip,
    platform: proxy.platform,
    provider: proxy.provider,
    proxy_type: proxy.proxy_type,
  };
}

/** The session field `field`, or null when its collector never filled it. */
function collected(ws: any, field: string): unknown {
  return ws[field] === undefined ? null : ws[field];
}

/** The dump of `ws` as it stands; `closing` stamps the close time. */
export function buildDumpPayload(
  ws: any,
  opts: { closing: boolean },
): Record<string, unknown> {
  const members = Object.fromEntries(
    Object.entries(COLLECTED).map(([member, field]) => [
      member,
      collected(ws, field),
    ]),
  );
  return {
    label: collected(ws, 'label'),
    closed_at: opts.closing ? new Date().toISOString() : null,
    proxy: sanitizeProxyConfig(ws.proxyConfig),
    accesses: ws._instAccum ? [...ws._instAccum.values()] : null,
    ...members,
    capture_coverage: buildCaptureCoverage(ws),
    stdout: sliceStdout(ws),
    sibling_files:
      ws._instDir && ws._instFile
        ? buildSiblingManifest(ws._instDir, ws._instFile)
        : null,
  };
}
