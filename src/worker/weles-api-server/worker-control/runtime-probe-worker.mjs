// The browser runtime inspector, run in a worker thread of its own. The
// inspector resolves the Playwright manifest and the bundled encoder with
// synchronous file reads before it runs the encoder; on the API's own thread
// a disk that stops answering would stop every request with them. Here only
// this thread waits, and its one message is the inspector's report.

import { parentPort } from 'node:worker_threads';
import { inspectBrowserRuntime } from '../../../../dist/cli/diagnostics/browser-runtime.js';

parentPort.postMessage(await inspectBrowserRuntime());
