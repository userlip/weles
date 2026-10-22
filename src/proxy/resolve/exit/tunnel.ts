// One authenticated CONNECT through a proxy, answered by the proxy's own
// status line or the socket's own error, and the exit address read through
// such a tunnel from the declared public-address service.
import { connect, isIP, type Socket } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import {
  PUBLIC_ADDRESS_SERVICE,
} from '../../../utils/runtime/public-address.js';

// RFC 9110 section 4.2.2, https://www.rfc-editor.org/rfc/rfc9110#section-4.2.2:
// the https scheme's default port, which a CONNECT for an https origin names.
const HTTPS_PORT = 443;
// RFC 9110 section 15.3.1, https://www.rfc-editor.org/rfc/rfc9110#section-15.3.1:
// 200 OK: the answer that opens a CONNECT tunnel, and a successful GET.
export const HTTP_OK = 200;
// RFC 9110 section 15.5.8, https://www.rfc-editor.org/rfc/rfc9110#section-15.5.8:
// 407 Proxy Authentication Required.
export const PROXY_AUTHENTICATION_REQUIRED = 407;

export type ProxyEndpoint = {
  host: string;
  port: number;
  username: string;
  password: string;
};

/** The proxy's answer to CONNECT: its status line, or why none came. */
export type TunnelAnswer =
  | { statusLine: string; status?: number; socket: Socket }
  | { failure: string };

/** The status code of an HTTP/1.x status line (RFC 9112 section 4), when it has one. */
function statusOf(statusLine: string): number | undefined {
  const [version, code] = statusLine.split(' ');
  if (!version?.startsWith('HTTP/') || !/^\d+$/.test(code)) return undefined;
  return Number(code);
}

/**
 * CONNECT `target` (an https origin's host) through `proxy`. The socket stays
 * open for the caller when the proxy answered; a socket error or a close
 * before any answer is the failure, with its cause.
 */
export function openTunnel(
  proxy: ProxyEndpoint,
  target: string,
): Promise<TunnelAnswer> {
  const authorization = Buffer.from(
    `${proxy.username}:${proxy.password}`,
  ).toString('base64');
  const { promise, resolve } = Promise.withResolvers<TunnelAnswer>();
  const socket = connect({ host: proxy.host, port: proxy.port }, () =>
    socket.write(
      `CONNECT ${target}:${HTTPS_PORT} HTTP/1.1\r\nHost: ${target}:${HTTPS_PORT}\r\nProxy-Authorization: Basic ${authorization}\r\n\r\n`,
    ),
  );
  const onError = (error: Error) =>
    resolve({ failure: `the proxy connection failed: ${error.message}` });
  const onClose = () =>
    resolve({ failure: 'the proxy closed the connection without answering' });
  socket.once('error', onError);
  socket.once('close', onClose);
  // The proxy's status line, its error or its close is the answer; no timer
  // decides for it.
  socket.once('data', (chunk: Buffer) => {
    socket.off('error', onError);
    socket.off('close', onClose);
    const [statusLine] = chunk.toString('latin1').split('\r\n');
    resolve({ statusLine, status: statusOf(statusLine), socket });
  });
  return promise;
}

/**
 * The exit address `proxy` gives, asked through a tunnel of its own from the
 * declared public-address service, so the proxy's credentials never leave
 * this process. Refused with the step that failed.
 */
export async function readExitAddress(proxy: ProxyEndpoint): Promise<string> {
  const service = PUBLIC_ADDRESS_SERVICE.hostname;
  const tunnel = await openTunnel(proxy, service);
  if ('failure' in tunnel)
    throw new Error(`CONNECT ${service}: ${tunnel.failure}`);
  if (tunnel.status !== HTTP_OK) {
    tunnel.socket.destroy();
    throw new Error(`CONNECT ${service} answered ${tunnel.statusLine}`);
  }
  const secure = tlsConnect({ socket: tunnel.socket, servername: service });
  const chunks: Buffer[] = [];
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  secure.on('data', (chunk: Buffer) => chunks.push(chunk));
  secure.once('end', () => resolve());
  secure.once('error', reject);
  // HTTP/1.0 asks for an unchunked body that ends with the connection.
  secure.write(
    `GET ${PUBLIC_ADDRESS_SERVICE.pathname} HTTP/1.0\r\nHost: ${service}\r\n\r\n`,
  );
  await promise;
  const [head, ...body] = Buffer.concat(chunks)
    .toString('utf8')
    .split('\r\n\r\n');
  const [statusLine] = head.split('\r\n');
  const address = body.join('\r\n\r\n').trim();
  if (statusOf(statusLine) !== HTTP_OK)
    throw new Error(`${service} answered ${statusLine}: ${address}`);
  if (!isIP(address))
    throw new Error(
      `${service} answered no address: ${JSON.stringify(address)}`,
    );
  return address;
}
