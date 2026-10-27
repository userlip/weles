// Reading what Discord answers: a response the web client's own request got
// (its text, its JSON, or the empty acknowledgement), and an API path read
// for the signed-in page with the web token it holds. A refusal carries
// Discord's own answer and the request it answered.
import { STATUS_CODES } from 'node:http';

// The status HTTP names "No Content", the empty acknowledgement Discord gives.
const NO_CONTENT = Number(
  Object.keys(STATUS_CODES).find((code) => STATUS_CODES[code] === 'No Content'),
);

function responseDetails(response, operation) {
  return {
    operation,
    requestUrl: response.url(),
    httpStatus: response.status(),
  };
}

export async function readDiscordText(response, operation, errorPrefix) {
  let text;
  try {
    text = await response.text();
  } catch (cause) {
    throw Object.assign(
      new Error(`${errorPrefix}_RESPONSE_READ_FAILED`, { cause }),
      responseDetails(response, operation),
    );
  }
  if (!response.ok())
    throw Object.assign(
      new Error(
        `${errorPrefix}_HTTP_REFUSED: HTTP ${response.status()}: ${text}`,
      ),
      responseDetails(response, operation),
      {
        responseBody: text,
      },
    );
  return text;
}

export async function readDiscordReply(response, operation, errorPrefix) {
  const text = await readDiscordText(response, operation, errorPrefix);
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw Object.assign(
      new Error(`${errorPrefix}_RESPONSE_INVALID`, { cause }),
      responseDetails(response, operation),
      { responseBody: text },
    );
  }
}

export async function readDiscordNoContent(response, operation, errorPrefix) {
  const text = await readDiscordText(response, operation, errorPrefix);
  if (response.status() !== NO_CONTENT || text)
    throw Object.assign(
      new Error(
        `${errorPrefix}_UNCONFIRMED: expected an empty No Content acknowledgement; reconcile before another attempt`,
      ),
      responseDetails(response, operation),
      { responseBody: text },
    );
}

/**
 * What Discord's API answers `path` (under /api/v9) for the signed-in page,
 * read with the web token the page holds, parsed; refused with Discord's own
 * answer when it is not a success.
 */
export async function readDiscordApi(page, path, errorPrefix) {
  const answer = await page.evaluate(async (wanted) => {
    const stored = localStorage.token;
    if (!stored)
      return {
        ok: false,
        status: null,
        body: 'the page holds no Discord token',
      };
    const response = await fetch(`/api/v9${wanted}`, {
      headers: { Authorization: JSON.parse(stored) },
    });
    return {
      ok: response.ok,
      status: response.status,
      body: await response.text(),
    };
  }, path);
  if (!answer.ok)
    throw new Error(
      `${errorPrefix}_REFUSED: ${path} answered ${answer.status}: ${answer.body}`,
    );
  return JSON.parse(answer.body);
}
