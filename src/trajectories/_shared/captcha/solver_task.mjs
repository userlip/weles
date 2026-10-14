// One read of a captcha-solver task (anti-captcha / CapSolver getTaskResult
// API). The solver has no push or blocking answer, so this never waits: a task
// that is still being worked on is reported as a named error carrying the task
// id, and the caller decides whether to read again later with that id.

export async function solverTaskResult(svc, apiKey, taskId) {
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
  let res;
  try {
    res = JSON.parse(body);
  } catch (error) {
    throw new Error(
      `captcha_${svc.name}_answer_invalid: getTaskResult for task ${taskId} answered a body that is not JSON (${error.message}): ${body}`,
    );
  }
  if (res.errorId) {
    const code =
      res.errorCode === undefined
        ? `errorId ${res.errorId} with no errorCode`
        : res.errorCode;
    const description =
      res.errorDescription === undefined
        ? 'no errorDescription'
        : res.errorDescription;
    throw new Error(
      `captcha_${svc.name}_error: task ${taskId}: ${code}: ${description}`,
    );
  }
  if (res.status !== 'ready') {
    const stated =
      res.status === undefined
        ? 'the answer states no status'
        : `status ${res.status}`;
    throw new Error(
      `captcha_${svc.name}_processing: task ${taskId} has no result yet (${stated}); read it again with this task id`,
    );
  }
  const token = res.solution?.gRecaptchaResponse ?? res.solution?.token;
  if (!token)
    throw new Error(
      `captcha_${svc.name}_no_token: task ${taskId} is ready but its solution carries no token`,
    );
  return token;
}
