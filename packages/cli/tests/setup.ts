// tests/setup.ts - Setup file for vitest
import { vi } from 'vitest';

// Mock @biscuit-auth/biscuit-wasm before any tests run
vi.mock('@biscuit-auth/biscuit-wasm', () => ({
  Biscuit: {
    fromBase64: vi.fn(),
    builder: vi.fn(() => ({
      addAuthorityFact: vi.fn(),
      addAuthorityCheck: vi.fn(),
      build: vi.fn(() => ({
        toBase64: vi.fn(() => 'mock-biscuit-token'),
      })),
    })),
  },
  PublicKey: {
    fromBytes: vi.fn(),
  },
  PrivateKey: {
    fromBytes: vi.fn(),
  },
  KeyPair: vi.fn(),
  Fact: {
    fromString: vi.fn(),
  },
  Check: {
    fromString: vi.fn(),
  },
  Authorizer: vi.fn(),
  AuthorizerBuilder: vi.fn(),
}));
