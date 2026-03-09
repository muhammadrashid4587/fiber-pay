// Mock for @biscuit-auth/biscuit-wasm
export class Biscuit {
  static fromBase64(_token: string) {
    return {
      verify: vi.fn(),
      authority: vi.fn(() => ({
        facts: vi.fn(() => []),
      })),
    };
  }

  static builder(_keyPair: unknown) {
    return {
      addAuthorityFact: vi.fn(),
      addAuthorityCheck: vi.fn(),
      build: vi.fn(() => ({
        toBase64: vi.fn(() => 'mock-biscuit-token'),
      })),
    };
  }

  verify(_publicKey: unknown) {
    return true;
  }

  authority() {
    return {
      facts: () => [],
    };
  }
}

export class PublicKey {
  static fromBytes(_bytes: Uint8Array) {
    return {};
  }
}

export class PrivateKey {
  static fromBytes(_bytes: Uint8Array) {
    return {};
  }
}

export class KeyPair {
  constructor(_publicKey: unknown, _privateKey: unknown) {}
}

export class Fact {
  static fromString(_fact: string) {
    return {};
  }

  toString() {
    return '';
  }
}

export class Check {
  static fromString(_check: string) {
    return {};
  }
}

export class Authorizer {
  addToken(_token: unknown) {
    return this;
  }

  addFact(_fact: unknown) {
    return this;
  }

  addCheck(_check: unknown) {
    return this;
  }

  authorize() {
    return { policies: [] };
  }
}

export class AuthorizerBuilder {
  build() {
    return new Authorizer();
  }
}

// Import vi for mocking
import { vi } from 'vitest';
