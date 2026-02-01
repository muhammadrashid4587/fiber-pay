/**
 * Key Manager
 * Handles generation, storage, and encryption of Fiber node keys
 * Keys are isolated from LLM context for security
 */

import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'fs';
import { join, dirname } from 'path';
import type { KeyConfig, KeyInfo, HexString } from '../types/index.js';

// =============================================================================
// Constants
// =============================================================================

const SCRYPT_N = 2 ** 14;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const ENCRYPTED_MAGIC = Buffer.from('FIBERENC');

// =============================================================================
// Key Manager
// =============================================================================

export class KeyManager {
  private config: KeyConfig;
  private fiberKeyPath: string;
  private ckbKeyPath: string;

  constructor(config: KeyConfig) {
    this.config = config;
    this.fiberKeyPath = join(config.baseDir, 'fiber', 'sk');
    this.ckbKeyPath = join(config.baseDir, 'ckb', 'key');
  }

  /**
   * Initialize keys - generate if they don't exist and autoGenerate is true
   */
  async initialize(): Promise<{ fiber: KeyInfo; ckb: KeyInfo }> {
    const fiberExists = existsSync(this.fiberKeyPath);
    const ckbExists = existsSync(this.ckbKeyPath);

    if (!fiberExists || !ckbExists) {
      if (!this.config.autoGenerate) {
        throw new Error(
          `Keys not found and autoGenerate is disabled. ` +
            `Missing: ${[!fiberExists && 'fiber', !ckbExists && 'ckb'].filter(Boolean).join(', ')}`
        );
      }
    }

    // Generate missing keys
    if (!fiberExists) {
      await this.generateKey('fiber');
    }
    if (!ckbExists) {
      await this.generateKey('ckb');
    }

    return {
      fiber: await this.getKeyInfo('fiber'),
      ckb: await this.getKeyInfo('ckb'),
    };
  }

  /**
   * Generate a new key
   */
  async generateKey(type: 'fiber' | 'ckb'): Promise<KeyInfo> {
    const keyPath = type === 'fiber' ? this.fiberKeyPath : this.ckbKeyPath;
    const keyDir = dirname(keyPath);

    // Create directory if it doesn't exist
    if (!existsSync(keyDir)) {
      mkdirSync(keyDir, { recursive: true });
    }

    // Generate 32 random bytes
    const privateKey = randomBytes(32);

    // Encrypt if password is provided
    let keyData: Buffer;
    if (this.config.encryptionPassword) {
      keyData = this.encryptKey(privateKey, this.config.encryptionPassword);
    } else {
      // Store as hex without 0x prefix
      keyData = Buffer.from(privateKey.toString('hex'));
    }

    // Write key file with restricted permissions
    writeFileSync(keyPath, keyData);
    chmodSync(keyPath, 0o600);

    return this.getKeyInfo(type);
  }

  /**
   * Get information about a key (without exposing the private key)
   */
  async getKeyInfo(type: 'fiber' | 'ckb'): Promise<KeyInfo> {
    const keyPath = type === 'fiber' ? this.fiberKeyPath : this.ckbKeyPath;

    if (!existsSync(keyPath)) {
      throw new Error(`Key not found: ${keyPath}`);
    }

    const keyData = readFileSync(keyPath);
    const encrypted = this.isEncrypted(keyData);

    // Get private key to derive public key
    const privateKey = await this.loadPrivateKey(type);
    const publicKey = this.derivePublicKey(privateKey);

    return {
      publicKey,
      encrypted,
      path: keyPath,
      createdAt: Date.now(), // TODO: get actual file creation time
    };
  }

  /**
   * Load and decrypt a private key (for internal use only)
   * This should NEVER be exposed to the LLM context
   */
  private async loadPrivateKey(type: 'fiber' | 'ckb'): Promise<Buffer> {
    const keyPath = type === 'fiber' ? this.fiberKeyPath : this.ckbKeyPath;
    const keyData = readFileSync(keyPath);

    if (this.isEncrypted(keyData)) {
      if (!this.config.encryptionPassword) {
        throw new Error('Key is encrypted but no password provided');
      }
      return this.decryptKey(keyData, this.config.encryptionPassword);
    }

    // Key is stored as hex string
    return Buffer.from(keyData.toString('utf-8').trim(), 'hex');
  }

  /**
   * Export keys for use with the Fiber node process
   * Returns the password to use for FIBER_SECRET_KEY_PASSWORD env var
   */
  getNodeKeyConfig(): { password?: string } {
    return {
      password: this.config.encryptionPassword,
    };
  }

  /**
   * Check if key data is encrypted
   */
  private isEncrypted(data: Buffer): boolean {
    return data.length >= ENCRYPTED_MAGIC.length &&
      data.subarray(0, ENCRYPTED_MAGIC.length).equals(ENCRYPTED_MAGIC);
  }

  /**
   * Encrypt a key using scrypt + AES-256-GCM
   */
  private encryptKey(key: Buffer, password: string): Buffer {
    const salt = randomBytes(SALT_LENGTH);
    const iv = randomBytes(IV_LENGTH);

    // Derive encryption key using scrypt
    const derivedKey = scryptSync(password, salt, KEY_LENGTH, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
    });

    // Encrypt using AES-256-GCM
    const cipher = createCipheriv('aes-256-gcm', derivedKey, iv);
    const encrypted = Buffer.concat([cipher.update(key), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Format: MAGIC | salt | iv | authTag | encrypted
    return Buffer.concat([ENCRYPTED_MAGIC, salt, iv, authTag, encrypted]);
  }

  /**
   * Decrypt a key
   */
  private decryptKey(data: Buffer, password: string): Buffer {
    // Parse encrypted format
    let offset = ENCRYPTED_MAGIC.length;
    const salt = data.subarray(offset, offset + SALT_LENGTH);
    offset += SALT_LENGTH;
    const iv = data.subarray(offset, offset + IV_LENGTH);
    offset += IV_LENGTH;
    const authTag = data.subarray(offset, offset + AUTH_TAG_LENGTH);
    offset += AUTH_TAG_LENGTH;
    const encrypted = data.subarray(offset);

    // Derive key using scrypt
    const derivedKey = scryptSync(password, salt, KEY_LENGTH, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
    });

    // Decrypt using AES-256-GCM
    const decipher = createDecipheriv('aes-256-gcm', derivedKey, iv);
    decipher.setAuthTag(authTag);
    
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  }

  /**
   * Derive public key from private key (secp256k1)
   * This is a simplified version - in production, use a proper secp256k1 library
   */
  private derivePublicKey(privateKey: Buffer): HexString {
    // For now, return a placeholder - actual implementation would use
    // @noble/secp256k1 or similar library
    // The actual public key derivation requires elliptic curve math
    const hash = require('crypto').createHash('sha256').update(privateKey).digest();
    return `0x${hash.toString('hex')}` as HexString;
  }
}

/**
 * Create a key manager with environment-based configuration
 */
export function createKeyManager(
  baseDir: string,
  options?: Partial<KeyConfig>
): KeyManager {
  const password = process.env.FIBER_KEY_PASSWORD || options?.encryptionPassword;

  return new KeyManager({
    baseDir,
    encryptionPassword: password,
    autoGenerate: options?.autoGenerate ?? true,
  });
}
