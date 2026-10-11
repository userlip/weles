import * as net from 'node:net';

export interface EndpointInfo {
  url: string;
  source: 'environment';
  sourceDetail: string;
  isListening: boolean;
}

export interface EndpointResolutionResult {
  resolved: EndpointInfo | null;
  candidates: EndpointInfo[];
  wasExplicitOverride: boolean;
}

/**
 * Check if a URL endpoint is currently listening (for TCP-based services).
 * Opens a socket and closes it as soon as the connection is accepted or
 * refused; an unreachable host is answered by the operating system's own
 * connect error.
 * @param urlString The URL to check (e.g., 'http://127.0.0.1:9000')
 * @returns Promise<boolean> true if the endpoint accepted the connection
 */
export async function isEndpointListening(urlString: string): Promise<boolean> {
  // A value that is not a URL, or names no valid port, is a configuration
  // error and is thrown as one, never reported as an endpoint not listening.
  let url: URL;
  try {
    url = new URL(urlString);
  } catch (error) {
    throw new Error(
      `endpoint ${JSON.stringify(urlString)} is not a URL: ${(error as Error).message}`,
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

  const { promise, resolve } = Promise.withResolvers<boolean>();
  const socket = new net.Socket();

  socket.on('connect', () => {
    socket.destroy();
    resolve(true);
  });

  socket.on('error', (error: NodeJS.ErrnoException) => {
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
 */
export async function resolveSkarbiecEndpoint(): Promise<EndpointResolutionResult> {
  const envUrl = process.env.WC_SKARBIEC_URL?.trim();
  if (!envUrl) {
    return { resolved: null, candidates: [], wasExplicitOverride: false };
  }

  const resolved: EndpointInfo = {
    url: envUrl,
    source: 'environment',
    sourceDetail: 'WC_SKARBIEC_URL environment variable',
    isListening: await isEndpointListening(envUrl),
  };
  return { resolved, candidates: [resolved], wasExplicitOverride: true };
}

/**
 * Format an endpoint resolution error message with clear details.
 * @param info The endpoint info that failed
 * @returns A formatted error message
 */
export function formatEndpointErrorMessage(info: EndpointInfo): string {
  const sourceLabel = `environment variable (${info.sourceDetail.split(' ')[0]})`;

  const listeningStatus = info.isListening ? 'listening' : 'not listening';

  return `Skarbiec endpoint at ${info.url} (from ${sourceLabel}) is ${listeningStatus}`;
}
