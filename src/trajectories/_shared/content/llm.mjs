/**
 * Persona-voiced generation through Weles's scoped Stado model-router client.
 * Provider credentials and product CRON secrets never enter this process.
 */

const MODEL_ALIAS = 'weles-organic';

function routerConfig() {
  const rawUrl = String(process.env.STADO_MODEL_ROUTER_URL || '').trim();
  const token = String(process.env.WELES_STADO_MODEL_ROUTER_TOKEN || '').trim();
  if (!rawUrl || !token)
    throw new Error('missing exact Weles model-router configuration');
  const endpoint = new URL(rawUrl);
  if (
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    (endpoint.pathname !== '/' && endpoint.pathname !== '')
  ) {
    throw new Error('invalid Weles model-router origin');
  }
  return { endpoint: endpoint.origin, token };
}

async function callGenerate(body) {
  const { endpoint, token } = routerConfig();
  // The gateway answers or the connection ends. A generation that is still
  // producing is not a generation that failed.
  const res = await fetch(`${endpoint}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model: MODEL_ALIAS,
      messages: [{ role: 'user', content: JSON.stringify(body) }],
    }),
  });
  // The router's own answer is what a failure carries; a body that is not
  // JSON is quoted, never read as an empty object, and an answer without
  // text is shown whole.
  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Stado model generation answered HTTP ${res.status} with a body that is not JSON (${error.message}): ${raw}`,
    );
  }
  if (!res.ok)
    throw new Error(
      `Stado model generation ${res.status}: ${JSON.stringify(data.error ?? data)}`,
    );
  const content = data.choices?.[0]?.message?.content;
  const text = typeof content === 'string' ? content.trim() : '';
  if (!text)
    throw new Error(
      `Stado model generation returned no text: ${JSON.stringify(data)}`,
    );
  return text;
}

export async function generateOrganicComment({ persona, post }) {
  return callGenerate({ task: 'organic_comment', persona, post });
}

export async function generatePromoteComment({ persona, post, product }) {
  return callGenerate({ task: 'promote', persona, post, product });
}

export async function generatePost({ persona, surface, product }) {
  const task = product ? 'post_promote' : 'post';
  return callGenerate({ task, persona, surface, product });
}
