/**
 * @fiber-pay/sdk
 * Core SDK for building Fiber Network applications on CKB Lightning
 * 
 * @packageDocumentation
 */

// RPC client
export { FiberRpcClient, FiberRpcError } from './rpc/index.js';

// Utility functions
export { toHex, fromHex, ckbToShannons, shannonsToCkb, randomBytes32 } from './utils.js';

// Address encoding
export { scriptToAddress } from './address.js';
export type { Script } from './address.js';

// Security components
export { PolicyEngine } from './security/policy-engine.js';
export { KeyManager, createKeyManager } from './security/key-manager.js';

// Verification
export { InvoiceVerifier } from './verification/invoice-verifier.js';
export type { InvoiceVerificationResult } from './verification/invoice-verifier.js';
export { PaymentProofManager } from './verification/payment-proof.js';
export type { PaymentProof, PaymentProofSummary } from './verification/payment-proof.js';

// Funds management
export { LiquidityAnalyzer } from './funds/liquidity-analyzer.js';
export type { LiquidityReport } from './funds/liquidity-analyzer.js';

// Proxy
export { CorsProxy } from './proxy/cors-proxy.js';

// Types - Re-export all types from types module
export type * from './types/index.js';
