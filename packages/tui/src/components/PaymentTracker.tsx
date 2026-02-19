import type { TrackedPaymentState } from '@fiber-pay/runtime';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { SimpleTable } from './SimpleTable.js';
import { formatTimestamp, shortHex } from './utils.js';

interface PaymentTrackerProps {
  payments: TrackedPaymentState[];
  loading: boolean;
  scrollOffset: number;
  maxRows: number;
}

export function PaymentTracker({
  payments,
  loading,
  scrollOffset,
  maxRows,
}: PaymentTrackerProps): JSX.Element {
  if (loading && payments.length === 0) {
    return (
      <Text color="cyan">
        <Spinner type="dots" /> Loading payments...
      </Text>
    );
  }

  if (payments.length === 0) {
    return <Text color="gray">No tracked payments</Text>;
  }

  const rows = payments.map((payment) => ({
    Hash: shortHex(payment.paymentHash),
    Status: payment.status,
    Tracked: formatTimestamp(payment.trackedAt),
    Updated: formatTimestamp(payment.updatedAt),
  }));

  const visibleRows = rows.slice(scrollOffset, scrollOffset + maxRows);

  return (
    <Box flexDirection="column">
      <SimpleTable
        columns={[
          { key: 'Hash', title: 'Payment Hash', width: 16 },
          { key: 'Status', title: 'Status', width: 10 },
          { key: 'Tracked', title: 'Tracked At', width: 19 },
          { key: 'Updated', title: 'Updated At', width: 19 },
        ]}
        rows={visibleRows}
      />
      <Text color="gray">Status: </Text>
      <Text color="white">Created </Text>
      <Text color="cyan">Inflight </Text>
      <Text color="green">Success </Text>
      <Text color="red">Failed</Text>
    </Box>
  );
}
