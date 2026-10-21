// What a coverage probe is and how it reads a session's captured fields.

export type CoverageStatus = 'emitted' | 'attempted' | 'missing';

export interface Evidence {
  field: string;
  count?: number;
  present?: boolean;
  error?: string | null;
}

/** One collector: what it is, what it shows, and how to read whether it ran. */
export interface Probe {
  id: string;
  collector: string;
  expected: string;
  emitted(ws: any, logs: any[]): boolean;
  attempted(ws: any, logs: any[]): boolean;
  evidence(ws: any, logs: any[]): Evidence[];
}

/** The entries a captured list or record holds; nothing captured holds none. */
function entries(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.keys(value);
  return [];
}

export function len(value: unknown): number {
  return entries(value).length;
}

export function present(value: unknown): boolean {
  if (value && typeof value === 'object') return Boolean(len(value));
  return value !== null && value !== undefined;
}

export function errorOf(ws: any, key: string): string | null {
  return ws[key] ? String(ws[key]) : null;
}

/** Every frame's page-side access log, in frame order. */
export function allAccessLogs(ws: any): any[] {
  if (!ws._instAccum) return [];
  return [...ws._instAccum.values()].flatMap((frame: any) =>
    Array.isArray(frame.log) ? frame.log : [],
  );
}

/** Target events that are not the attach failure itself. */
export function cdpTargets(ws: any): number {
  return entries(ws._instTargetEvents).filter(
    (event: any) => event.phase !== 'attach_error',
  ).length;
}

function countAccess(logs: any[], objects: readonly string[]): number {
  return logs.filter((entry) => objects.includes(entry.o)).length;
}

/** A collector read from the page-side access log of the objects it hooks. */
export function accessProbe(
  id: string,
  collector: string,
  expected: string,
  objects: readonly string[],
  extra: (ws: any) => Evidence[] = () => [],
): Probe {
  return {
    id,
    collector,
    expected,
    emitted: (_ws, logs) => Boolean(countAccess(logs, objects)),
    attempted: (_ws, logs) => Boolean(logs.length),
    evidence: (ws, logs) => [
      {
        field: `accesses.${objects.join('+')}`,
        count: countAccess(logs, objects),
      },
      ...extra(ws),
    ],
  };
}
