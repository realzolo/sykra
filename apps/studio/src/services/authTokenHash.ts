import { createHash, randomBytes } from 'crypto';

export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function createOpaqueToken(bytes = 32) {
  return randomBytes(bytes).toString('hex');
}
