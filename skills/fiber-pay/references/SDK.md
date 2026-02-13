# fiber-pay SDK reference

Focused reference for `@fiber-pay/sdk` in this repository.

## Table of contents

1. [Primary imports](#primary-imports)
2. [RPC client](#rpc-client)
3. [Polling and watch helpers](#polling-and-watch-helpers)
4. [Core RPC types](#core-rpc-types)
5. [Amount and hex helpers](#amount-and-hex-helpers)
6. [Address utility](#address-utility)
7. [Verification helpers](#verification-helpers)
8. [Security helpers](#security-helpers)

## Primary imports

```ts
import {
  FiberRpcClient,
  FiberRpcError,
  ChannelState,
  ckbToShannons,
  shannonsToCkb,
  InvoiceVerifier,
  PaymentProofManager,
  PolicyEngine,
  KeyManager,
} from '@fiber-pay/sdk';
```

## RPC client

Source: `packages/sdk/src/rpc/client.ts`

### Construct client

```ts
const client = new FiberRpcClient({
  url: 'http://127.0.0.1:8227',
  timeout: 30000,
});
```

`RpcClientConfig` fields:

- `url` (required)
- `timeout` (optional)
- `headers` (optional)
- `biscuitToken` (optional)

### Low-level JSON-RPC

```ts
await client.call<TResult>('method_name', [params]);
```

### Peer methods

- `connectPeer(params: ConnectPeerParams)`
- `disconnectPeer(params: DisconnectPeerParams)`
- `listPeers()`

### Channel methods

- `openChannel(params: OpenChannelParams)`
- `acceptChannel(params: AcceptChannelParams)`
- `listChannels(params?: ListChannelsParams)`
- `shutdownChannel(params: ShutdownChannelParams)`
- `abandonChannel(params: AbandonChannelParams)`
- `updateChannel(params: UpdateChannelParams)`

### Payment methods

- `sendPayment(params: SendPaymentParams)`
- `getPayment(params: GetPaymentParams)`
- `sendPaymentWithRouter(params: SendPaymentWithRouterParams)`

### Invoice methods

- `newInvoice(params: NewInvoiceParams)`
- `parseInvoice(params: ParseInvoiceParams)`
- `getInvoice(params: GetInvoiceParams)`
- `cancelInvoice(params: CancelInvoiceParams)`
- `settleInvoice(params: SettleInvoiceParams)`

### Router/graph/info methods

- `buildRouter(params: BuildRouterParams)`
- `graphNodes(params?: GraphNodesParams)`
- `graphChannels(params?: GraphChannelsParams)`
- `nodeInfo()`
- `ping()`
- `waitForReady(options?)`

## Polling and watch helpers

All from `FiberRpcClient`:

- `waitForPayment(paymentHash, { timeout?, interval? })`
  - Resolves when status is terminal (`Success` or `Failed`)
- `waitForChannelReady(channelId, { timeout?, interval? })`
  - Resolves when channel reaches `ChannelState.ChannelReady`
- `waitForInvoiceStatus(paymentHash, targetStatus, { timeout?, interval? })`
  - Waits for one or more target invoice statuses
- `watchIncomingPayments({ paymentHashes, onPayment, interval?, signal? })`
  - Calls callback when invoice status transitions to `Received` or `Paid`

Use these helpers instead of hand-rolled polling loops.

## Core RPC types

Source: `packages/sdk/src/types/rpc.ts`

Common aliases:

- `HexString`
- `Hash256`
- `ChannelId`
- `PaymentHash`
- `PeerId`
- `Multiaddr`

Channel related:

- `Channel`
- `ChannelState`
- `ListChannelsParams`
- `ListChannelsResult`

Invoice related:

- `CkbInvoice`
- `CkbInvoiceStatus` (`Open`, `Cancelled`, `Expired`, `Received`, `Paid`)
- `NewInvoiceParams`
- `GetInvoiceResult`

Payment related:

- `PaymentStatus` (`Created`, `Inflight`, `Success`, `Failed`)
- `PaymentInfo`
- `SendPaymentParams`
- `GetPaymentResult`

Node/peer/graph:

- `NodeInfo`
- `PeerInfo`
- `GraphNodeInfo`
- `GraphChannelInfo`

## Amount and hex helpers

Source: `packages/sdk/src/utils.ts`

- `toHex(value: number | bigint): HexString`
- `fromHex(hex: HexString): bigint`
- `ckbToShannons(ckb: number | string): HexString`
- `shannonsToCkb(shannons: HexString): number`
- `randomBytes32(): HexString`

Rule of thumb:

- RPC request/response numeric fields are generally hex shannons
- Convert at API boundaries with `ckbToShannons` / `shannonsToCkb`

## Address utility

Source: `packages/sdk/src/address.ts`

- `scriptToAddress(script, network)`
  - Encodes CKB lock script to bech32m address
  - Network is `'testnet'` or `'mainnet'`

## Verification helpers

### `InvoiceVerifier`

Source: `packages/sdk/src/verification/invoice-verifier.ts`

Primary method:

- `verifyInvoice(invoiceString)`

It performs:

- invoice format checks
- parse/expiry checks
- amount sanity checks
- peer connectivity checks
- recommendation output (`proceed`, `warn`, `reject`)

### `PaymentProofManager`

Source: `packages/sdk/src/verification/payment-proof.ts`

Primary methods:

- `load()` / `save()`
- `recordPaymentProof(...)`
- `getProof(paymentHash)`
- `verifyProof(proof)`
- `getSummary()`
- `exportAuditReport(startTime?, endTime?)`

Important limitation noted in source:

- Sender-side preimage is not always exposed by current Fiber RPC responses
- proof verification may rely on RPC status where preimage is unavailable

## Security helpers

### `PolicyEngine`

Source: `packages/sdk/src/security/policy-engine.ts`

Primary methods:

- `checkPayment({ amount, recipient? })`
- `checkChannelOperation({ operation, fundingAmount?, currentChannelCount? })`
- `recordPayment(amount)`
- `addAuditEntry(action, success, details, violations?)`
- `getAuditLog(options?)`
- `getRemainingAllowance()`

### `KeyManager`

Source: `packages/sdk/src/security/key-manager.ts`

Purpose:

- initialize/generate/load node key files
- support encrypted key handling
- expose node runtime key config via `getNodeKeyConfig()`

Key format constraints:

- `fiber/sk` expects raw 32-byte private key
- `ckb/key` expects hex string key

## Notes for maintainers

When adding new RPC support:

1. add/update types in `packages/sdk/src/types/rpc.ts`
2. add method in `packages/sdk/src/rpc/client.ts`
3. export in `packages/sdk/src/index.ts` if public
4. update this reference if public SDK surface changes
