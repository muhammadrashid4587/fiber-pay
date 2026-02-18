import { describe, expect, it } from 'vitest';
import { runChannelJob } from '../src/jobs/executors/channel-executor.js';
import { defaultPaymentRetryPolicy } from '../src/jobs/retry-policy.js';
import type { FiberRpcClient } from '@fiber-pay/sdk';
import type { ChannelJob } from '../src/jobs/types.js';

function baseJob(overrides: Partial<ChannelJob> = {}): ChannelJob {
  return {
    id: 'ch-job-1',
    type: 'channel',
    state: 'queued',
    params: {
      action: 'open',
      openChannelParams: { peer_id: 'peer-1', funding_amount: '0x64' },
      waitForReady: true,
      pollIntervalMs: 1,
    },
    retryCount: 0,
    maxRetries: 0,
    idempotencyKey: 'ch-key-1',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('runChannelJob', () => {
  it('opens channel and succeeds once channel ready is observed', async () => {
    const rpc = {
      openChannel: async () => ({ temporary_channel_id: '0xtmp' }),
      listChannels: async () => ({
        channels: [
          {
            channel_id: '0xchan1',
            is_public: false,
            channel_outpoint: null,
            peer_id: 'peer-1',
            funding_udt_type_script: null,
            state: { state_name: 'CHANNEL_READY' },
            local_balance: '0x0',
            offered_tlc_balance: '0x0',
            remote_balance: '0x0',
            received_tlc_balance: '0x0',
            pending_tlcs: [],
            latest_commitment_transaction_hash: null,
            created_at: '0x0',
            enabled: true,
            tlc_expiry_delta: '0x0',
            tlc_fee_proportional_millionths: '0x0',
            shutdown_transaction_hash: null,
          },
        ],
      }),
    } as unknown as FiberRpcClient;

    const states: string[] = [];
    for await (const updated of runChannelJob(baseJob(), rpc, defaultPaymentRetryPolicy, new AbortController().signal)) {
      states.push(updated.state);
    }

    expect(states).toContain('channel_opening');
    expect(states).toContain('channel_ready');
    expect(states[states.length - 1]).toBe('succeeded');
  });
});
