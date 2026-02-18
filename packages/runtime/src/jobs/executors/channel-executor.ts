import { ChannelState, type FiberRpcClient } from '@fiber-pay/sdk';
import { classifyPaymentError } from '../error-classifier.js';
import type { ChannelJob, RetryPolicy } from '../types.js';

const DEFAULT_POLL_INTERVAL = 2_000;

export async function* runChannelJob(
  job: ChannelJob,
  rpc: FiberRpcClient,
  _policy: RetryPolicy,
  signal: AbortSignal,
): AsyncGenerator<ChannelJob> {
  let current = { ...job };

  if (current.state === 'queued') {
    current = { ...current, state: 'executing', updatedAt: Date.now() };
    yield current;
  }

  try {
    const pollIntervalMs = current.params.pollIntervalMs ?? DEFAULT_POLL_INTERVAL;

    if (current.params.action === 'open') {
      if (!current.params.openChannelParams) {
        throw new Error('Channel open job requires openChannelParams');
      }

      const opened = await rpc.openChannel(current.params.openChannelParams);
      current = {
        ...current,
        state: 'channel_opening',
        result: {
          temporaryChannelId: opened.temporary_channel_id,
          state: 'OPENING',
        },
        updatedAt: Date.now(),
      };
      yield current;

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
          peer_id: current.params.peerId ?? current.params.openChannelParams.peer_id,
          include_closed: true,
        });

        const match = channels.channels.find((channel) => {
          if (current.params.channelId && channel.channel_id !== current.params.channelId) return false;
          return channel.peer_id === (current.params.peerId ?? current.params.openChannelParams?.peer_id);
        });

        if (match) {
          if (
            match.state.state_name === ChannelState.ChannelReady ||
            match.state.state_name === 'CHANNEL_READY'
          ) {
            current = {
              ...current,
              state: 'channel_ready',
              result: {
                temporaryChannelId: opened.temporary_channel_id,
                channelId: match.channel_id,
                state: match.state.state_name,
              },
              updatedAt: Date.now(),
            };
            yield current;

            current = { ...current, state: 'succeeded', completedAt: Date.now(), updatedAt: Date.now() };
            yield current;
            return;
          }

          if (match.state.state_name === ChannelState.Closed || match.state.state_name === 'CLOSED') {
            current = {
              ...current,
              state: 'channel_closed',
              result: {
                temporaryChannelId: opened.temporary_channel_id,
                channelId: match.channel_id,
                state: match.state.state_name,
              },
              completedAt: Date.now(),
              updatedAt: Date.now(),
            };
            yield current;
            current = { ...current, state: 'failed', completedAt: Date.now(), updatedAt: Date.now() };
            yield current;
            return;
          }
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
