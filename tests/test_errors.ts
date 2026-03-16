import { describe, expect, it } from 'vitest';

import { FPLAPIError, FPLAuthError, FPLNotFoundError, FPLRateLimitError } from '../src/errors.ts';

describe('src/errors.ts', () => {
  it('preserves the shared API inheritance tree', () => {
    expect(new FPLAuthError('auth')).toBeInstanceOf(FPLAPIError);
    expect(new FPLRateLimitError('rate')).toBeInstanceOf(FPLAPIError);
    expect(new FPLNotFoundError('missing')).toBeInstanceOf(FPLAPIError);
  });

  it('reports stable class names', () => {
    expect(new FPLAPIError('boom').name).toBe('FPLAPIError');
    expect(new FPLAuthError('boom').name).toBe('FPLAuthError');
    expect(new FPLRateLimitError('boom').name).toBe('FPLRateLimitError');
    expect(new FPLNotFoundError('boom').name).toBe('FPLNotFoundError');
  });

  it('preserves wrapped causes without changing the public error class', () => {
    const cause = new Error('socket closed');
    const error = new FPLAuthError('login failed', cause);

    expect(error).toBeInstanceOf(FPLAuthError);
    expect(error).toBeInstanceOf(FPLAPIError);
    expect(error.cause).toBe(cause);
  });
});
