import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  createServer,
  request as httpRequest,
  STATUS_CODES,
  type Server,
} from 'node:http';
import { type AddressInfo, connect } from 'node:net';
import { networkInterfaces } from 'node:os';
import { statusCode } from '../../platforms/_shared/http-status.js';

function securelyEqual(left: string, right: string): boolean {
  const leftDigest = createHash('sha256').update(left).digest();
  const rightDigest = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

/** HTTP Basic credentials for `user:password` text, encoded as UTF-8. */
function basicCredentials(userAndPassword: string): string {
  const bytes = new TextEncoder().encode(userAndPassword);
  return `Basic ${btoa(String.fromCharCode(...bytes))}`;
}

/**
 * The address of this host's internal IPv4 interface, measured, so the
 * forwarder is reachable only from this machine.
 */
function loopbackAddress(): string {
  const loopback = Object.values(networkInterfaces())
    .flat()
    .find((iface) => iface?.internal && iface.family === 'IPv4');
  if (!loopback)
    throw new Error(
      'this host reports no internal IPv4 interface, so the local proxy forwarder has nowhere private to listen',
    );
  return loopback.address;
}

const HEAD_END = '\r\n\r\n';

/**
 * Starts a forwarder on this host's internal interface that adds the
 * upstream proxy's credentials, so Chrome is handed a proxy URL whose own
 * credentials are a fresh random password only this process knows. A
 * request without that password is answered Proxy Authentication Required;
 * an upstream CONNECT answered with anything but OK closes the client's
 * socket with the upstream status line as the cause.
 */
export async function startCredentialForwarder(
  proxyUrl: URL,
): Promise<{ url: string; server: Server }> {
  const upstream = {
    host: proxyUrl.hostname,
    port: Number(proxyUrl.port),
    authorization: basicCredentials(
      `${decodeURIComponent(proxyUrl.username)}:${decodeURIComponent(proxyUrl.password)}`,
    ),
  };
  const local = { username: 'weles', password: randomUUID() };
  const expected = basicCredentials(`${local.username}:${local.password}`);
  const isAuthorized = (header: string | string[] | undefined): boolean =>
    typeof header === 'string' && securelyEqual(header, expected);
  const challenge = 'Basic realm="weles-local-proxy"';
  const proxyAuthRequired = statusCode('Proxy Authentication Required');
  const ok = statusCode('OK');
  const srv = createServer((req, res) => {
    if (!isAuthorized(req.headers['proxy-authorization'])) {
      res.writeHead(proxyAuthRequired, {
        Connection: 'close',
        'Proxy-Authenticate': challenge,
      });
      res.end(STATUS_CODES[proxyAuthRequired]);
      return;
    }
    const forwarded = httpRequest(
      {
        host: upstream.host,
        port: upstream.port,
        path: req.url,
        method: req.method,
        headers: {
          ...req.headers,
          'Proxy-Authorization': upstream.authorization,
        },
      },
      (pRes) => {
        // A response node:http hands to a client request always carries its status.
        res.writeHead(pRes.statusCode as number, pRes.headers);
        pRes.pipe(res);
      },
    );
    req.pipe(forwarded);
    forwarded.on('error', (error) => res.destroy(error));
  });
  srv.on('connect', (req, clientSocket, head) => {
    const version = `HTTP/${req.httpVersion}`;
    if (!isAuthorized(req.headers['proxy-authorization'])) {
      clientSocket.end(
        `${version} ${proxyAuthRequired} ${STATUS_CODES[proxyAuthRequired]}\r\nProxy-Authenticate: ${challenge}\r\nConnection: close${HEAD_END}`,
      );
      return;
    }
    const connectRequest = `CONNECT ${req.url} ${version}\r\nHost: ${req.url}\r\nProxy-Authorization: ${upstream.authorization}${HEAD_END}`;
    const upSocket = connect(upstream.port, upstream.host, () => {
      upSocket.write(connectRequest);
      upSocket.write(head);
    });
    upSocket.on('error', (error) => clientSocket.destroy(error));
    clientSocket.on('error', (error) => upSocket.destroy(error));
    upSocket.once('data', (chunk: Buffer) => {
      const responseHead = chunk.toString();
      const [headText] = responseHead.split(HEAD_END);
      const [statusLine] = headText.split('\r\n');
      const [, code] = statusLine.split(' ');
      if (Number(code) !== ok) {
        clientSocket.destroy(
          new Error(
            `the upstream proxy answered CONNECT ${req.url} with "${statusLine}"`,
          ),
        );
        upSocket.destroy();
        return;
      }
      clientSocket.write(`${version} ${ok} Connection Established${HEAD_END}`);
      const rest = responseHead.includes(HEAD_END)
        ? chunk.subarray(Buffer.byteLength(headText + HEAD_END))
        : null;
      if (rest?.length) clientSocket.write(rest);
      upSocket.pipe(clientSocket);
      clientSocket.pipe(upSocket);
    });
  });
  await new Promise<void>((resolve) =>
    srv.listen({ host: loopbackAddress() }, resolve),
  );
  const bound = srv.address() as AddressInfo;
  const url = `http://${encodeURIComponent(local.username)}:${encodeURIComponent(local.password)}@${bound.address}:${bound.port}`;
  return { url, server: srv };
}
