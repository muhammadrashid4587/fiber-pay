# TUI Dashboard Package Plan

Real-time terminal dashboard for monitoring Fiber node state, channels, invoices, payments, jobs, and alerts.

## Overview

Create a new `packages/tui` package using **Ink** (React for CLI) that renders a real-time dashboard with 6 panels. It connects to the runtime's existing WebSocket alert backend for push events and polls the HTTP proxy (`/monitor/*`, `/jobs/*`) for snapshot data. A new `fiber-pay tui` CLI command launches it, reusing the existing `CliConfig` resolution.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  fiber-pay tui                                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Ink (React for CLI)                                  │  │
│  │  ┌─────────────────────┐ ┌──────────────────────────┐ │  │
│  │  │  NodeStatus         │ │  AlertFeed (scrolling)   │ │  │
│  │  ├─────────────────────┤ ├──────────────────────────┤ │  │
│  │  │  ChannelList        │ │  InvoiceTracker          │ │  │
│  │  │                     │ │  PaymentTracker          │ │  │
│  │  ├─────────────────────┴─┴──────────────────────────┤ │  │
│  │  │  JobDashboard                                    │ │  │
│  │  └──────────────────────────────────────────────────┘ │  │
│  └───────────────────────────────────────────────────────┘  │
│            │ poll (HTTP)              │ push (WebSocket)     │
│            ▼                         ▼                      │
│  ┌──────────────────┐    ┌─────────────────────┐            │
│  │ Runtime HTTP Proxy│    │ Runtime WS Alerts   │            │
│  │ :8229 /monitor/* │    │ (broadcast frames)  │            │
│  │       /jobs/*    │    │                     │            │
│  └──────────────────┘    └─────────────────────┘            │
└─────────────────────────────────────────────────────────────┘
```

**Data flow:**
- **HTTP polling** (default 3s interval): Initial state snapshots + periodic refresh for node info, channels, invoices, payments, jobs
- **WebSocket alerts** (real-time push): State change events broadcast by runtime's `WebsocketAlertBackend` — triggers immediate UI updates between poll cycles

## Steps

### 1. Create `packages/tui` package scaffold

- `packages/tui/package.json` with dependencies:
  - `ink` (v5) — React-based terminal UI framework
  - `react` (v18) — Required by Ink
  - `ink-table` — Table rendering for channel/invoice/payment/job lists
  - `ink-spinner` — Loading indicators
  - `ws` — WebSocket client for alert subscription
  - `@fiber-pay/sdk` — Types only (`Channel`, `NodeInfo`, `PeerInfo`, etc.)
  - `@fiber-pay/runtime` — Types only (`Alert`, `AlertType`, `RuntimeJob`, etc.)
- `packages/tui/tsconfig.json` extending `../../tsconfig.base.json`, adding `"jsx": "react-jsx"` for JSX support
- `packages/tui/tsup.config.ts` — single entry point, ESM, `node20` target, matching existing convention

### 2. Build a runtime HTTP client

Create `packages/tui/src/client/http-client.ts` — a lightweight `fetch`-based client for the runtime proxy endpoints.

**Methods:**

| Method | Endpoint | Returns |
|--------|----------|---------|
| `getStatus()` | `GET /monitor/status` | `RpcMonitorProxyStatus` |
| `getNodeInfo()` | `POST /` (proxied RPC `get_node_info`) | `NodeInfo` |
| `listChannels()` | `POST /` (proxied RPC `list_channels`) | `Channel[]` |
| `listPeers()` | `POST /` (proxied RPC `list_peers`) | `PeerInfo[]` |
| `listTrackedInvoices()` | `GET /monitor/list_tracked_invoices` | `TrackedInvoiceState[]` |
| `listTrackedPayments()` | `GET /monitor/list_tracked_payments` | `TrackedPaymentState[]` |
| `listAlerts(filter?)` | `GET /monitor/list_alerts?limit=&type=&min_priority=` | `Alert[]` |
| `listJobs(filter?)` | `GET /jobs?state=&type=&limit=` | `RuntimeJob[]` |
| `getJob(id)` | `GET /jobs/:id` | `RuntimeJob` |

Base URL derived from `runtimeProxyListen` config (default `http://127.0.0.1:8229`).

**Note:** No existing SDK client for the proxy exists (`@fiber-pay/sdk` only has server-side `CorsProxy`). Consider extracting to SDK later if reuse demand grows.

### 3. Build a WebSocket alert subscriber

Create `packages/tui/src/client/ws-client.ts`:

- Connects to runtime's WebSocket alert backend using `ws` npm package
- Parses incoming JSON text frames as `Alert<T>` (from `@fiber-pay/runtime` types)
- Exposes callback interface: `onAlert(cb: (alert: Alert) => void)`
- Auto-reconnect on disconnect with exponential backoff (1s → 2s → 4s → ... → 30s cap)
- Connection states: `connecting`, `connected`, `reconnecting`, `disconnected`
- The WS port/host is configurable via `--ws-url` flag (runtime's `alertBackends.websocket.port` varies)

**Runtime WebSocket details:**
- Protocol: Raw RFC 6455 over bare `node:http` (no `ws` lib on server)
- Authentication: None (any valid WS handshake accepted)
- Messages: JSON text frames, each a single `Alert` object
- Direction: Broadcast-only (server → client)

### 4. Create shared state hooks

React hooks in `packages/tui/src/hooks/`:

| Hook | Source | Returns |
|------|--------|---------|
| `usePolling(fn, intervalMs)` | Generic | `{ data, loading, error, refresh }` |
| `useAlerts(wsClient)` | WebSocket | `{ alerts: Alert[], connected: boolean }` — ring buffer (200 cap) |
| `useNodeInfo(client, interval)` | HTTP polling | `{ node: NodeInfo, online: boolean, loading }` |
| `useChannels(client, interval)` | HTTP polling | `{ channels: Channel[], loading }` |
| `useInvoices(client, interval)` | HTTP polling | `{ invoices: TrackedInvoiceState[], loading }` |
| `usePayments(client, interval)` | HTTP polling | `{ payments: TrackedPaymentState[], loading }` |
| `useJobs(client, interval)` | HTTP polling | `{ jobs: RuntimeJob[], loading }` |

Alert events can trigger immediate poll refresh (e.g., `channel_state_changed` → refresh channels).

### 5. Build Ink components (6 panels)

All in `packages/tui/src/components/`:

#### `NodeStatus.tsx`
- Node version, node_id (truncated), address count, channel count, peer count, UDT config
- Green/red indicator for online/offline (from health alerts or status endpoint)
- Compact single-row layout at top of dashboard

#### `ChannelList.tsx`
- Table columns: ID (short), Peer (short), State, Local Balance, Remote Balance, Pending TLCs, Enabled
- Color-coded state: `ChannelReady` = green, `ShuttingDown` = yellow, `Closed` = gray, `NegotiatingFunding` = cyan
- Highlight rows on recent `channel_state_changed` alerts

#### `InvoiceTracker.tsx`
- Table columns: Payment Hash (short), Status, Tracked At, Updated At
- Color-coded status: Open = white, Received = cyan, Paid = green, Expired = yellow, Cancelled = red

#### `PaymentTracker.tsx`
- Table columns: Payment Hash (short), Status, Tracked At, Updated At
- Color-coded status: Created = white, Inflight = cyan, Success = green, Failed = red

#### `JobDashboard.tsx`
- Summary bar: queued / executing / succeeded / failed counts
- Table columns: ID, Type, State, Retry Count, Created At, Error (truncated)
- Color-coded state: queued = white, executing = cyan, succeeded = green, failed = red, cancelled = gray

#### `AlertFeed.tsx`
- Scrolling log of latest alerts (most recent at bottom)
- Format: `[HH:MM:SS] [PRIORITY] type: summary`
- Priority coloring: critical = red bold, high = red, medium = yellow, low = dim
- Max ~20 visible lines, scrollable with `j`/`k` when focused

### 6. Build main dashboard layout

`packages/tui/src/App.tsx`:

```
┌──────────────────────────────── Node Status ────────────────────────────────┐
│ v0.6.1 │ node_id: abc...xyz │ 3 channels │ 2 peers │ ● Online             │
├──────────────────────────────┬──────────────────────────────────────────────┤
│       Channel List (60%)     │     Invoice Tracker (40%)                   │
│                              │     Payment Tracker                         │
├──────────────────────────────┴──────────────────────────────────────────────┤
│  Job Dashboard (50%)                │  Alert Feed (50%)                    │
└─────────────────────────────────────┴──────────────────────────────────────┘
```

**Keyboard shortcuts:**
- `Tab` — cycle focus between panels
- `q` — quit
- `r` — force refresh all panels
- `j`/`k` — scroll in focused panel
- `1`-`6` — jump to panel by number

`packages/tui/src/index.ts` — exports `renderDashboard(config)` function that calls Ink's `render(<App />)`.

### 7. TUI config

`packages/tui/src/config.ts`:

```typescript
interface TuiConfig {
  proxyUrl: string;        // from runtimeProxyListen, default http://127.0.0.1:8229
  wsUrl?: string;          // WebSocket alert endpoint (optional)
  pollInterval: number;    // default 3000ms
  alertBufferSize: number; // default 200
}
```

Provide `resolveTuiConfig(cliConfig: CliConfig, overrides?)` helper.

### 8. Add `tui` command to CLI

Create `packages/cli/src/commands/tui.ts` following the `createXxxCommand(config): Command` pattern:

```
fiber-pay tui [options]

Options:
  --poll-interval <seconds>   Polling interval for HTTP data (default: 3)
  --ws-url <url>              WebSocket alert endpoint URL (optional)
  --no-alerts                 Disable WebSocket alert feed (poll-only mode)
```

Register in `packages/cli/src/index.ts`:

```typescript
program.addCommand(createTuiCommand(config));
```

Add `@fiber-pay/tui` dependency to `packages/cli/package.json`.

### 9. Update monorepo configuration

- `pnpm-workspace.yaml` already covers `packages/*` — no change needed
- Add build scripts to `packages/tui/package.json`: `"build": "tsup"`, `"dev": "tsup --watch"`

### 10. (Follow-up) Extract proxy HTTP client to SDK

If the HTTP client proves useful beyond TUI, extract to `packages/sdk/src/proxy/runtime-client.ts` and re-export from `@fiber-pay/sdk`. Not blocking for v1.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| TUI library | **Ink v5** (React for CLI) | Best TypeScript support, active maintenance, React component model fits complex multi-panel layouts. `blessed-contrib` has richer built-in widgets but is effectively unmaintained. |
| Data source | **WebSocket + HTTP polling** | Decouples TUI from runtime lifecycle. Runtime is typically a separate long-running process; embedding `FiberMonitorService` would duplicate work and couple lifecycles. |
| WebSocket client | **`ws` npm package** | Runtime's WS server uses bare `node:http`, but `ws` on client side is standard, well-typed, handles reconnection edge cases. |
| Package location | **New `packages/tui`** | Ink + React add ~2MB of dependencies that shouldn't bloat the base CLI. Separate package keeps CLI lean, allows TUI to be used programmatically. |
| Poll interval | **3s default** | Balances UI responsiveness with RPC load. WebSocket alerts provide instant updates for state changes; polling fills gaps (initial load, job snapshots). |

## Verification

```bash
# Workspace installs correctly
pnpm install

# TUI package builds (JSX/TSX compilation)
pnpm --filter @fiber-pay/tui build

# CLI builds with TUI dependency
pnpm --filter @fiber-pay/cli build

# Biome passes
pnpm check

# Manual: start runtime, then open TUI
fiber-pay runtime start --daemon
fiber-pay tui
fiber-pay tui --ws-url ws://127.0.0.1:<port>

# Manual: verify graceful degradation without runtime
fiber-pay tui  # should show "Connecting..." state, not crash
```

## State entities the TUI will render

| Entity | Source Type | Key Fields |
|--------|-----------|------------|
| Node | `NodeInfo` | version, node_id, addresses, channel_count, peers_count |
| Channel | `Channel` | channel_id, peer_id, state, local_balance, remote_balance, pending_tlcs, enabled |
| Channel State | `ChannelState` | NegotiatingFunding → CollaboratingFundingTx → ... → ChannelReady → ShuttingDown → Closed |
| Invoice | `TrackedInvoiceState` | paymentHash, status (Open/Received/Paid/Expired/Cancelled), trackedAt, updatedAt |
| Payment | `TrackedPaymentState` | paymentHash, status (Created/Inflight/Success/Failed), trackedAt, updatedAt |
| Job | `RuntimeJob` | id, type (payment/invoice/channel), state, retryCount, createdAt, error |
| Alert | `Alert` | id, type (28 variants), priority, timestamp, source, data |

## Alert types driving TUI updates

- **Channel:** `channel_state_changed`, `new_inbound_channel_request`, `channel_became_ready`, `channel_closing`, `channel_balance_changed`, `new_pending_tlc`
- **Payment:** `incoming_payment_received`, `outgoing_payment_completed`, `outgoing_payment_failed`, `invoice_expired`, `invoice_cancelled`
- **Peer/Node:** `peer_connected`, `peer_disconnected`, `node_offline`, `node_online`
- **Jobs (×3 types × 4 states):** `*_job_started`, `*_job_retrying`, `*_job_succeeded`, `*_job_failed`
