// The token a captcha-solver task (the anti-captcha / CapSolver getTaskResult
// API) comes back with, once it is solved. The solvers offer no push or
// blocking answer and a solve has no clock that ends it, so the task is read
// again as soon as each reading answers, until the solver hands over its
// token, refuses the task, or the run is cancelled. A refusal, an answer that
// is not JSON and a ready task that carries no token each fail the solve with
// what the solver said.

async function readTask(svc, apiKey, taskId) {
  const response = await fetch(`${svc.url}/getTaskResult`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientKey: apiKey, taskId }),
  });
  // The answer is read as text so a refusal or a body that is not JSON reaches
  // the error whole.
  const body = await response.text();
  if (!response.ok)
    throw new Error(
      `captcha_${svc.name}_http_${response.status}: getTaskResult for task ${taskId} failed: ${body}`,
    );
  let answer;
  try {
    answer = JSON.parse(body);
  } catch (error) {
    throw new Error(
      `captcha_${svc.name}_answer_invalid: getTaskResult for task ${taskId} answered a body that is not JSON (${error.message}): ${body}`,
      { cause: error },
    );
  }
  if (answer.errorId)
    throw new Error(
      `captcha_${svc.name}_error: task ${taskId} was refused: ${body}`,
    );
  return answer;
}

export async function solverTaskResult(svc, apiKey, taskId) {
  for (;;) {
    const answer = await readTask(svc, apiKey, taskId);
    if (answer.status === 'ready') {
      const token = answer.solution?.gRecaptchaResponse
        ? answer.solution.gRecaptchaResponse
        : answer.solution?.token;
      if (!token)
        throw new Error(
          `captcha_${svc.name}_no_token: task ${taskId} is ready but its solution carries no token: ${JSON.stringify(answer)}`,
        );
      return token;
    }
  }
}
