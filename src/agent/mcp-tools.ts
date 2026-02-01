/**
 * MCP (Model Context Protocol) Tool Definitions
 * These schemas are compatible with Claude, OpenClaw, and other MCP agents
 */

import type { AgentResult, BalanceInfo, PaymentResult, InvoiceResult, ChannelSummary } from './fiber-pay.js';

// =============================================================================
// MCP Tool Schema Definitions
// =============================================================================

/**
 * Tool definitions for MCP integration
 * Each tool has:
 * - name: unique identifier
 * - description: what the tool does (shown to the LLM)
 * - inputSchema: JSON Schema for parameters
 */
export const MCP_TOOLS = {
  fiber_pay: {
    name: 'fiber_pay',
    description: `Pay an invoice or send CKB directly to a node on the Lightning Network.
    
Examples:
- Pay an invoice: fiber_pay({ invoice: "fibt1..." })
- Send directly: fiber_pay({ recipientNodeId: "QmXXX...", amountCkb: 10 })

Returns payment status and tracking hash.`,
    inputSchema: {
      type: 'object',
      properties: {
        invoice: {
          type: 'string',
          description: 'Lightning invoice string to pay (starts with fibt or fibb)',
        },
        recipientNodeId: {
          type: 'string',
          description: 'Recipient node ID for direct payment (keysend)',
        },
        amountCkb: {
          type: 'number',
          description: 'Amount to send in CKB (required for keysend)',
        },
        maxFeeCkb: {
          type: 'number',
          description: 'Maximum fee willing to pay in CKB',
        },
      },
      oneOf: [
        { required: ['invoice'] },
        { required: ['recipientNodeId', 'amountCkb'] },
      ],
    },
  },

  fiber_create_invoice: {
    name: 'fiber_create_invoice',
    description: `Create an invoice to receive payment.
    
Example: fiber_create_invoice({ amountCkb: 10, description: "For coffee" })

Returns invoice string to share with payer.`,
    inputSchema: {
      type: 'object',
      properties: {
        amountCkb: {
          type: 'number',
          description: 'Amount to receive in CKB',
        },
        description: {
          type: 'string',
          description: 'Description for the payer',
        },
        expiryMinutes: {
          type: 'number',
          description: 'Invoice expiry time in minutes (default: 60)',
        },
      },
      required: ['amountCkb'],
    },
  },

  fiber_get_balance: {
    name: 'fiber_get_balance',
    description: `Get current balance information including:
- Total balance in CKB
- Available to send
- Available to receive
- Number of channels
- Remaining spending allowance

No parameters required.`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  fiber_get_payment_status: {
    name: 'fiber_get_payment_status',
    description: `Check the status of a payment by its hash.
    
Example: fiber_get_payment_status({ paymentHash: "0x..." })`,
    inputSchema: {
      type: 'object',
      properties: {
        paymentHash: {
          type: 'string',
          description: 'Payment hash to check',
        },
      },
      required: ['paymentHash'],
    },
  },

  fiber_get_invoice_status: {
    name: 'fiber_get_invoice_status',
    description: `Check the status of an invoice (whether it's been paid).
    
Example: fiber_get_invoice_status({ paymentHash: "0x..." })`,
    inputSchema: {
      type: 'object',
      properties: {
        paymentHash: {
          type: 'string',
          description: 'Payment hash of the invoice',
        },
      },
      required: ['paymentHash'],
    },
  },

  fiber_list_channels: {
    name: 'fiber_list_channels',
    description: `List all payment channels with their balances and states.

No parameters required.`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  fiber_open_channel: {
    name: 'fiber_open_channel',
    description: `Open a new payment channel with a peer.
    
Example: fiber_open_channel({ 
  peer: "/ip4/x.x.x.x/tcp/8228/p2p/QmXXX...", 
  fundingCkb: 100 
})

Note: This requires on-chain CKB for funding.`,
    inputSchema: {
      type: 'object',
      properties: {
        peer: {
          type: 'string',
          description: 'Peer multiaddr or node ID',
        },
        fundingCkb: {
          type: 'number',
          description: 'Amount of CKB to fund the channel',
        },
        isPublic: {
          type: 'boolean',
          description: 'Whether to make the channel public (default: true)',
        },
      },
      required: ['peer', 'fundingCkb'],
    },
  },

  fiber_close_channel: {
    name: 'fiber_close_channel',
    description: `Close a payment channel and settle funds on-chain.
    
Example: fiber_close_channel({ channelId: "0x..." })

Use force: true only if peer is unresponsive.`,
    inputSchema: {
      type: 'object',
      properties: {
        channelId: {
          type: 'string',
          description: 'Channel ID to close',
        },
        force: {
          type: 'boolean',
          description: 'Force close (unilateral, use only if peer unresponsive)',
        },
      },
      required: ['channelId'],
    },
  },

  fiber_get_node_info: {
    name: 'fiber_get_node_info',
    description: `Get information about this node including node ID, public key, and statistics.

No parameters required.`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  fiber_get_spending_allowance: {
    name: 'fiber_get_spending_allowance',
    description: `Get remaining spending allowance based on security policy.

Returns:
- Per-transaction limit in CKB
- Remaining allowance for current time window

No parameters required.`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  fiber_download_binary: {
    name: 'fiber_download_binary',
    description: `Download and install the Fiber Network Node (fnn) binary for the current platform.

This is required before using any Fiber payment features. The binary will be automatically 
downloaded from GitHub releases and installed to the data directory.

Examples:
- Download latest: fiber_download_binary({})
- Download specific version: fiber_download_binary({ version: "v0.4.0" })
- Force re-download: fiber_download_binary({ force: true })

Returns the path to the installed binary.`,
    inputSchema: {
      type: 'object',
      properties: {
        version: {
          type: 'string',
          description: 'Specific version to download (e.g., "v0.4.0"). Defaults to latest.',
        },
        force: {
          type: 'boolean',
          description: 'Force re-download even if binary already exists',
        },
      },
    },
  },
} as const;

// =============================================================================
// Type Helpers
// =============================================================================

export type McpToolName = keyof typeof MCP_TOOLS;

export type McpToolInput<T extends McpToolName> = T extends 'fiber_pay'
  ? { invoice?: string; recipientNodeId?: string; amountCkb?: number; maxFeeCkb?: number }
  : T extends 'fiber_create_invoice'
  ? { amountCkb: number; description?: string; expiryMinutes?: number }
  : T extends 'fiber_get_balance'
  ? {}
  : T extends 'fiber_get_payment_status'
  ? { paymentHash: string }
  : T extends 'fiber_get_invoice_status'
  ? { paymentHash: string }
  : T extends 'fiber_list_channels'
  ? {}
  : T extends 'fiber_open_channel'
  ? { peer: string; fundingCkb: number; isPublic?: boolean }
  : T extends 'fiber_close_channel'
  ? { channelId: string; force?: boolean }
  : T extends 'fiber_get_node_info'
  ? {}
  : T extends 'fiber_get_spending_allowance'
  ? {}
  : T extends 'fiber_download_binary'
  ? { version?: string; force?: boolean }
  : never;

export type McpToolResult<T extends McpToolName> = T extends 'fiber_pay'
  ? AgentResult<PaymentResult>
  : T extends 'fiber_create_invoice'
  ? AgentResult<InvoiceResult>
  : T extends 'fiber_get_balance'
  ? AgentResult<BalanceInfo>
  : T extends 'fiber_get_payment_status'
  ? AgentResult<PaymentResult>
  : T extends 'fiber_get_invoice_status'
  ? AgentResult<InvoiceResult>
  : T extends 'fiber_list_channels'
  ? AgentResult<ChannelSummary[]>
  : T extends 'fiber_open_channel'
  ? AgentResult<{ channelId: string }>
  : T extends 'fiber_close_channel'
  ? AgentResult<void>
  : T extends 'fiber_get_node_info'
  ? AgentResult<{ nodeId: string; publicKey: string; version: string; channelCount: number; peersCount: number }>
  : T extends 'fiber_get_spending_allowance'
  ? { perTransactionCkb: number; perWindowCkb: number }
  : T extends 'fiber_download_binary'
  ? AgentResult<{ path: string; version: string; platform: string; arch: string }>
  : never;
