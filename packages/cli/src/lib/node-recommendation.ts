type StatusRecommendationInput = {
  binaryReady: boolean;
  configExists: boolean;
  nodeRunning: boolean;
  rpcResponsive: boolean;
  channelsReady: number;
  canSend: boolean;
  canReceive: boolean;
};

type ReadyRecommendationInput = {
  nodeRunning: boolean;
  rpcReachable: boolean;
  channelsReady: number;
  canSend: boolean;
  canReceive: boolean;
};

type RecommendationResult = {
  recommendation: string;
  reasons: string[];
};

export function summarizeChannelLiquidity(
  readyChannels: Array<{ local_balance: string; remote_balance: string }>,
): { canSend: boolean; canReceive: boolean; localCkb: number; remoteCkb: number } {
  const canSend = readyChannels.some((channel) => BigInt(channel.local_balance) > 0n);
  const canReceive = readyChannels.some((channel) => BigInt(channel.remote_balance) > 0n);

  let totalLocal = 0n;
  let totalRemote = 0n;
  for (const channel of readyChannels) {
    totalLocal += BigInt(channel.local_balance);
    totalRemote += BigInt(channel.remote_balance);
  }

  return {
    canSend,
    canReceive,
    localCkb: Number(totalLocal) / 1e8,
    remoteCkb: Number(totalRemote) / 1e8,
  };
}

export function buildStatusRecommendation(input: StatusRecommendationInput): RecommendationResult {
  const reasons: string[] = [];

  if (!input.binaryReady) reasons.push('Fiber binary is missing or not executable.');
  if (!input.configExists) reasons.push('Config file is missing.');
  if (!input.nodeRunning) reasons.push('Node process is not running.');
  if (input.nodeRunning && !input.rpcResponsive) {
    reasons.push('Node process is running but RPC is not reachable.');
  }
  if (input.rpcResponsive && input.channelsReady === 0) {
    reasons.push('No ChannelReady channel found.');
  }
  if (input.channelsReady > 0 && !input.canSend && input.canReceive) {
    reasons.push('Send liquidity is low on ChannelReady channels.');
  }
  if (input.channelsReady > 0 && input.canSend && !input.canReceive) {
    reasons.push('Receive liquidity is low on ChannelReady channels.');
  }
  if (input.channelsReady > 0 && !input.canSend && !input.canReceive) {
    reasons.push('ChannelReady channels exist but liquidity is zero.');
  }

  let recommendation = 'READY';
  if (!input.binaryReady) {
    recommendation = 'INSTALL_BINARY';
  } else if (!input.configExists) {
    recommendation = 'INIT_CONFIG';
  } else if (!input.nodeRunning) {
    recommendation = 'START_NODE';
  } else if (!input.rpcResponsive) {
    recommendation = 'WAIT_RPC';
  } else if (input.channelsReady === 0) {
    recommendation = 'OPEN_CHANNEL';
  } else if (!input.canSend && !input.canReceive) {
    recommendation = 'NO_LIQUIDITY';
  } else if (!input.canSend && input.canReceive) {
    recommendation = 'SEND_CAPACITY_LOW';
  } else if (input.canSend && !input.canReceive) {
    recommendation = 'RECEIVE_CAPACITY_LOW';
  }

  return { recommendation, reasons };
}

export function buildReadyRecommendation(input: ReadyRecommendationInput): RecommendationResult {
  if (!input.nodeRunning) {
    return {
      recommendation: 'NODE_STOPPED',
      reasons: ['Node process is not running.'],
    };
  }

  if (!input.rpcReachable) {
    return {
      recommendation: 'RPC_UNREACHABLE',
      reasons: ['Node process is running but RPC is not reachable.'],
    };
  }

  if (input.channelsReady === 0) {
    return {
      recommendation: 'NEED_CHANNEL',
      reasons: ['No ChannelReady channel found. Open and wait for channel readiness.'],
    };
  }

  if (input.canSend && input.canReceive) {
    return {
      recommendation: 'READY',
      reasons: ['Node is reachable and has send/receive liquidity.'],
    };
  }

  if (input.canSend) {
    return {
      recommendation: 'RECEIVE_CAPACITY_LOW',
      reasons: ['Receive liquidity is low on all ChannelReady channels.'],
    };
  }

  if (input.canReceive) {
    return {
      recommendation: 'SEND_CAPACITY_LOW',
      reasons: ['Send liquidity is low on all ChannelReady channels.'],
    };
  }

  return {
    recommendation: 'NO_LIQUIDITY',
    reasons: ['ChannelReady channels exist but both local/remote liquidity are zero.'],
  };
}

export function buildStalePidRecommendation(): RecommendationResult {
  return {
    recommendation: 'NODE_STOPPED',
    reasons: ['Stale PID file detected and cleaned.'],
  };
}
