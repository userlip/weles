// Arkose FunCaptcha visual puzzles on GitHub's signup, solved by the Stado
// model router reading each screen of the puzzle frame. The model names the
// one point to click next (the visual-puzzle choice, the matching tile, the
// arrow to the next candidate, the submit control, the retry control) or says
// the frame is still loading; the solver clicks only the point it names,
// never a coordinate of its own. It stops when GitHub moves on, when GitHub
// shows its alert, or when the stated number of submitted answers is spent.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runRecordingsDir } from '../../../../dist/session/run-recordings.js';
import { humanClick } from '../../../../dist/human/mouse.js';
import { pageSettled } from '../../_shared/page/settled.mjs';
import { statedCount } from '../../_shared/inputs/stated.mjs';
import { completeMultimodal, requireStadoModelRouterConfig } from './stado_model_router.mjs';

export const PUZZLE_FRAME = 'iframe.js-octocaptcha-frame';

// The steps the model may answer with, and whether the click submits an answer.
const STEPS = { click: { submits: false }, submit: { submits: true }, wait: null };

const prompt = (width, height) =>
  `This image is an Arkose FunCaptcha frame, ${width}x${height} pixels, on GitHub's signup. Name the single next step that solves it.
- "submit": the control that submits an answer, when the shown candidate matches what the puzzle asks for;
- "click": any other point to click next: the visual puzzle choice, the matching tile, the arrow that shows the next candidate, or the retry control after an error;
- "wait": the frame is still loading or shows nothing to act on.
For click and submit give the point's pixel coordinates in this image.
Answer with JSON only: {"step":"click"|"submit"|"wait","x":<pixels>,"y":<pixels>,"why":"<short reason>"}`;

// GitHub keeps the puzzle frame hidden until its own solver-ready event,
// which an automated signup does not raise; the frame and its containers are
// shown here.
async function revealFrame(page) {
  await page
    .locator(PUZZLE_FRAME)
    .first()
    .evaluate((frame) => {
      frame.classList.remove('v-hidden', 'd-none');
      frame.style.visibility = 'visible';
      frame.style.display = 'block';
      frame.style.removeProperty('opacity');
      for (let el = frame.parentElement; el; el = el.parentElement) {
        el.classList.remove('v-hidden', 'd-none', 'js-octocaptcha-hide');
        el.removeAttribute('hidden');
      }
    });
}

/** The step the model names for this screen, refused when its answer is not that JSON. */
async function nextStep(image, width, height) {
  const { text, model } = await completeMultimodal({
    base64: image.toString('base64'),
    mimeType: 'image/png',
    prompt: prompt(width, height),
  });
  const open = text.indexOf('{');
  const close = text.lastIndexOf('}');
  if (open === Math.min(open, close) && open !== close && open === Math.abs(open)) {
    const step = JSON.parse(text.slice(open, close + Math.sign(text.length)));
    if (!Object.hasOwn(STEPS, step.step))
      throw new Error(`ARKOSE_STEP_UNKNOWN: ${model} named step "${step.step}", not one of ${Object.keys(STEPS).join(', ')}`);
    if (STEPS[step.step]) {
      const inside = (v, size) => Number.isFinite(v) && v === Math.abs(v) && v < size;
      if (!inside(step.x, width) || !inside(step.y, height))
        throw new Error(`ARKOSE_POINT_OUTSIDE: ${model} named (${step.x}, ${step.y}) for a ${width}x${height} frame`);
    }
    console.log(`[arkose] ${model}: ${step.step}${STEPS[step.step] ? ` (${step.x}, ${step.y})` : ''} — ${step.why}`);
    return step;
  }
  throw new Error(`ARKOSE_STEP_UNREAD: ${model} answered no JSON: ${text}`);
}

/**
 * Solve the puzzle in GitHub's captcha frame. `advanced()` says GitHub moved
 * past the captcha, `refused()` that it shows its alert. Answers true when
 * GitHub advanced, false when it refused or the stated submissions
 * (WELES_ARKOSE_SUBMIT_BUDGET) are spent; a frame that disappears or stops
 * changing is refused by name.
 */
export async function solveRotationViaCoords(page, { advanced, refused }) {
  requireStadoModelRouterConfig();
  const budget = statedCount(
    'WELES_ARKOSE_SUBMIT_BUDGET',
    'how many Arkose answers one GitHub signup may submit before it gives its address up',
  );
  await revealFrame(page);
  const frame = page.locator(PUZZLE_FRAME).first();
  await frame.waitFor({ state: 'visible' });
  const dir = runRecordingsDir('github_captcha');
  mkdirSync(dir, { recursive: true });
  const rounds = [];
  const submitted = [];
  let previous = null;
  for (;;) {
    if (await advanced()) return true;
    if (await refused()) return false;
    const box = await frame.boundingBox();
    if (!box) throw new Error(`ARKOSE_FRAME_GONE: the puzzle frame left ${page.url()} while GitHub neither moved on nor refused`);
    const image = await page.screenshot({ type: 'png', clip: box });
    rounds.push(image);
    writeFileSync(join(dir, `round_${rounds.length}.png`), image);
    if (previous && previous.equals(image))
      throw new Error(`ARKOSE_FRAME_STILL: the puzzle frame did not change after round ${rounds.length}`);
    previous = image;
    const step = await nextStep(image, Math.round(box.width), Math.round(box.height));
    if (STEPS[step.step]) {
      if (STEPS[step.step].submits) {
        submitted.push(rounds.length);
        if (submitted.length > budget) {
          console.log(`[arkose] ${submitted.length} answers submitted without GitHub moving on; WELES_ARKOSE_SUBMIT_BUDGET is ${budget}`);
          return false;
        }
      }
      await humanClick(page, Math.round(box.x + step.x), Math.round(box.y + step.y));
    }
    await pageSettled(page);
  }
}
