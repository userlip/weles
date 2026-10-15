// Status codes of the record routes, from the routes' shared status table. No
// length or count of a request is chosen here; Skarbiec's record shapes and
// refusals decide.

export {
  HTTP_OK,
  HTTP_INVALID_REQUEST,
  HTTP_NOT_FOUND,
  HTTP_UPSTREAM_FAILED as HTTP_RECORD_FAILED,
} from '../http-status.mjs';
