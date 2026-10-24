/** Largest claim document (matches the bucket limit) and screenshot, in bytes. */
export const MAX_CLAIM_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;

/**
 * What a failed storage upload means. Only an error without any HTTP status is a connection problem;
 * a 413 is a file above the bucket limit; any other status is an answer from the server, not the network.
 */
export function storageFailure(error: { statusCode?: string | number; status?: number }): 'too_large' | 'unknown' | 'network' {
  const status = Number(error.statusCode ?? error.status);
  if (status === 413) return 'too_large';
  return status > 0 ? 'unknown' : 'network';
}
