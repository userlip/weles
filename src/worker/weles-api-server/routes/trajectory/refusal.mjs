// A route's refusal: thrown where the request fails a check, answered once
// where the route handles it, with the status and JSON body it names.
import { json } from '../../http-exchange.mjs';

export class RouteRefusal extends Error {
  constructor(status, payload, options) {
    super(payload.message ? payload.message : payload.error, options);
    this.status = status;
    this.payload = payload;
  }
}

/** Answer `res` with `error` when it is a route's refusal; any other failure is thrown on. */
export function answerRefusal(res, error) {
  if (!(error instanceof RouteRefusal)) throw error;
  json(res, error.status, error.payload);
}
