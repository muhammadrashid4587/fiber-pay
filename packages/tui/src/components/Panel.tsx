import { Box, Text } from 'ink';
import type { PropsWithChildren } from 'react';

interface PanelProps extends PropsWithChildren {
  title: string;
  focused?: boolean;
}

export function Panel({ title, focused, children }: PanelProps): JSX.Element {
  return (
    <Box borderStyle="round" borderColor={focused ? 'cyan' : 'gray'} paddingX={1} flexDirection="column">
      <Text color={focused ? 'cyan' : 'gray'}>{title}</Text>
      {children}
    </Box>
  );
}
