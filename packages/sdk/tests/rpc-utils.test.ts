import { describe, it, expect } from 'vitest';
import { toHex, fromHex, ckbToShannons, shannonsToCkb, randomBytes32 } from '@fiber-pay/sdk';

describe('RPC Utilities', () => {
  describe('toHex', () => {
    it('should convert number to hex', () => {
      expect(toHex(255)).toBe('0xff');
      expect(toHex(0)).toBe('0x0');
      expect(toHex(100000000)).toBe('0x5f5e100');
    });

    it('should convert bigint to hex', () => {
      expect(toHex(BigInt('100000000000'))).toBe('0x174876e800');
    });
  });

  describe('fromHex', () => {
    it('should convert hex to bigint', () => {
      expect(fromHex('0xff')).toBe(255n);
      expect(fromHex('0x0')).toBe(0n);
      expect(fromHex('0x5f5e100')).toBe(100000000n);
    });
  });

  describe('ckbToShannons', () => {
    it('should convert CKB to shannons hex', () => {
      expect(ckbToShannons(1)).toBe('0x5f5e100'); // 1 CKB = 100,000,000 shannons
      expect(ckbToShannons(10)).toBe('0x3b9aca00');
      expect(ckbToShannons(0.5)).toBe('0x2faf080');
    });

    it('should handle string input', () => {
      expect(ckbToShannons('1')).toBe('0x5f5e100');
      expect(ckbToShannons('100.5')).toBe('0x25706d480'); // 100.5 CKB = 10,050,000,000 shannons
    });
  });

  describe('shannonsToCkb', () => {
    it('should convert shannons hex to CKB', () => {
      expect(shannonsToCkb('0x5f5e100')).toBe(1);
      expect(shannonsToCkb('0x3b9aca00')).toBe(10);
    });
  });

  describe('randomBytes32', () => {
    it('should generate valid 32-byte hex string', () => {
      const result = randomBytes32();
      
      expect(result).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it('should generate unique values', () => {
      const values = new Set<string>();
      for (let i = 0; i < 100; i++) {
        values.add(randomBytes32());
      }
      expect(values.size).toBe(100);
    });
  });
});
