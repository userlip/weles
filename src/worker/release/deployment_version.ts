import os from 'node:os';
import { captureVersions } from '../../diagnostics/versions.js';

type EnvLike = Record<string, string | undefined>;

export type ImmutableReleaseIdentity = {
  schema: 'weles.release-identity.v2';
  worker_version: string;
  source_revision: string;
  artifact_sha256: string;
  deployment_manifest_sha256: string;
  deployment_id: string;
  ring: ReleaseRing;
  claims_enabled: boolean;
  chromium_release: string;
  chromium_sha256: string;
  firefox_release: string;
  firefox_sha256: string;
  api_schemas: string[];
};

/**
 * The release rings, declared once: the type is read from this table, so a
 * ring the identity accepts and a ring the reader admits cannot diverge.
 * Only `claims` decides whether a ring's worker may take queued work.
 */
const RELEASE_RINGS = {
  candidate: { claims: false },
  development: { claims: false },
  canary: { claims: false },
  production: { claims: true },
} as const;
type ReleaseRing = keyof typeof RELEASE_RINGS;

/** WELES_CLAIMS_ENABLED as the release manifest writes it. */
const CLAIM_SWITCH = { '0': false, '1': true } as const;
export type DeploymentVersionValue = {
  source: 'weles-worker';
  instance_id: string;
  updated_at: string;
  release?: ImmutableReleaseIdentity;
  capture_failures: unknown;
  deployment: {
    weles_pkg_version: unknown;
    weles_commit: unknown;
    weles_commit_short: unknown;
    weles_branch: unknown;
    weles_dirty: unknown;
    weles_dist_sha256: unknown;
    trajectories_tree_sha256: unknown;
    runner_entry_sha256: unknown;
    worker_started_at: unknown;
    recorded_at: unknown;
  };
  runner: {
    worker_host: unknown;
    worker_user: unknown;
    node_version: unknown;
    pid: number;
    platform: NodeJS.Platform;
    arch: string;
  };
};

function envValue(env: EnvLike, ...keys: string[]): string {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return '';
}

function immutableReleaseIdentity(
  env: EnvLike,
): ImmutableReleaseIdentity | undefined {
  const workerVersion = envValue(env, 'WELES_WORKER_VERSION');
  const sourceRevision = envValue(env, 'WELES_SOURCE_REVISION');
  const artifactSha256 = envValue(env, 'WELES_WORKER_ARTIFACT_SHA256');
  const manifestSha256 = envValue(env, 'WELES_DEPLOYMENT_MANIFEST_SHA256');
  const deploymentId = envValue(env, 'WELES_DEPLOYMENT_ID');
  const ring = envValue(env, 'WELES_DEPLOYMENT_RING');
  const claimsEnabled = envValue(env, 'WELES_CLAIMS_ENABLED');
  const chromiumRelease = envValue(env, 'WELES_CHROMIUM_RELEASE_VERSION');
  const chromiumSha256 = envValue(env, 'WELES_CHROMIUM_RELEASE_SHA256');
  const firefoxRelease = envValue(env, 'WELES_FIREFOX_RELEASE_VERSION');
  const firefoxSha256 = envValue(env, 'WELES_FIREFOX_RELEASE_SHA256');
  const apiSchemas = envValue(env, 'WELES_API_SCHEMAS');
  const values = [
    workerVersion,
    sourceRevision,
    artifactSha256,
    manifestSha256,
    deploymentId,
    ring,
    claimsEnabled,
    chromiumRelease,
    chromiumSha256,
    firefoxRelease,
    firefoxSha256,
    apiSchemas,
  ];
  if (values.every((value) => !value)) return undefined;
  if (values.some((value) => !value)) {
    throw new Error('immutable release identity is partially configured');
  }
  if (!Object.hasOwn(RELEASE_RINGS, ring)) {
    throw new Error(
      `WELES_DEPLOYMENT_RING is ${ring}, not a release ring: ${Object.keys(RELEASE_RINGS).join(', ')}`,
    );
  }
  if (!Object.hasOwn(CLAIM_SWITCH, claimsEnabled))
    throw new Error(
      `WELES_CLAIMS_ENABLED is ${claimsEnabled}, not ${Object.keys(CLAIM_SWITCH).join(' or ')}`,
    );
  const claims = CLAIM_SWITCH[claimsEnabled as keyof typeof CLAIM_SWITCH];
  const declared = RELEASE_RINGS[ring as ReleaseRing];
  if (declared.claims !== claims) {
    throw new Error(
      `release ring ${ring} ${declared.claims ? 'claims' : 'never claims'} queued work, but WELES_CLAIMS_ENABLED is ${claimsEnabled}`,
    );
  }
  return {
    schema: 'weles.release-identity.v2',
    worker_version: workerVersion,
    source_revision: sourceRevision,
    artifact_sha256: artifactSha256,
    deployment_manifest_sha256: manifestSha256,
    deployment_id: deploymentId,
    ring: ring as ReleaseRing,
    claims_enabled: claims,
    chromium_release: chromiumRelease,
    chromium_sha256: chromiumSha256,
    firefox_release: firefoxRelease,
    firefox_sha256: firefoxSha256,
    api_schemas: apiSchemas
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  };
}

export function deploymentInstanceId(env: EnvLike = process.env): string {
  return (
    env.WELES_INSTANCE_ID?.trim() ||
    env.INSTANCE_ID?.trim() ||
    `weles-${os.hostname() || 'host'}-${process.pid}`
  );
}

export function buildDeploymentVersionValue(
  versions: Record<string, any> = captureVersions(null),
  now = new Date(),
  instanceId = deploymentInstanceId(),
  env: EnvLike = process.env,
): DeploymentVersionValue {
  const release = immutableReleaseIdentity(env);
  return {
    source: 'weles-worker',
    instance_id: instanceId,
    updated_at: now.toISOString(),
    ...(release ? { release } : {}),
    capture_failures: versions.version_capture_failures ?? [],
    deployment: {
      weles_pkg_version: versions.weles_pkg_version ?? null,
      weles_commit: versions.weles_commit ?? null,
      weles_commit_short: versions.weles_commit_short ?? null,
      weles_branch: versions.weles_branch ?? null,
      weles_dirty: versions.weles_dirty ?? null,
      weles_dist_sha256: versions.weles_dist_sha256 ?? null,
      trajectories_tree_sha256: versions.trajectories_tree_sha256 ?? null,
      runner_entry_sha256: versions.runner_entry_sha256 ?? null,
      worker_started_at: versions.worker_started_at ?? null,
      recorded_at: versions.recorded_at ?? null,
    },
    runner: {
      worker_host: versions.worker_host ?? null,
      worker_user: versions.worker_user ?? null,
      node_version: versions.node_version ?? process.version,
      pid: process.pid,
      platform: process.platform,
      arch: process.arch,
    },
  };
}
