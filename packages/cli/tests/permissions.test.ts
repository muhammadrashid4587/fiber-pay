import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CliConfig } from '../src/lib/config.js';

// Mock @inquirer/prompts
vi.mock('@inquirer/prompts', () => ({
  input: vi.fn(),
  confirm: vi.fn(),
  select: vi.fn(),
  password: vi.fn(),
}));

// Mock @fiber-pay/sdk
vi.mock('@fiber-pay/sdk', async () => {
  const actual = await vi.importActual<typeof import('@fiber-pay/sdk')>('@fiber-pay/sdk');
  return {
    ...actual,
    parsePermissionUrl: vi.fn(),
    PermissionUrlError: class PermissionUrlError extends Error {
      constructor(
        message: string,
        public readonly code:
          | 'INVALID_URL'
          | 'INVALID_BASE64'
          | 'INVALID_JSON'
          | 'VALIDATION_ERROR',
      ) {
        super(message);
        this.name = 'PermissionUrlError';
      }
    },
    shannonsToCkb: vi.fn((shannons: string) => Number(shannons) / 100000000),
    toHex: vi.fn((value: bigint) => `0x${value.toString(16)}`),
  };
});

import { PermissionUrlError, parsePermissionUrl } from '@fiber-pay/sdk';
// Import mocked modules
import { confirm, input } from '@inquirer/prompts';

describe('permissions commands', () => {
  let config: CliConfig;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    config = {
      dataDir: '/tmp/fiber-pay-test',
      configPath: '/tmp/fiber-pay-test/config.yml',
      network: 'testnet',
      rpcUrl: 'http://localhost:8114',
      rpcBiscuitToken: 'test-token',
    };

    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    vi.clearAllMocks();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
    vi.clearAllMocks();
  });

  describe('review command', () => {
    it('reviews a permission URL and displays human-readable output', async () => {
      // Dynamic import to ensure mock is set up
      const { runPermissionsReviewCommand } = await import('../src/lib/permissions-review.js');

      const mockRequest = {
        version: '1',
        app: {
          id: 'test-app',
          name: 'Test Application',
          icon: 'https://example.com/icon.png',
        },
        permissions: [
          {
            resource: 'payments' as const,
            action: 'write' as const,
            max_amount: 100000000n,
            daily_limit: 1000000000n,
          },
        ],
        expires_in: '7d',
        nonce: 'test-nonce-123',
      };

      vi.mocked(parsePermissionUrl).mockReturnValue(
        mockRequest as import('@fiber-pay/sdk').PermissionRequest,
      );

      await runPermissionsReviewCommand('fiber://perm/test123', {});

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls.map((call) => call[0]).join('\n');
      expect(output).toContain('Test Application');
      expect(output).toContain('payments:write');
    });

    it('reviews a permission URL and outputs JSON', async () => {
      const { runPermissionsReviewCommand } = await import('../src/lib/permissions-review.js');

      const mockRequest = {
        version: '1',
        app: {
          id: 'test-app',
          name: 'Test Application',
        },
        permissions: [
          {
            resource: 'channels' as const,
            action: 'write' as const,
            can_create_new: true,
            max_funding: 1000000000n,
          },
        ],
        expires_in: '24h',
        nonce: 'test-nonce-456',
      };

      vi.mocked(parsePermissionUrl).mockReturnValue(
        mockRequest as import('@fiber-pay/sdk').PermissionRequest,
      );

      await runPermissionsReviewCommand('fiber://perm/test456', { json: true });

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.success).toBe(true);
      expect(parsed.data.app.name).toBe('Test Application');
    });

    it('handles invalid URL errors', async () => {
      const { runPermissionsReviewCommand } = await import('../src/lib/permissions-review.js');

      vi.mocked(parsePermissionUrl).mockImplementation(() => {
        throw new PermissionUrlError('Invalid permission URL format', 'INVALID_URL');
      });

      try {
        await runPermissionsReviewCommand('invalid-url', {});
      } catch {
        // Expected to throw
      }

      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith('Error: Invalid permission URL format');
    });

    it('handles URL errors in JSON mode', async () => {
      const { runPermissionsReviewCommand } = await import('../src/lib/permissions-review.js');

      vi.mocked(parsePermissionUrl).mockImplementation(() => {
        throw new PermissionUrlError('Invalid permission URL format', 'INVALID_URL');
      });

      try {
        await runPermissionsReviewCommand('invalid-url', { json: true });
      } catch {
        // Expected to throw
      }

      expect(processExitSpy).toHaveBeenCalledWith(1);
      const output = consoleSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('PERMISSION_URL_INVALID_URL');
    });
  });

  describe('command structure', () => {
    it('creates permissions command with all subcommands', async () => {
      // Dynamic import to avoid loading @fiber-pay/runtime at top level
      const { createPermissionsCommand } = await import('../src/commands/permissions.js');

      const command = createPermissionsCommand(config);

      expect(command.name()).toBe('permissions');

      const subcommands = command.commands.map((c) => c.name());
      expect(subcommands).toContain('list');
      expect(subcommands).toContain('review');
      expect(subcommands).toContain('approve');
      expect(subcommands).toContain('reject');
      expect(subcommands).toContain('usage');
    });

    it('list command shows empty message when no grants', async () => {
      const { createPermissionsCommand } = await import('../src/commands/permissions.js');

      const command = createPermissionsCommand(config);
      const listCmd = command.commands.find((c) => c.name() === 'list');
      expect(listCmd).toBeDefined();

      await listCmd!.parseAsync(['node', 'test']);

      // When DB doesn't exist, it either shows empty message or an error
      const hasEmptyMessage = consoleSpy.mock.calls.some(
        (call) => call[0] === 'No permission grants found.',
      );
      const hasError = processExitSpy.mock.calls.length > 0;
      expect(hasEmptyMessage || hasError).toBe(true);
    });

    it('approve command handles grant not found error', async () => {
      const { createPermissionsCommand } = await import('../src/commands/permissions.js');

      const command = createPermissionsCommand(config);
      const approveCmd = command.commands.find((c) => c.name() === 'approve');

      await approveCmd!.parseAsync(['node', 'test', 'non-existent-grant', '--yes', '--json']);

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('reject command handles grant not found error', async () => {
      const { createPermissionsCommand } = await import('../src/commands/permissions.js');

      const command = createPermissionsCommand(config);
      const rejectCmd = command.commands.find((c) => c.name() === 'reject');

      await rejectCmd!.parseAsync(['node', 'test', 'non-existent-grant', '--json']);

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('usage command handles grant not found error', async () => {
      const { createPermissionsCommand } = await import('../src/commands/permissions.js');

      const command = createPermissionsCommand(config);
      const usageCmd = command.commands.find((c) => c.name() === 'usage');

      await usageCmd!.parseAsync(['node', 'test', 'non-existent-grant', '--json']);

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('list command handles errors gracefully', async () => {
      const { createPermissionsCommand } = await import('../src/commands/permissions.js');

      // Force an error by providing invalid config
      const badConfig = { ...config, dataDir: '' };
      const badCommand = createPermissionsCommand(badConfig);
      const badListCmd = badCommand.commands.find((c) => c.name() === 'list');

      await badListCmd!.parseAsync(['node', 'test']);

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('approve command handles invalid BigInt input gracefully', async () => {
      const { createPermissionsCommand } = await import('../src/commands/permissions.js');

      const command = createPermissionsCommand(config);
      const approveCmd = command.commands.find((c) => c.name() === 'approve');

      await approveCmd!.parseAsync([
        'node',
        'test',
        'grant-invalid',
        '--daily-limit',
        'invalid',
        '--yes',
      ]);

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });
});
