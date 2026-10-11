import * as net from 'node:net';

/**
 * Check if a URL endpoint is currently listening (for TCP-based services).
 * The connection being accepted or refused answers it; an unreachable host is
 * answered by the operating system's own connect error.
 * @param {string} urlString The URL to check
 * @returns {Promise<boolean>} true if listening
 */
export async function isEndpointListening(urlString) {
  // A value that is not a URL, or names no valid port, is a configuration
  // error and is thrown as one, never reported as an endpoint not listening.
  let url;
  try {
    url = new URL(urlString);
  } catch (error) {
    throw new Error(
      `endpoint ${JSON.stringify(urlString)} is not a URL: ${error.message}`,
    );
  }
  const host = url.hostname;
  const port = parseInt(
    url.port || (url.protocol === 'https:' ? '443' : '80'),
    10,
  );

  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`endpoint ${urlString} names no valid TCP port`);
  }

  const { promise, resolve } = Promise.withResolvers();
  const socket = new net.Socket();

  socket.on('connect', () => {
    socket.destroy();
    resolve(true);
  });

  socket.on('error', (error) => {
    console.log(
      `[endpoint] ${host}:${port} not listening: ${error.code ?? error.message}`,
    );
    resolve(false);
  });

  socket.connect(port, host);
  return promise;
}

/**
 * Resolve the exact Skarbiec endpoint exported by a caller after consulting the
 * Stado service directory. This helper deliberately has no marker scan or
 * built-in address: a missing declaration is a startup error, not permission to
 * select a second authority.
 *
 * @returns {Promise<{resolved: {url, isListening}|null}>}
 */
export async function resolveSkarbiecEndpoint() {
  const envUrl = process.env.WC_SKARBIEC_URL?.trim();
  if (!envUrl) {
    return { resolved: null };
  }

  return {
    resolved: {
      url: envUrl,
      isListening: await isEndpointListening(envUrl),
    },
  };
}

/**
 * Format an endpoint error message with clear details.
 * @param {Object} info Endpoint info object
 * @returns {string} Formatted error message
 */
export function formatEndpointErrorMessage(info) {
  return `Skarbiec endpoint at ${info.url} (from Stado service directory via WC_SKARBIEC_URL) is ${info.isListening ? 'listening' : 'not listening'}`;
}
