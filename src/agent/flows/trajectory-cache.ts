/**
 * Learned routes for FetchAccountValue: the page that showed a value and the
 * element it sat in, kept one file per service in the directory the caller
 * states. A missing file means nothing was learned; a file that cannot be read
 * or is not a learned route is thrown with its path and cause.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const JSON_INDENT = '  ';

/** A route learned once: the page that showed the value and its element. */
export interface TrajectoryRecord {
  service: string;
  finalUrl: string;
  selector: string;
  lastSuccess: string;
  lastValue: number;
}

function isTrajectoryRecord(value: unknown): value is TrajectoryRecord {
  if (typeof value !== 'object' || value === null) return false;
  return (
    'service' in value &&
    typeof value.service === 'string' &&
    'finalUrl' in value &&
    typeof value.finalUrl === 'string' &&
    'selector' in value &&
    typeof value.selector === 'string' &&
    'lastSuccess' in value &&
    typeof value.lastSuccess === 'string' &&
    'lastValue' in value &&
    typeof value.lastValue === 'number'
  );
}

export class Trajectory implements TrajectoryRecord {
  service: string;
  finalUrl: string;
  selector: string;
  lastSuccess: string;
  lastValue: number;

  constructor(record: TrajectoryRecord) {
    this.service = record.service;
    this.finalUrl = record.finalUrl;
    this.selector = record.selector;
    this.lastSuccess = record.lastSuccess;
    this.lastValue = record.lastValue;
  }

  static path(cacheDir: string, service: string): string {
    return join(cacheDir, `${service}.json`);
  }

  /** The learned route, or null when none was learned for the service. */
  static load(cacheDir: string, service: string): Trajectory | null {
    const path = Trajectory.path(cacheDir, service);
    if (!existsSync(path)) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, 'utf-8'));
    } catch (cause) {
      throw new Error(
        `trajectory cache ${path} cannot be read: ${String(cause)}`,
        { cause },
      );
    }
    if (!isTrajectoryRecord(parsed))
      throw new Error(
        `trajectory cache ${path} is not a learned route: ${JSON.stringify(parsed)}`,
      );
    return new Trajectory(parsed);
  }

  save(cacheDir: string): void {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(
      Trajectory.path(cacheDir, this.service),
      JSON.stringify(this, null, JSON_INDENT),
    );
  }

  static invalidate(cacheDir: string, service: string): void {
    rmSync(Trajectory.path(cacheDir, service), { force: true });
  }
}
