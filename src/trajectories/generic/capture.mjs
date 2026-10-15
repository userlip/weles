/**
 * generic_capture — one attributed capture of one product surface.
 *
 * Params arrive as GENERIC_CAPTURE_PLAN (dispatch already parsed and refused
 * malformed rows; the same parser runs again here so a hand-started run cannot
 * skip the contract). The run navigates to source_url in the patched Chromium on
 * the Stado-selected host, applies the viewport, executes the scripted steps in
 * order, and writes:
 *
 *   <base>.png        the still (viewport or full page)
 *   <base>.png.json   its sidecar
 *   <base>.webm       the recording, only when record_seconds > 0
 *   <base>.webm.json  its sidecar
 *
 * <base> encodes site, axis, viewport, full-page flag and a digest of
 * (source_url, steps, record_seconds), so the several captures a site+axis
 * prefix holds never collide.
 *
 * Everything is uploaded to artifact_prefix through Stado product objects. An
 * upload that does not come back acknowledged fails the action — an artifact
 * left on the host is not evidence.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runRecordingsDir } from '../../../dist/session/run-recordings.js';
import { parseCaptureParams } from '../../../dist/worker/params/capture-params.js';
import { runStep } from './capture/steps.mjs';
import {
  captureVideoTools,
  recordCaptureVideo,
} from '../_shared/runner/capture-video.mjs';
import {
  captureKeyPrefix,
  fileAttribution,
  planFromEnv,
  pngPixelSize,
  startCaptureSession,
  uploadCaptureObject,
  welesVersion,
  writeLocalArtifact,
} from '../_shared/runner/capture-runtime.mjs';

const label = 'generic_capture';
const plan = planFromEnv('GENERIC_CAPTURE_PLAN', parseCaptureParams);
const keyPrefix = captureKeyPrefix(plan.artifact_prefix);
const signature = createHash('sha256')
  .update(
    JSON.stringify({
      source_url: plan.source_url,
      steps: plan.steps,
      record_seconds: plan.record_seconds,
    }),
  )
  .digest('hex');
const base = [
  plan.site_slug,
  plan.axis,
  `${plan.viewport.width}x${plan.viewport.height}@${plan.viewport.device_scale_factor}x`,
  ...(plan.full_page ? ['fullpage'] : []),
  signature,
].join('--');

let started = null;
let sessionClosure = null;
const closeSession = () => {
  sessionClosure ??= started.session.close();
  return sessionClosure;
};
const stepsExecuted = [];
let failure = null;
const artifacts = [];
try {
  console.log(
    `[capture] ${plan.batch}/${plan.site_slug}/${plan.axis} url=${plan.source_url} viewport=${plan.viewport.width}x${plan.viewport.height}@${plan.viewport.device_scale_factor}x full_page=${plan.full_page} record=${plan.record_seconds}s steps=${plan.steps.length}`,
  );
  const videoTools = plan.record_seconds > 0 ? captureVideoTools() : null;
  started = await startCaptureSession(label, plan);
  const { session, renderer } = started;
  const version = welesVersion();
  await session.goto(plan.source_url);
  await session.page.waitForLoadState('load');

  const performSteps = async () => {
    for (const step of plan.steps) {
      const outcome = await runStep(session, step);
      stepsExecuted.push({
        op: step.op,
        value: step.value,
        outcome: String(outcome),
      });
    }
  };
  let recorded = null;
  if (plan.record_seconds > 0) {
    recorded = await recordCaptureVideo({
      page: session.page,
      path: join(runRecordingsDir(label), `${base}.webm`),
      seconds: plan.record_seconds,
      tools: videoTools,
      perform: performSteps,
      closeSession,
    });
  } else {
    await performSteps();
  }

  const capturedAt = new Date().toISOString();
  const stillBuffer = await session.page.screenshot({
    fullPage: plan.full_page,
    type: 'png',
  });
  const stillPath = writeLocalArtifact(label, `${base}.png`, stillBuffer);
  const still = fileAttribution(stillPath);
  const stillSize = pngPixelSize(still.buffer);
  const stillSidecar = {
    source_url: plan.source_url,
    axis: plan.axis,
    viewport: plan.viewport,
    full_page: plan.full_page,
    steps_executed: stepsExecuted,
    captured_at: capturedAt,
    renderer,
    weles_version: version,
    media_kind: 'still-png',
    width: stillSize.width,
    height: stillSize.height,
    duration_seconds: null,
    bytes: still.bytes,
    sha256: still.sha256,
    capture_method: `Rendered ${plan.source_url} in ${renderer} on the Stado-selected Weles host at ${plan.viewport.width}x${plan.viewport.height} CSS px and device scale factor ${plan.viewport.device_scale_factor}, executed ${stepsExecuted.length} scripted step(s), then captured ${plan.full_page ? 'a full-page' : 'a viewport'} PNG through CDP Page.captureScreenshot.`,
  };
  artifacts.push({
    key: `${keyPrefix}${base}.png`,
    uri: await uploadCaptureObject(
      keyPrefix,
      `${base}.png`,
      still.buffer,
      'image/png',
    ),
    sidecar_key: `${keyPrefix}${base}.png.json`,
    sidecar_uri: await uploadCaptureObject(
      keyPrefix,
      `${base}.png.json`,
      JSON.stringify(stillSidecar, null, '  '),
      'application/json',
    ),
    media_kind: 'still-png',
    bytes: still.bytes,
    sha256: still.sha256,
  });

  if (recorded) {
    await closeSession();
    const video = fileAttribution(recorded.path);
    const videoSidecar = {
      source_url: plan.source_url,
      axis: plan.axis,
      viewport: plan.viewport,
      full_page: plan.full_page,
      steps_executed: stepsExecuted,
      captured_at: capturedAt,
      renderer,
      weles_version: version,
      media_kind: 'video-webm',
      width: recorded.width,
      height: recorded.height,
      duration_seconds: recorded.duration_seconds,
      frames_submitted: recorded.frames_submitted,
      bytes: video.bytes,
      sha256: video.sha256,
      capture_method: `Captured viewport JPEG frames of ${plan.source_url} in ${renderer} on the Stado-selected Weles host while executing ${stepsExecuted.length} scripted step(s), preserving observed capture spacing at 25 encoded frames per second. ${videoTools.encoder} encoded WebM. An isolated page in the same managed browser loaded the written file and decoded its first frame, reporting ${recorded.width}x${recorded.height} dimensions and ${recorded.duration_seconds}s duration. frames_submitted counts encoder input, not independently decoded video frames.`,
    };
    artifacts.push({
      key: `${keyPrefix}${base}.webm`,
      uri: await uploadCaptureObject(
        keyPrefix,
        `${base}.webm`,
        video.buffer,
        'video/webm',
      ),
      sidecar_key: `${keyPrefix}${base}.webm.json`,
      sidecar_uri: await uploadCaptureObject(
        keyPrefix,
        `${base}.webm.json`,
        JSON.stringify(videoSidecar, null, '  '),
        'application/json',
      ),
      media_kind: 'video-webm',
      bytes: video.bytes,
      sha256: video.sha256,
    });
  }

  writeFileSync(
    join(runRecordingsDir(label), 'capture_result.json'),
    JSON.stringify(
      {
        ok: true,
        batch: plan.batch,
        site_slug: plan.site_slug,
        axis: plan.axis,
        source_url: plan.source_url,
        artifact_prefix: plan.artifact_prefix,
        artifacts,
        steps_executed: stepsExecuted,
        renderer,
        weles_version: version,
        completed_at: new Date().toISOString(),
      },
      null,
      '  ',
    ),
  );
  console.log(
    `PASS: ${label} ${artifacts.map((artifact) => artifact.uri).join(' ')}`,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  writeFileSync(
    join(runRecordingsDir(label), 'capture_result.json'),
    JSON.stringify(
      {
        ok: false,
        batch: plan.batch,
        site_slug: plan.site_slug,
        axis: plan.axis,
        source_url: plan.source_url,
        artifact_prefix: plan.artifact_prefix,
        artifacts,
        steps_executed: stepsExecuted,
        error: message,
        error_details: {
          code: error?.code,
          operation: error?.operation,
          export: error?.export,
          encoder: error?.encoder,
          path: error?.path,
          status: error?.status,
          signal: error?.signal,
          stderr: error?.stderr,
          requested_seconds: error?.requestedSeconds,
          written_frames: error?.writtenFrames,
          input_ended: error?.inputEnded,
          observed: error?.observed,
          cause: error?.cause?.message,
        },
        completed_at: new Date().toISOString(),
      },
      null,
      '  ',
    ),
  );
  console.error('FAIL:', error);
  failure = error;
} finally {
  if (started) await closeSession();
}
if (failure) throw failure;
