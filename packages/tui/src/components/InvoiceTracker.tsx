import type { TrackedInvoiceState } from '@fiber-pay/runtime';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { SimpleTable } from './SimpleTable.js';
import { formatTimestamp, shortHex } from './utils.js';

interface InvoiceTrackerProps {
  invoices: TrackedInvoiceState[];
  loading: boolean;
  scrollOffset: number;
  maxRows: number;
}

export function InvoiceTracker({
  invoices,
  loading,
  scrollOffset,
  maxRows,
}: InvoiceTrackerProps): JSX.Element {
  if (loading && invoices.length === 0) {
    return (
      <Text color="cyan">
        <Spinner type="dots" /> Loading invoices...
      </Text>
    );
  }

  if (invoices.length === 0) {
    return <Text color="gray">No tracked invoices</Text>;
  }

  const rows = invoices.map((invoice) => ({
    Hash: shortHex(invoice.paymentHash),
    Status: invoice.status,
    Tracked: formatTimestamp(invoice.trackedAt),
    Updated: formatTimestamp(invoice.updatedAt),
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
      <Text color="white">Open </Text>
      <Text color="cyan">Received </Text>
      <Text color="green">Paid </Text>
      <Text color="yellow">Expired </Text>
      <Text color="red">Cancelled</Text>
    </Box>
  );
}
