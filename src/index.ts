/**
 * fiber-pay
 * AI Agent Payment SDK for CKB Lightning Network (Fiber Network)
 * 
 * @packageDocumentation
 */

// Main agent interface
export { FiberPay, createFiberPay } from './agent/index.js';
export type {
  FiberPayConfig,
  AgentResult,
  BalanceInfo,
  PaymentResult,
  InvoiceResult,
  ChannelSummary,
} from './agent/index.js';

// MCP tool definitions
export { MCP_TOOLS } from './agent/index.js';
export type { McpToolName, McpToolInput, McpToolResult } from './agent/index.js';

// Binary management
export {
  BinaryManager,
  downloadFiberBinary,
  getFiberBinaryInfo,
  ensureFiberBinary,
  getDefaultBinaryPath,
} from './binary/index.js';
export type {
  BinaryInfo,
  DownloadOptions,
  DownloadProgress,
} from './binary/index.js';

// RPC client (for advanced usage)
export { FiberRpcClient, FiberRpcError } from './rpc/index.js';
export { toHex, fromHex, ckbToShannons, shannonsToCkb, randomBytes32 } from './rpc/index.js';

// Security components
export { PolicyEngine } from './security/index.js';
export { KeyManager, createKeyManager } from './security/index.js';

// Process management
export { ProcessManager } from './process/index.js';

// Types
export type * from './types/index.js';
