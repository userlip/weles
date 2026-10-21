// Which diagnostic collectors of a session emitted data, were attempted and
// emitted nothing, or never ran: one probe per collector
// (coverage/page-probes.ts, coverage/protocol-probes.ts), each reading the
// ws._inst* fields that collector fills. A collector surface these
// diagnostics name but do not wire is listed as missing, so the report names
// every surface.
import {
  allAccessLogs,
  type CoverageStatus,
  type Evidence,
  type Probe,
} from './coverage/read.js';
import { PAGE_PROBES } from './coverage/page-probes.js';
import { PROTOCOL_PROBES } from './coverage/protocol-probes.js';

interface CollectorCoverage {
  id: string;
  section: string;
  collector: string;
  expected: string;
  status: CoverageStatus;
  evidence: Evidence[];
}

/** Collector surfaces these diagnostics name but do not wire. */
const UNWIRED: readonly string[] = [
  'A.js_native_matrix',
  'A.wasm_matrix',
  'B.media_matrix',
  'B.css_svg_mathml_matrix',
  'D.decoded_transport_fingerprints',
  'E.deep_host_inventory',
  'G.dom_resource_accessibility_graph',
  'H.identity_privacy_adtech_state',
  'L.schema_validation',
];

/** A collector id's section: the letter before its first dot. */
function sectionOf(id: string): string {
  const [section] = id.split('.');
  return section;
}

function statusOf(probe: Probe, ws: any, logs: any[]): CoverageStatus {
  if (probe.emitted(ws, logs)) return 'emitted';
  return probe.attempted(ws, logs) ? 'attempted' : 'missing';
}

/** How many collectors stand at each status the report holds. */
function summaryOf(collectors: CollectorCoverage[]): Record<string, number> {
  const statuses = new Set(collectors.map((collector) => collector.status));
  return Object.fromEntries(
    [...statuses].map((status) => [
      status,
      collectors.filter((collector) => collector.status === status).length,
    ]),
  );
}

export function buildCaptureCoverage(ws: any): any {
  const logs = allAccessLogs(ws);
  const collectors: CollectorCoverage[] = [
    ...[...PAGE_PROBES, ...PROTOCOL_PROBES]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((probe) => ({
        id: probe.id,
        section: sectionOf(probe.id),
        collector: probe.collector,
        expected: probe.expected,
        status: statusOf(probe, ws, logs),
        evidence: probe.evidence(ws, logs),
      })),
    ...UNWIRED.map((id) => ({
      id,
      section: sectionOf(id),
      collector: 'not wired in current diagnostics',
      expected: 'collector surface these diagnostics do not capture yet',
      status: 'missing' as const,
      evidence: [],
    })),
  ];
  return {
    schema_version: 'weles.capture-coverage.v1',
    generated_at: new Date().toISOString(),
    summary: summaryOf(collectors),
    collectors,
  };
}
