/**
 * Custom encryption for sensitive data (alternative to Supabase Vault)
 * Use this if Vault extension is not available in your Supabase instance
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 64;

/**
 * Get encryption key from environment variable
 * Generate with: openssl rand -hex 32
 */
function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable is not set');
  }
  if (key.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
  }
  return Buffer.from(key, 'hex');
}

/**
 * Encrypt a string
 *
 * @param text - Plain text to encrypt
 * @returns Encrypted string in format: iv:authTag:salt:encrypted
 */
export function encrypt(text: string): string {
  const key = getEncryptionKey();

  // Generate random IV and salt
  const iv = crypto.randomBytes(IV_LENGTH);
  const salt = crypto.randomBytes(SALT_LENGTH);

  // Create cipher
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  // Encrypt
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  // Get auth tag
  const authTag = cipher.getAuthTag();

  // Return format: iv:authTag:salt:encrypted
  return [
    iv.toString('hex'),
    authTag.toString('hex'),
    salt.toString('hex'),
    encrypted
  ].join(':');
}

/**
 * Decrypt a string
 *
 * @param encryptedData - Encrypted string in format: iv:authTag:salt:encrypted
 * @returns Decrypted plain text
 */
export function decrypt(encryptedData: string): string {
  const key = getEncryptionKey();

  // Parse encrypted data
  const parts = encryptedData.split(':');
  if (parts.length !== 4) {
    console.error('Invalid encrypted data format. Expected 4 parts, got:', parts.length);
    console.error('Data preview:', encryptedData.substring(0, 50) + '...');
    throw new Error('Invalid encrypted data format. Please re-create this integration.');
  }

  const [ivHex, authTagHex, saltHex, encryptedHex] = parts;

  // Validate hex strings
  if (!ivHex || !authTagHex || !encryptedHex) {
    throw new Error('Invalid encrypted data format. Please re-create this integration.');
  }

  try {
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const encrypted = encryptedHex;

    // Create decipher
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    // Decrypt
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    console.error('Decryption failed:', error);
    throw new Error('Failed to decrypt secret. Please re-create this integration.');
  }
}

/**
 * Generate a new encryption key
 * Run this once and save the output to your .env file
 */
export function generateEncryptionKey(): string {
  return crypto.randomBytes(32).toString('hex');
}

// Example usage:
// const key = generateEncryptionKey();
// console.log('Add this to your .env file:');
// console.log(`ENCRYPTION_KEY=${key}`);
