// The captcha solver's one route to a vision model: Stado's model router,
// reached at STADO_MODEL_ROUTER_URL with WELES_STADO_MODEL_ROUTER_TOKEN.
import { serviceOrigin } from '../../../../dist/utils/runtime/service-origin.js';
import {
  optionalSetting,
  requiredSetting,
  secretSetting,
} from '../../../../dist/utils/runtime/settings.js';

const ROUTER_PATH = '/v1/chat/completions';
const MULTIMODAL_SELECTOR = 'any-vision-capable';

/** Credentials of other Weles services, which the router token may not repeat. */
const SIBLING_CREDENTIALS = [
  'WELES_STADO_OBJECT_API_TOKEN',
  'WELES_ARTIFACT_DELIVERY_TOKEN',
  'WELES_ARTIFACT_SIGNING_SECRET',
];

let routerConfig = null;

export function requireStadoModelRouterConfig() {
  if (routerConfig) return routerConfig;
  const env = process.env;
  const baseUrl = serviceOrigin(
    'STADO_MODEL_ROUTER_URL',
    requiredSetting(env, 'STADO_MODEL_ROUTER_URL'),
  );
  const token = secretSetting(env, 'WELES_STADO_MODEL_ROUTER_TOKEN');
  for (const siblingName of SIBLING_CREDENTIALS) {
    if (optionalSetting(env, siblingName) === token) {
      throw new Error(
        `WELES_STADO_MODEL_ROUTER_TOKEN must be distinct from ${siblingName}`,
      );
    }
  }
  routerConfig = { baseUrl, token };
  return routerConfig;
}

/** The text of a completion's content, refused when a part carries no text. */
function completionText(content) {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) {
    throw new Error(
      `Stado model-router answered message content that is neither text nor a list of parts: ${JSON.stringify(content)}`,
    );
  }
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (typeof part?.text === 'string') return part.text;
      throw new Error(
        `Stado model-router answered a content part without text: ${JSON.stringify(part)}`,
      );
    })
    .join('')
    .trim();
}

// No max_tokens and no temperature are sent: the model's own output limit
// and sampling apply. The media type is the capture's own; a type the model
// cannot read comes back as the provider's refusal, in its words.
export async function completeMultimodal({ base64, mimeType, prompt }) {
  if (typeof mimeType !== 'string' || !mimeType)
    throw new Error(
      `Stado model-router media type is ${JSON.stringify(mimeType)}, not a media type`,
    );
  if (typeof base64 !== 'string' || !base64)
    throw new Error('Stado model-router media payload is empty');
  if (typeof prompt !== 'string' || !prompt.trim())
    throw new Error('Stado model-router prompt is empty');

  const config = requireStadoModelRouterConfig();
  const response = await fetch(`${config.baseUrl}${ROUTER_PATH}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MULTIMODAL_SELECTOR,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: { url: `data:${mimeType};base64,${base64}` },
            },
          ],
        },
      ],
    }),
  });
  const responseText = await response.text();
  let payload;
  try {
    payload = JSON.parse(responseText);
  } catch (error) {
    throw new Error(
      `Stado model-router returned invalid JSON (HTTP ${response.status}): ${error.message}: ${responseText}`,
    );
  }
  if (!response.ok) {
    const detail =
      typeof payload?.error?.message === 'string'
        ? payload.error.message
        : responseText;
    throw new Error(`Stado model-router HTTP ${response.status}: ${detail}`);
  }
  const [choice] = Array.isArray(payload?.choices) ? payload.choices : [];
  if (!choice?.message) {
    throw new Error(
      `Stado model-router answered no choice with a message: ${responseText}`,
    );
  }
  const text = completionText(choice.message.content);
  if (!text) throw new Error('Stado model-router returned an empty completion');
  return {
    text,
    model:
      typeof payload.model === 'string'
        ? payload.model
        : `the model the router did not name (asked for ${MULTIMODAL_SELECTOR})`,
  };
}
