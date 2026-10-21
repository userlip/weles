// Whether a credential-operation request matches the exact acquisition
// contract Weles declares for it: the acquisition catalog's definition, the
// credential contract's item, field and writer, the directory identity and
// the signup origin. A request that matches becomes the acquisition request
// the existing acquisition workflow runs; one that is refused is answered
// with the refusal's own status, code and cause.
import { constants as http } from 'node:http2';
import { credentialFailure } from '@wisent-ai/weles-client/credential/response';
import { CredentialAdmissionError } from './authority.mjs';

/**
 * The HTTP answer to a request refused with `error`: a refusal Weles stated
 * keeps its status and code, any other is an invalid request; a request
 * that validated is answered in the credential-operation shape, with no
 * provider effect only for a stated refusal of a submit before execution.
 * `read` says how far the request got: whether it parsed and validated.
 */
export function refusalResponse(error, request, read) {
  const known = error instanceof CredentialAdmissionError;
  const status = known ? error.status : http.HTTP_STATUS_BAD_REQUEST;
  const code = known ? error.code : 'WELES_CREDENTIAL_REQUEST_INVALID';
  const message =
    known || read.parsed
      ? error.message
      : `credential request must be one bounded JSON object: ${error.message}`;
  if (!read.validated)
    return {
      status,
      payload: { code, phase: 'admission', message, providerEffect: 'none' },
    };
  const untouched =
    known &&
    status < http.HTTP_STATUS_INTERNAL_SERVER_ERROR &&
    request.mode === 'submit';
  return {
    status,
    payload: credentialFailure(
      request,
      code,
      message,
      untouched ? 'none' : 'unknown',
    ),
  };
}

/**
 * The acquisition request a credential-operation request stands for. The
 * client's validation leaves account_email and directory either stated or
 * null, and signup_origin stated, null or absent.
 */
function acquisitionRequest(request) {
  const directory = request.directory;
  return {
    operation: request.operation,
    credentialId: request.credential_id,
    provider: request.provider,
    requestId: request.request_id,
    purpose: request.purpose,
    ...(request.account_email === null
      ? {}
      : { accountEmail: request.account_email }),
    ...(request.signup_origin ? { signupOrigin: request.signup_origin } : {}),
    ...(directory === null
      ? {}
      : {
          tenantId: directory.tenant_id,
          principalObjectId: directory.principal_object_id,
          accountUpn: directory.account_upn,
        }),
    dryRun: request.dry_run,
  };
}

/** Where managed password declarations are read from, as a refusal can say it. */
function declarationsSource() {
  const path = process.env.WELES_MANAGED_PASSWORD_CONTRACTS_FILE?.trim();
  if (!path) return 'WELES_MANAGED_PASSWORD_CONTRACTS_FILE is unset';
  return `WELES_MANAGED_PASSWORD_CONTRACTS_FILE names ${path}`;
}

/**
 * The acquisition request for `request`, refused with the mismatch it names
 * when no acquisition is declared for it or it differs from the declaration.
 */
export function admittedAcquisition(
  request,
  { definitionFor, resolvedAcquiredSecretContract },
) {
  const acquisition = acquisitionRequest(request);
  const definition = definitionFor(acquisition);
  if (!definition)
    throw new CredentialAdmissionError(
      http.HTTP_STATUS_CONFLICT,
      'WELES_CREDENTIAL_CONTRACT_MISMATCH',
      `No acquisition is declared for ${request.credential_id} (provider ${request.provider}); a managed password is declared in the deployment's managed password declarations, and ${declarationsSource()}`,
    );
  const contract = resolvedAcquiredSecretContract(definition.secret);
  if (
    !contract ||
    definition.provider !== request.provider ||
    contract.item !== request.credential_id ||
    contract.field !== request.field ||
    contract.writerConsumer !== request.consumer
  )
    throw new CredentialAdmissionError(
      http.HTTP_STATUS_CONFLICT,
      'WELES_CREDENTIAL_CONTRACT_MISMATCH',
      'credential item, field, and writer must match the exact Weles acquisition contract',
    );
  // Only a directory-owned password (provider microsoft_entra) names a
  // directory, and it names the provider it was requested for.
  const directoryOwned = request.provider === 'microsoft_entra';
  if (
    directoryOwned
      ? request.directory?.provider !== request.provider
      : request.directory !== null
  )
    throw new CredentialAdmissionError(
      http.HTTP_STATUS_CONFLICT,
      'ENTRA_IDENTITY_CONTRACT_MISMATCH',
      'directory identity must match the requested provider',
    );
  if (
    request.signup_origin &&
    contract.sourceOrigin &&
    request.signup_origin !== contract.sourceOrigin
  )
    throw new CredentialAdmissionError(
      http.HTTP_STATUS_CONFLICT,
      'WELES_CREDENTIAL_ORIGIN_MISMATCH',
      'signup origin differs from the registered credential capture origin',
    );
  return acquisition;
}
