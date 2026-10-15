// The scripted steps a generic capture performs on the page before it is
// captured, one per plan row, in order. A step whose element is missing,
// whose input is malformed, or whose input runtime is absent throws.
import { pageSettled } from '../../_shared/page/settled.mjs';

export async function runStep(session, step) {
  if (step.op === 'wait_selector') {
    // `waitFor` carries no deadline of its own, which is the point of a
    // `wait_selector` step: the element appearing is what the step waits for.
    return await session.waitFor(step.value, { state: 'visible' });
  }
  if (step.op === 'click') {
    const outcome = await session.clickSelector(step.value);
    if (outcome === 'no-element-found')
      throw new Error(
        `step click ${JSON.stringify(step.value)} matched no element`,
      );
    return outcome;
  }
  if (step.op === 'hover') {
    const { humanHoverLocator } = await import('../../../../dist/human/mouse.js');
    if (typeof humanHoverLocator !== 'function') {
      throw Object.assign(
        new Error(
          'The installed Weles input runtime does not provide humanHoverLocator',
        ),
        {
          code: 'CAPTURE_INPUT_UNAVAILABLE',
          operation: 'hover',
          export: 'humanHoverLocator',
        },
      );
    }
    await humanHoverLocator(
      session.page,
      session.page.locator(step.value).first(),
      { leave: false },
    );
    return `hovered ${step.value}`;
  }
  if (step.op === 'focus') {
    const outcome = await session.focus(step.value);
    if (outcome === 'no-element-found')
      throw new Error(
        `step focus ${JSON.stringify(step.value)} matched no element`,
      );
    return outcome;
  }
  if (step.op === 'press') return session.press(step.value);
  if (step.op === 'scroll') {
    const { humanScroll } = await import('../../../../dist/human/mouse.js');
    if (typeof humanScroll !== 'function') {
      throw Object.assign(
        new Error(
          'The installed Weles input runtime does not provide humanScroll',
        ),
        {
          code: 'CAPTURE_INPUT_UNAVAILABLE',
          operation: 'scroll',
          export: 'humanScroll',
        },
      );
    }
    if (!step.value || !Number.isFinite(Number(step.value))) {
      throw Object.assign(
        new Error(
          `step scroll needs a pixel distance (positive down, negative up), got ${JSON.stringify(step.value)}`,
        ),
        {
          code: 'CAPTURE_STEP_INVALID',
          operation: 'scroll',
        },
      );
    }
    await humanScroll(session.page, Number(step.value));
    return `scrolled ${step.value}`;
  }
  if (step.op === 'settle') {
    // The page has finished what the previous step started: loaded, and the
    // DOM unchanged across two animation frames.
    await pageSettled(session.page);
    return 'settled';
  }
  return session.goto(step.value);
}
