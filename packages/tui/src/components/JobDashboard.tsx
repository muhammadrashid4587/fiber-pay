import type { RuntimeJob } from '@fiber-pay/runtime';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { SimpleTable } from './SimpleTable.js';
import { formatTimestamp, shortHex } from './utils.js';

interface JobDashboardProps {
  jobs: RuntimeJob[];
  loading: boolean;
  scrollOffset: number;
  maxRows: number;
}

export function JobDashboard({ jobs, loading, scrollOffset, maxRows }: JobDashboardProps): JSX.Element {
  if (loading && jobs.length === 0) {
    return (
      <Text color="cyan">
        <Spinner type="dots" /> Loading jobs...
      </Text>
    );
  }

  const queued = jobs.filter((job) => job.state === 'queued').length;
  const executing = jobs.filter(
    (job) => job.state === 'executing' || job.state === 'inflight' || job.state === 'waiting_retry',
  ).length;
  const succeeded = jobs.filter((job) => job.state === 'succeeded').length;
  const failed = jobs.filter((job) => job.state === 'failed').length;

  if (jobs.length === 0) {
    return (
      <Box flexDirection="column">
        <Text>
          queued <Text color="white">{queued}</Text> | executing <Text color="cyan">{executing}</Text>{' '}
          | succeeded <Text color="green">{succeeded}</Text> | failed <Text color="red">{failed}</Text>
        </Text>
        <Text color="gray">No jobs</Text>
      </Box>
    );
  }

  const rows = jobs.map((job) => ({
    ID: shortHex(job.id, 5, 4),
    Type: job.type,
    State: job.state,
    Retry: String(job.retryCount),
    Created: formatTimestamp(job.createdAt),
    Error: (job.error?.message ?? '-').slice(0, 40),
  }));

  const visibleRows = rows.slice(scrollOffset, scrollOffset + maxRows);

  return (
    <Box flexDirection="column">
      <Text>
        queued <Text color="white">{queued}</Text> | executing <Text color="cyan">{executing}</Text> | succeeded{' '}
        <Text color="green">{succeeded}</Text> | failed <Text color="red">{failed}</Text>
      </Text>
      <SimpleTable
        columns={[
          { key: 'ID', title: 'ID', width: 12 },
          { key: 'Type', title: 'Type', width: 8 },
          { key: 'State', title: 'State', width: 16 },
          { key: 'Retry', title: 'Retry', width: 5 },
          { key: 'Created', title: 'Created At', width: 19 },
          { key: 'Error', title: 'Error', width: 32 },
        ]}
        rows={visibleRows}
      />
      <Text color="gray">State colors: </Text>
      <Text color="white">queued </Text>
      <Text color="cyan">executing </Text>
      <Text color="green">succeeded </Text>
      <Text color="red">failed </Text>
      <Text color="gray">cancelled</Text>
    </Box>
  );
}
