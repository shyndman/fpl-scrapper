/**
 * Shared transport-layer error taxonomy for FPL modules.
 * Keep these classes stable so callers can distinguish auth, rate-limit,
 * and not-found failures while preserving lower-level causes.
 */
export class FPLAPIError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'FPLAPIError';
  }
}

export class FPLAuthError extends FPLAPIError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'FPLAuthError';
  }
}

export class FPLRateLimitError extends FPLAPIError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'FPLRateLimitError';
  }
}

export class FPLNotFoundError extends FPLAPIError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'FPLNotFoundError';
  }
}
