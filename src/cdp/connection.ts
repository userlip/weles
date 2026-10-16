import WebSocket from 'ws';
import { CDPError, CDPTargetClosedError } from './errors';

interface PendingCommand {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
}

type EventCallback = (params: any) => void;

// One DevTools protocol connection. A message the browser sent that is not
// JSON, a listener that threw on an event, or a socket error after the
// connection opened breaks the connection: every command in flight is
// rejected with that cause and every later command is refused naming it, so
// the run fails with the reason instead of reading a dropped event as
// silence.
//
// An event is delivered to the listeners of its own session (the message's
// sessionId, as the flat protocol carries it) and to the listeners that
// named no session. Events the protocol defines without parameters reach
// their listeners with none.
export class CDPConnection {
  private _ws: WebSocket | null = null;
  private _lastId = Number();
  private _pending = new Map<number, PendingCommand>();
  private _listeners = new Map<string, Set<EventCallback>>();
  private _closed = false;
  private _failure: Error | null = null;

  async connect(wsUrl: string): Promise<void> {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const ws = new WebSocket(wsUrl);
    ws.on('open', () => {
      this._ws = ws;
      this._closed = false;
      this._failure = null;
      resolve();
    });
    ws.on('message', (data: WebSocket.Data) => this._onMessage(data));
    ws.on('close', (code: number, reason: Buffer) => {
      this._closed = true;
      if (this._failure) this._rejectAllPending(this._failure);
      else
        this._rejectAllPending(
          new CDPTargetClosedError(
            `the browser closed the DevTools connection (close code ${code}${reason.length ? `: ${reason.toString()}` : ''})`,
          ),
        );
    });
    ws.on('error', (err: Error) => {
      if (this._ws) this._fail(err);
      else reject(err);
    });
    return promise;
  }

  send(
    method: string,
    params?: Record<string, any>,
    sessionId?: string,
  ): Promise<any> {
    if (this._failure) return Promise.reject(this._failure);
    if (this._closed || !this._ws) {
      return Promise.reject(
        new CDPTargetClosedError(
          `the DevTools connection is closed, so ${method} was not sent`,
        ),
      );
    }

    const id = ++this._lastId;
    const msg: Record<string, any> = { id, method };
    if (params) msg.params = params;
    if (sessionId) msg.sessionId = sessionId;

    const { promise, resolve, reject } = Promise.withResolvers<any>();
    this._pending.set(id, { resolve, reject });
    this._ws.send(JSON.stringify(msg), (err) => {
      if (err) {
        this._pending.delete(id);
        reject(err);
      }
    });
    return promise;
  }

  on(event: string, callback: EventCallback, sessionId?: string): void {
    const key = sessionId ? `${sessionId}:${event}` : event;
    let set = this._listeners.get(key);
    if (!set) {
      set = new Set();
      this._listeners.set(key, set);
    }
    set.add(callback);
  }

  off(event: string, callback: EventCallback, sessionId?: string): void {
    const key = sessionId ? `${sessionId}:${event}` : event;
    this._listeners.get(key)?.delete(callback);
  }

  async close(): Promise<void> {
    const ws = this._ws;
    if (!ws) return;
    this._closed = true;
    this._rejectAllPending(
      new CDPTargetClosedError(
        'this client closed the DevTools connection while the command was in flight',
      ),
    );
    const { promise, resolve } = Promise.withResolvers<void>();
    ws.once('close', () => resolve());
    ws.close();
    return promise;
  }

  get closed(): boolean {
    return this._closed;
  }

  private _onMessage(data: WebSocket.Data): void {
    let msg: any;
    try {
      msg = JSON.parse(data.toString());
    } catch (cause) {
      this._fail(
        new CDPError(
          `the browser sent a DevTools message that is not JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
        ),
      );
      return;
    }

    if (msg.id !== undefined) {
      const pending = this._pending.get(msg.id);
      if (pending) {
        this._pending.delete(msg.id);
        if (msg.error) {
          pending.reject(
            new CDPError(`${msg.error.message} (${msg.error.code})`),
          );
        } else {
          pending.resolve(msg.result);
        }
      }
      return;
    }

    if (msg.method) {
      if (msg.sessionId) this._fireEvent(`${msg.sessionId}:${msg.method}`, msg.params);
      this._fireEvent(msg.method, msg.params);
    }
  }

  // Every listener of the event runs; one that threw breaks the connection
  // with its error once the others have had the event.
  private _fireEvent(key: string, params: any): void {
    const set = this._listeners.get(key);
    if (!set) return;
    const failures: unknown[] = [];
    for (const cb of set) {
      try {
        cb(params);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length)
      this._fail(
        new AggregateError(failures, `a listener of the DevTools event ${key} threw`),
      );
  }

  private _fail(error: Error): void {
    if (!this._failure) this._failure = error;
    this._rejectAllPending(this._failure);
  }

  private _rejectAllPending(error: Error): void {
    for (const pending of this._pending.values()) {
      pending.reject(error);
    }
    this._pending.clear();
  }
}
