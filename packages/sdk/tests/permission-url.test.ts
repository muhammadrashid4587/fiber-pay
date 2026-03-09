import { describe, expect, it } from 'vitest';
import {
  buildPermissionUrl,
  PermissionUrlError,
  parsePermissionUrl,
} from '../src/security/permission-url.js';
import type { PermissionRequest } from '../src/types/permissions.js';

describe('permission-url', () => {
  describe('buildPermissionUrl', () => {
    it('should build a valid permission URL', () => {
      const request: PermissionRequest = {
        version: '1',
        app: { id: 'test', name: 'Test App' },
        permissions: [{ resource: 'payments', action: 'write' }],
        expires_in: '1d',
        nonce: 'abc123',
      };

      const url = buildPermissionUrl(request);

      expect(url).toMatch(/^fiber:\/\/perm\/[A-Za-z0-9_-]+$/);
    });

    it('should include signature when provided', () => {
      const request: PermissionRequest = {
        version: '1',
        app: { id: 'test', name: 'Test' },
        permissions: [{ resource: 'payments', action: 'write' }],
        expires_in: '1d',
        nonce: 'abc123',
        signature: 'some-signature',
      };

      const url = buildPermissionUrl(request);

      expect(url).toMatch(/^fiber:\/\/perm\/[A-Za-z0-9_-]+$/);
      // Parse and verify signature is included
      const parsed = parsePermissionUrl(url);
      expect(parsed.signature).toBe('some-signature');
    });

    it('should handle bigint fields correctly', () => {
      const request: PermissionRequest = {
        version: '1',
        app: { id: 'test', name: 'Test' },
        permissions: [
          {
            resource: 'payments',
            action: 'write',
            daily_limit: 10000000000n,
            max_amount: 1000000000n,
          },
        ],
        expires_in: '1d',
        nonce: 'abc123',
      };

      const url = buildPermissionUrl(request);
      const parsed = parsePermissionUrl(url);

      expect(parsed.permissions[0]).toMatchObject({
        resource: 'payments',
        action: 'write',
        daily_limit: 10000000000n,
        max_amount: 1000000000n,
      });
    });

    it('should throw on invalid request', () => {
      const invalidRequest = {
        version: '1',
        // Missing required fields
      } as PermissionRequest;

      expect(() => buildPermissionUrl(invalidRequest)).toThrow(PermissionUrlError);
    });
  });

  describe('parsePermissionUrl', () => {
    it('should parse valid permission URL', () => {
      const request: PermissionRequest = {
        version: '1',
        app: { id: 'com.example.app', name: 'Example App' },
        permissions: [{ resource: 'payments', action: 'write' }],
        expires_in: '7d',
        nonce: 'uuid-here',
      };

      const url = buildPermissionUrl(request);
      const parsed = parsePermissionUrl(url);

      expect(parsed).toEqual(request);
    });

    it('should throw on invalid URL format', () => {
      expect(() => parsePermissionUrl('https://example.com')).toThrow(PermissionUrlError);
      expect(() => parsePermissionUrl('fiber://other/path')).toThrow(PermissionUrlError);
      expect(() => parsePermissionUrl('fiber://perm/')).toThrow(PermissionUrlError);
    });

    it('should throw on invalid base64', () => {
      // Valid prefix but invalid base64url content
      expect(() => parsePermissionUrl('fiber://perm/!!!')).toThrow(PermissionUrlError);
    });

    it('should throw on invalid JSON', () => {
      // Create a URL with valid base64 but invalid JSON
      const invalidBase64 = Buffer.from('not valid json').toString('base64');
      const base64url = invalidBase64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

      expect(() => parsePermissionUrl(`fiber://perm/${base64url}`)).toThrow(PermissionUrlError);
    });

    it('should throw on validation error', () => {
      // Valid JSON but invalid schema
      const invalidRequest = { foo: 'bar' };
      const json = JSON.stringify(invalidRequest);
      const base64 = Buffer.from(json).toString('base64');
      const base64url = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

      expect(() => parsePermissionUrl(`fiber://perm/${base64url}`)).toThrow(PermissionUrlError);
    });
  });

  describe('round-trip', () => {
    it('should correctly round-trip complex permission requests', () => {
      const request: PermissionRequest = {
        version: '1',
        app: {
          id: 'com.example.app',
          name: 'Example App',
          icon: 'https://example.com/icon.png',
          callback_url: 'https://example.com/callback',
        },
        permissions: [
          {
            resource: 'payments',
            action: 'write',
            daily_limit: 10000000000n,
            max_amount: 1000000000n,
            daily_count_limit: 100,
            hourly_count_limit: 10,
            min_interval_seconds: 60,
            allowed_recipients: ['ckt1...', 'ckt2...'],
          },
          {
            resource: 'channels',
            action: 'write',
            can_create_new: true,
            max_funding: 100000000000n,
            can_close: true,
            can_force_close: false,
          },
          { resource: 'peers', action: 'read' },
        ],
        expires_in: '7d',
        nonce: 'test-nonce-123',
      };

      const url = buildPermissionUrl(request);
      const parsed = parsePermissionUrl(url);

      expect(parsed).toEqual(request);
    });

    it('should handle URL with special characters that need base64url encoding', () => {
      const request: PermissionRequest = {
        version: '1',
        app: { id: 'test-app', name: 'Test App <>?&=' },
        permissions: [{ resource: 'payments', action: 'write' }],
        expires_in: '1d',
        nonce: 'nonce-with-special-chars-<>',
      };

      const url = buildPermissionUrl(request);
      const parsed = parsePermissionUrl(url);

      expect(parsed).toEqual(request);
    });
  });
});
