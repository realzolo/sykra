/**
 * API rate limiting middleware
 * Supports IP-based throttling
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

interface RateLimitConfig {
  windowMs: number; // Time window in ms
  maxRequests: number; // Max requests in window
}

interface RateLimitStore {
  [key: string]: {
    count: number;
    resetTime: number;
  };
}

const store: RateLimitStore = {};

// Cleanup expired rate limit records
setInterval(() => {
  const now = Date.now();
  for (const key in store) {
    const entry = store[key];
    if (entry && entry.resetTime < now) {
      delete store[key];
    }
  }
}, 60000); // Cleanup every minute

export function createInMemoryRateLimiter(config: RateLimitConfig) {
  return function rateLimiter(request: NextRequest) {
    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
    const key = `rate-limit:${ip}`;
    const now = Date.now();

    if (!store[key]) {
      store[key] = {
        count: 1,
        resetTime: now + config.windowMs,
      };
      return null; // Allow request
    }

    const record = store[key];
    if (!record) {
      return null;
    }

    // Check window
    if (now > record.resetTime) {
      record.count = 1;
      record.resetTime = now + config.windowMs;
      return null; // Allow request
    }

    // Check limit
    if (record.count >= config.maxRequests) {
      const retryAfter = Math.ceil((record.resetTime - now) / 1000);
      return NextResponse.json(
        { error: 'Too many requests' },
        {
          status: 429,
          headers: {
            'Retry-After': retryAfter.toString(),
            'X-RateLimit-Limit': config.maxRequests.toString(),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': record.resetTime.toString(),
          },
        }
      );
    }

    record.count++;
    return null; // Allow request
  };
}

// Predefined rate limits
export const RATE_LIMITS = {
  // Analyze API: 10 requests/min
  analyze: {
    windowMs: 60000,
    maxRequests: 10,
  },
  // General API: 60 requests/min
  general: {
    windowMs: 60000,
    maxRequests: 60,
  },
  // Strict: 5 requests/min
  strict: {
    windowMs: 60000,
    maxRequests: 5,
  },
};
