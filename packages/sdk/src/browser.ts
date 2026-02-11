/**
 * @fiber-pay/sdk/browser
 * Browser-safe subset of the Fiber Pay SDK.
 * Excludes Node.js-dependent modules (KeyManager, CorsProxy, PaymentProofManager, InvoiceVerifier).
 *
 * @packageDocumentation
 */

// RPC client (uses fetch — browser-compatible)
export { FiberRpcClient, FiberRpcError } from './rpc/index.js';

// Utility functions (pure JS — browser-compatible)
export { toHex, fromHex, ckbToShannons, shannonsToCkb, randomBytes32 } from './utils.js';

// Address encoding (pure JS — browser-compatible)
export { scriptToAddress } from './address.js';
export type { Script } from './address.js';

// Types — all types are compile-time only, always safe
export type * from './types/index.js';
