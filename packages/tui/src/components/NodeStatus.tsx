import type { NodeInfo } from '@fiber-pay/sdk';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { shortHex } from './utils.js';

interface NodeStatusProps {
  node: NodeInfo | undefined;
  online: boolean;
  loading: boolean;
  focused?: boolean;
}

export function NodeStatus({ node, online, loading }: NodeStatusProps): JSX.Element {
  if (loading && !node) {
    return (
      <Box>
        <Text color="cyan">
          <Spinner type="dots" /> Loading node status...
        </Text>
      </Box>
    );
  }

  if (!node) {
    return <Text color="red">● Offline (runtime proxy or node RPC unavailable)</Text>;
  }

  const statusColor = online ? 'green' : 'red';
  const statusLabel = online ? 'Online' : 'Offline';

  return (
    <Box flexWrap="wrap" columnGap={2}>
      <Text>v{node.version}</Text>
      <Text>node_id: {shortHex(node.node_id)}</Text>
      <Text>{node.addresses.length} addresses</Text>
      <Text>{Number.parseInt(node.channel_count, 16)} channels</Text>
      <Text>{Number.parseInt(node.peers_count, 16)} peers</Text>
      <Text>{node.udt_cfg_infos.length} UDT cfg</Text>
      <Text color={statusColor}>● {statusLabel}</Text>
    </Box>
  );
}
