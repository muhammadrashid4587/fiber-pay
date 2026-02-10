/**
 * Utility Functions
 * Common utilities for hex conversion, CKB amount calculation, and random generation
 */

import type { HexString } from './types/index.js';

/**
 * Convert number to hex string
 */
export function toHex(value: number | bigint): HexString {
  return `0x${value.toString(16)}`;
}

/**
 * Convert hex string to bigint
 */
export function fromHex(hex: HexString): bigint {
  return BigInt(hex);
}

/**
 * Convert CKB amount (in CKB units) to shannons (hex)
 */
export function ckbToShannons(ckb: number | string): HexString {
  const amount = typeof ckb === 'string' ? parseFloat(ckb) : ckb;
  const shannons = BigInt(Math.floor(amount * 1e8));
  return toHex(shannons);
}

/**
 * Convert shannons (hex) to CKB amount
 */
export function shannonsToCkb(shannons: HexString): number {
  return Number(fromHex(shannons)) / 1e8;
}

/**
 * Generate a random 32-byte hex string (for payment preimage)
 */
export function randomBytes32(): HexString {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}`;
}
