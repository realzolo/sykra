/**
 * Error handling and retry service
 * Supports exponential backoff
 */

import { logger } from './logger';

export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
}

export class RetryableError extends Error {
  constructor(
    message: string,
    public readonly isRetryable: boolean = true,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'RetryableError';
  }
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelayMs = 1000,
    maxDelayMs = 30000,
    backoffMultiplier = 2,
  } = options;

  let lastError: Error | null = null;
  let delay = initialDelayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Check retryability
      const isRetryable =
        err instanceof RetryableError
          ? err.isRetryable
          : err instanceof Error && (
              err.message.includes('timeout') ||
              err.message.includes('ECONNREFUSED') ||
              err.message.includes('ENOTFOUND')
            );

      if (!isRetryable || attempt === maxAttempts) {
        throw lastError;
      }

      logger.warn(`Attempt ${attempt}/${maxAttempts} failed, retrying in ${delay}ms`, lastError);

      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * backoffMultiplier, maxDelayMs);
    }
  }

  throw lastError || new Error('Unknown error');
}

/**
 * Map errors to HTTP status codes
 */
export function getErrorStatusCode(error: unknown): number {
  if (error instanceof RetryableError) {
    return error.statusCode || 500;
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes('conflict') || message.includes('409')) {
      return 409;
    }
    if (message.includes('not found') || message.includes('404')) {
      return 404;
    }
    if (message.includes('unauthorized') || message.includes('401')) {
      return 401;
    }
    if (message.includes('forbidden') || message.includes('403')) {
      return 403;
    }
    if (message.includes('validation') || message.includes('invalid')) {
      return 400;
    }
  }

  return 500;
}

export function formatErrorResponse(error: unknown) {
  const statusCode = getErrorStatusCode(error);
  const message = error instanceof Error ? error.message : 'Internal server error';

  return {
    error: message,
    statusCode,
  };
}
