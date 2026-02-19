import type { Channel } from '@fiber-pay/sdk';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { SimpleTable } from './SimpleTable.js';
import { channelStateColor, shortHex } from './utils.js';

interface ChannelListProps {
  channels: Channel[];
  loading: boolean;
  focused?: boolean;
  recentlyChangedChannelIds: Set<string>;
  scrollOffset: number;
  maxRows: number;
}

export function ChannelList({
  channels,
  loading,
  recentlyChangedChannelIds,
  scrollOffset,
  maxRows,
}: ChannelListProps): JSX.Element {
  if (loading && channels.length === 0) {
    return (
      <Text color="cyan">
        <Spinner type="dots" /> Loading channels...
      </Text>
    );
  }

  if (channels.length === 0) {
    return <Text color="gray">No channels</Text>;
  }

  const rows = channels.map((channel) => {
    const changed = recentlyChangedChannelIds.has(channel.channel_id);
    const state = channel.state.state_name;

    return {
      ID: changed ? `* ${shortHex(channel.channel_id)}` : shortHex(channel.channel_id),
      Peer: shortHex(channel.peer_id),
      State: state,
      Local: channel.local_balance,
      Remote: channel.remote_balance,
      Pending: String(channel.pending_tlcs.length),
      Enabled: channel.enabled ? 'yes' : 'no',
      _stateColor: channelStateColor(state),
    };
  });

  const visibleRows = rows.slice(scrollOffset, scrollOffset + maxRows).map((row) => {
    const { _stateColor, ...visible } = row;
    return {
      ...visible,
      State: `[${row.State}]`,
    };
  });

  return (
    <Box flexDirection="column">
      <Text dimColor>
        {scrollOffset + 1}-{Math.min(scrollOffset + maxRows, channels.length)} / {channels.length}
      </Text>
      <SimpleTable
        columns={[
          { key: 'ID', title: 'ID', width: 16 },
          { key: 'Peer', title: 'Peer', width: 16 },
          { key: 'State', title: 'State', width: 14 },
          { key: 'Local', title: 'Local', width: 12 },
          { key: 'Remote', title: 'Remote', width: 12 },
          { key: 'Pending', title: 'Pending', width: 7 },
          { key: 'Enabled', title: 'Enabled', width: 7 },
        ]}
        rows={visibleRows}
      />
      <Text color="gray">State colors: </Text>
      <Text color="green">ready </Text>
      <Text color="yellow">shutdown </Text>
      <Text color="gray">closed </Text>
      <Text color="cyan">negotiating</Text>
    </Box>
  );
}
