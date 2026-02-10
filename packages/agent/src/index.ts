/**
 * @fiber-pay/agent
 * AI agent orchestration layer for Fiber Network with MCP tools
 * 
 * @packageDocumentation
 */

// Main agent interface
export { FiberPay, createFiberPay } from './fiber-pay.js';
export type {
  FiberPayConfig,
  AgentResult,
  BalanceInfo,
  PaymentResult,
  InvoiceResult,
  ChannelSummary,
} from './fiber-pay.js';

// MCP tool definitions
export { MCP_TOOLS } from './mcp-tools.js';
export type { McpToolName, McpToolInput, McpToolResult } from './mcp-tools.js';
