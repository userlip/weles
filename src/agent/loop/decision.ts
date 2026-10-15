/**
 * What one browser task step may do, read strictly: how many steps the task
 * runs under, the tool call a decision names, and why the model gave up.
 */

import { AgentFailure, type ToolCall } from '../loop.js';

/**
 * How many model steps one browser task may take before it is stopped, when
 * its caller names none: `WELES_AGENT_MAX_STEPS`, a whole number above zero
 * that the deployment declares. Without the setting the task is refused
 * before the browser is driven, naming it.
 */
export function declaredMaxSteps(history: ToolCall[]): number {
  const raw = process.env.WELES_AGENT_MAX_STEPS?.trim();
  const steps = Number(raw);
  if (
    !raw ||
    !Number.isSafeInteger(steps) ||
    Math.sign(steps) !== Math.sign(Number.MAX_SAFE_INTEGER)
  ) {
    throw new AgentFailure(
      `WELES_AGENT_MAX_STEPS is ${raw ? `"${raw}", not a whole number above zero` : 'not set'}: declare how many model steps one browser task may take`,
      history,
    );
  }
  return steps;
}

/**
 * The tool call one decision names. A decision comes from the model, which
 * askLlm reads against the declared tools, or from a replayed flow; one that
 * names no tool or carries no argument object is a corrupt step, refused
 * rather than dispatched blank.
 */
export function decidedCall(
  decision: Record<string, any>,
  step: number,
  history: ToolCall[],
): ToolCall {
  if (typeof decision.tool !== 'string' || !decision.tool)
    throw new AgentFailure(
      `step ${step} decision names no tool: ${JSON.stringify(decision)}`,
      history,
    );
  if (!decision.args || typeof decision.args !== 'object')
    throw new AgentFailure(
      `step ${step} ${decision.tool} decision carries no argument object: ${JSON.stringify(decision)}`,
      history,
    );
  return {
    tool: decision.tool,
    args: decision.args,
    thought: decision.thought,
  };
}

/** Why the model gave up, as it said; a give_up naming no reason says so. */
export function giveUpReason(args: Record<string, any>): string {
  return typeof args.reason === 'string' && args.reason
    ? args.reason
    : `give_up named no reason: ${JSON.stringify(args)}`;
}
