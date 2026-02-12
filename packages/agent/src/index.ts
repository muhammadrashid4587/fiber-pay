/**
 * @fiber-pay/agent
 * AI agent orchestration layer for Fiber Network with MCP tools
 *
 * @packageDocumentation
 */

export type {
  AgentResult,
  BalanceInfo,
  ChannelSummary,
  FiberPayConfig,
  HoldInvoiceResult,
  InvoiceResult,
  PaymentResult,
} from './fiber-pay.js';
// Main agent interface
export { createFiberPay, FiberPay } from './fiber-pay.js';
export type { McpToolInput, McpToolName, McpToolResult } from './mcp-tools.js';
// MCP tool definitions
export { MCP_TOOLS } from './mcp-tools.js';
