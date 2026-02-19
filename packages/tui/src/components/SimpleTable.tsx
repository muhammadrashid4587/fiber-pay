import { Box, Text } from 'ink';

export interface SimpleTableColumn {
  key: string;
  title: string;
  width?: number;
}

interface SimpleTableProps {
  columns: SimpleTableColumn[];
  rows: Record<string, string>[];
}

function fit(value: string, width: number): string {
  if (value.length === width) {
    return value;
  }
  if (value.length > width) {
    return `${value.slice(0, Math.max(0, width - 1))}…`;
  }
  return value.padEnd(width, ' ');
}

export function SimpleTable({ columns, rows }: SimpleTableProps): JSX.Element {
  const widths = columns.map((column) => {
    if (column.width) {
      return column.width;
    }

    const contentWidth = rows.reduce((max, row) => Math.max(max, (row[column.key] ?? '').length), 0);
    return Math.max(column.title.length, contentWidth);
  });

  return (
    <Box flexDirection="column">
      <Text>
        {columns
          .map((column, index) => fit(column.title, widths[index]))
          .join(' ')}
      </Text>
      <Text color="gray">{widths.map((width) => '-'.repeat(width)).join(' ')}</Text>
      {rows.map((row, rowIndex) => (
        <Text key={`row-${rowIndex}`}>
          {columns
            .map((column, columnIndex) => fit(row[column.key] ?? '', widths[columnIndex]))
            .join(' ')}
        </Text>
      ))}
    </Box>
  );
}
