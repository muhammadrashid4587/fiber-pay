import { ChannelState, type FiberRpcClient } from '@fiber-pay/sdk';
import { classifyPaymentError } from '../error-classifier.js';
import { computeRetryDelay, shouldRetry } from '../retry-policy.js';
import type { ChannelJob, RetryPolicy } from '../types.js';

const DEFAULT_POLL_INTERVAL = 2_000;

export async function* runChannelJob(
  job: ChannelJob,
  rpc: FiberRpcClient,
  policy: RetryPolicy,
  signal: AbortSignal,
): AsyncGenerator<ChannelJob> {
  let current = { ...job };
  const resumedFromRetry = job.state === 'waiting_retry';

  if (current.state === 'queued') {
    current = { ...current, state: 'executing', updatedAt: Date.now() };
    yield current;
  }

  if (current.state === 'waiting_retry') {
    current = {
      ...current,
      state: 'executing',
      nextRetryAt: undefined,
      updatedAt: Date.now(),
    };
    yield current;
  }

  try {
    const pollIntervalMs = current.params.pollIntervalMs ?? DEFAULT_POLL_INTERVAL;

    if (current.params.action === 'open') {
      if (!current.params.openChannelParams) {
        throw new Error('Channel open job requires openChannelParams');
      }

      const targetPeerId = current.params.peerId ?? current.params.openChannelParams.peer_id;
      let temporaryChannelId = current.result?.temporaryChannelId;

      if (resumedFromRetry) {
        const existing = await findTargetChannel(rpc, targetPeerId, current.params.channelId);
        if (existing && !isClosed(existing.state.state_name)) {
          current = {
            ...current,
            state: 'channel_opening',
            result: {
              temporaryChannelId,
              channelId: existing.channel_id,
              state: existing.state.state_name,
            },
            updatedAt: Date.now(),
          };
          yield current;
        } else {
          const opened = await rpc.openChannel(current.params.openChannelParams);
          temporaryChannelId = opened.temporary_channel_id;
          current = {
            ...current,
            state: 'channel_opening',
            result: {
              temporaryChannelId,
              state: 'OPENING',
            },
            updatedAt: Date.now(),
          };
          yield current;
        }
      } else {
        const opened = await rpc.openChannel(current.params.openChannelParams);
        temporaryChannelId = opened.temporary_channel_id;
        current = {
          ...current,
          state: 'channel_opening',
          result: {
            temporaryChannelId,
            state: 'OPENING',
          },
          updatedAt: Date.now(),
        };
        yield current;
      }

      if (!current.params.waitForReady) {
        current = {
          ...current,
          state: 'succeeded',
          completedAt: Date.now(),
          updatedAt: Date.now(),
        };
        yield current;
        return;
      }

      while (true) {
        if (signal.aborted) {
          current = { ...current, state: 'cancelled', completedAt: Date.now(), updatedAt: Date.now() };
          yield current;
          return;
        }

        const channels = await rpc.listChannels({
          peer_id: targetPeerId,
          include_closed: true,
        });

        const candidates = channels.channels.filter((channel) => {
          if (current.params.channelId && channel.channel_id !== current.params.channelId) return false;
          return channel.peer_id === targetPeerId;
        });

        const readyMatch = candidates.find((channel) =>
          channel.state.state_name === ChannelState.ChannelReady ||
          channel.state.state_name === 'CHANNEL_READY',
        );

        const activeMatch = candidates.find((channel) => !isClosed(channel.state.state_name));

        const closedMatch =
          current.params.channelId && !activeMatch && candidates.length > 0
            ? candidates.find((channel) => isTerminalClosed(channel.state.state_name))
            : undefined;

        if (readyMatch) {
          current = {
            ...current,
            state: 'channel_ready',
            result: {
              temporaryChannelId,
              channelId: readyMatch.channel_id,
              state: readyMatch.state.state_name,
            },
            updatedAt: Date.now(),
          };
          yield current;

          current = { ...current, state: 'succeeded', completedAt: Date.now(), updatedAt: Date.now() };
          yield current;
          return;
        }

        if (closedMatch) {
          current = {
            ...current,
            state: 'channel_closed',
            result: {
              temporaryChannelId,
              channelId: closedMatch.channel_id,
              state: closedMatch.state.state_name,
            },
            completedAt: Date.now(),
            updatedAt: Date.now(),
          };
          yield current;
          current = { ...current, state: 'failed', completedAt: Date.now(), updatedAt: Date.now() };
          yield current;
          return;
        }

        current = { ...current, state: 'channel_awaiting_ready', updatedAt: Date.now() };
        yield current;
        await sleep(pollIntervalMs, signal);
      }
    }

    if (current.params.action === 'shutdown') {
      if (!current.params.shutdownChannelParams) {
        throw new Error('Channel shutdown job requires shutdownChannelParams');
      }

      await rpc.shutdownChannel(current.params.shutdownChannelParams);
      current = {
        ...current,
        state: 'channel_closing',
        result: {
          channelId: current.params.shutdownChannelParams.channel_id,
          state: 'SHUTTING_DOWN',
        },
        updatedAt: Date.now(),
      };
      yield current;

      if (!current.params.waitForClosed) {
        current = { ...current, state: 'succeeded', completedAt: Date.now(), updatedAt: Date.now() };
        yield current;
        return;
      }

      while (true) {
        if (signal.aborted) {
          current = { ...current, state: 'cancelled', completedAt: Date.now(), updatedAt: Date.now() };
          yield current;
          return;
        }

        const channels = await rpc.listChannels({ include_closed: true });
        const match = channels.channels.find((channel) => channel.channel_id === current.params.shutdownChannelParams?.channel_id);

        if (!match || match.state.state_name === ChannelState.Closed || match.state.state_name === 'CLOSED') {
          current = {
            ...current,
            state: 'channel_closed',
            result: {
              channelId: current.params.shutdownChannelParams.channel_id,
              state: 'CLOSED',
            },
            updatedAt: Date.now(),
          };
          yield current;
          current = { ...current, state: 'succeeded', completedAt: Date.now(), updatedAt: Date.now() };
          yield current;
          return;
        }

        await sleep(pollIntervalMs, signal);
      }
    }

    throw new Error(`Unsupported channel action: ${(current.params as { action?: string }).action}`);
  } catch (error) {
    const classified = classifyPaymentError(error);
    if (shouldRetry(classified, current.retryCount, policy)) {
      const delay = computeRetryDelay(current.retryCount, policy);
      current = {
        ...current,
        state: 'waiting_retry',
        error: classified,
        retryCount: current.retryCount + 1,
        nextRetryAt: Date.now() + delay,
        updatedAt: Date.now(),
      };
      yield current;
      return;
    }

    current = {
      ...current,
      state: 'failed',
      error: classified,
      completedAt: Date.now(),
      updatedAt: Date.now(),
    };
    yield current;
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

async function findTargetChannel(
  rpc: FiberRpcClient,
  peerId: string,
  channelId?: `0x${string}`,
) {
  const channels = await rpc.listChannels({
    peer_id: peerId,
    include_closed: true,
  });

  return channels.channels.find((channel) => {
    if (channelId && channel.channel_id !== channelId) return false;
    return channel.peer_id === peerId;
  });
}

function isClosed(stateName: string): boolean {
  return (
    stateName === ChannelState.Closed ||
    stateName === 'CLOSED' ||
    stateName === ChannelState.ShuttingDown ||
    stateName === 'SHUTTING_DOWN'
  );
}

function isTerminalClosed(stateName: string): boolean {
  return stateName === ChannelState.Closed || stateName === 'CLOSED';
}
