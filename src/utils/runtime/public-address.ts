// The service that answers a caller's public address as plain text, asked
// directly for this machine's own address and through a proxy tunnel for an
// exit's. One declaration, so every reader asks the same service.
export const PUBLIC_ADDRESS_SERVICE = new URL('https://api.ipify.org');
