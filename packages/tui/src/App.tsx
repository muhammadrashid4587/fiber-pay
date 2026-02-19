import type { AlertType } from '@fiber-pay/runtime';
import { Box, Text, useApp, useInput } from 'ink';
import { useEffect, useMemo, useState } from 'react';
import { RuntimeHttpClient } from './client/http-client.js';
import { WsAlertClient } from './client/ws-client.js';
import { AlertFeed } from './components/AlertFeed.js';
import { ChannelList } from './components/ChannelList.js';
import { InvoiceTracker } from './components/InvoiceTracker.js';
import { JobDashboard } from './components/JobDashboard.js';
import { NodeStatus } from './components/NodeStatus.js';
import { Panel } from './components/Panel.js';
import { PaymentTracker } from './components/PaymentTracker.js';
import type { TuiConfig } from './config.js';
import { useAlerts } from './hooks/use-alerts.js';
import { useChannels } from './hooks/use-channels.js';
import { useInvoices } from './hooks/use-invoices.js';
import { useJobs } from './hooks/use-jobs.js';
import { useNodeInfo } from './hooks/use-node-info.js';
import { usePolling } from './hooks/use-polling.js';
import { usePayments } from './hooks/use-payments.js';

type PanelId = 1 | 2 | 3 | 4 | 5 | 6;
type ScrollablePanel = Exclude<PanelId, 1>;

const DEFAULT_SCROLL: Record<ScrollablePanel, number> = {
  2: 0,
  3: 0,
  4: 0,
  5: 0,
  6: 0,
};

const CHANNEL_ALERTS = new Set<AlertType>([
  'channel_state_changed',
  'new_inbound_channel_request',
  'channel_became_ready',
  'channel_closing',
  'channel_balance_changed',
  'new_pending_tlc',
]);

const INVOICE_ALERTS = new Set<AlertType>([
  'incoming_payment_received',
  'invoice_expired',
  'invoice_cancelled',
]);

const PAYMENT_ALERTS = new Set<AlertType>(['outgoing_payment_completed', 'outgoing_payment_failed']);

const JOB_ALERTS = new Set<AlertType>([
  'payment_job_started',
  'payment_job_retrying',
  'payment_job_succeeded',
  'payment_job_failed',
  'invoice_job_started',
  'invoice_job_retrying',
  'invoice_job_succeeded',
  'invoice_job_failed',
  'channel_job_started',
  'channel_job_retrying',
  'channel_job_succeeded',
  'channel_job_failed',
]);

interface AppProps {
  config: TuiConfig;
}

export function App({ config }: AppProps): JSX.Element {
  const { exit } = useApp();
  const [focusedPanel, setFocusedPanel] = useState<PanelId>(1);
  const [scroll, setScroll] = useState<Record<ScrollablePanel, number>>(DEFAULT_SCROLL);

  const client = useMemo(() => new RuntimeHttpClient(config.proxyUrl), [config.proxyUrl]);
  const websocketMode = config.alertsEnabled && Boolean(config.wsUrl);
  const pollingAlertsMode = config.alertsEnabled && !config.wsUrl;
  const wsClient = useMemo(
    () => (websocketMode && config.wsUrl ? new WsAlertClient(config.wsUrl) : undefined),
    [config.wsUrl, websocketMode],
  );

  const node = useNodeInfo(client, config.pollInterval);
  const channels = useChannels(client, config.pollInterval);
  const invoices = useInvoices(client, config.pollInterval);
  const payments = usePayments(client, config.pollInterval);
  const jobs = useJobs(client, config.pollInterval);
  const alerts = useAlerts(wsClient, { bufferSize: config.alertBufferSize });
  const polledAlerts = usePolling(
    async () => {
      if (!pollingAlertsMode) {
        return [];
      }
      return client.listAlerts({ limit: config.alertBufferSize });
    },
    config.pollInterval,
  );

  const effectiveAlerts = websocketMode ? alerts.alerts : (polledAlerts.data ?? []);
  const latestAlert = effectiveAlerts.length > 0 ? effectiveAlerts[effectiveAlerts.length - 1] : undefined;
  const alertMode: 'websocket' | 'polling' | 'disabled' = !config.alertsEnabled
    ? 'disabled'
    : websocketMode
      ? 'websocket'
      : 'polling';

  const recentChannelIds = useMemo(() => {
    const now = Date.now();
    const recent = new Set<string>();

    for (const alert of effectiveAlerts) {
      const ts = new Date(alert.timestamp).getTime();
      if (!Number.isFinite(ts) || now - ts > 10000) {
        continue;
      }

      if (!CHANNEL_ALERTS.has(alert.type)) {
        continue;
      }

      if (alert.data && typeof alert.data === 'object') {
        const data = alert.data as Record<string, unknown>;
        const channelId =
          (typeof data.channelId === 'string' && data.channelId) ||
          (typeof data.channel_id === 'string' && data.channel_id) ||
          undefined;
        if (channelId) {
          recent.add(channelId);
        }
      }
    }

    return recent;
  }, [effectiveAlerts]);

  useInput((input, key) => {
    if (input === 'q') {
      exit();
      return;
    }

    if (input === '\t') {
      setFocusedPanel((prev) => (((prev % 6) + 1) as PanelId));
      return;
    }

    if (input === 'r') {
      void Promise.all([
        node.refresh(),
        channels.refresh(),
        invoices.refresh(),
        payments.refresh(),
        jobs.refresh(),
        polledAlerts.refresh(),
      ]);
      return;
    }

    if (input >= '1' && input <= '6') {
      setFocusedPanel(Number.parseInt(input, 10) as PanelId);
      return;
    }

    if ((input === 'j' || key.downArrow) && focusedPanel !== 1) {
      const panel = focusedPanel as ScrollablePanel;
      setScroll((prev) => ({
        ...prev,
        [panel]: prev[panel] + 1,
      }));
      return;
    }

    if ((input === 'k' || key.upArrow) && focusedPanel !== 1) {
      const panel = focusedPanel as ScrollablePanel;
      setScroll((prev) => ({
        ...prev,
        [panel]: Math.max(0, prev[panel] - 1),
      }));
    }
  });

  useEffect(() => {
    if (!latestAlert) {
      return;
    }

    const alertType = latestAlert.type;
    if (CHANNEL_ALERTS.has(alertType)) {
      void channels.refresh();
    }
    if (INVOICE_ALERTS.has(alertType)) {
      void invoices.refresh();
    }
    if (PAYMENT_ALERTS.has(alertType)) {
      void payments.refresh();
    }
    if (JOB_ALERTS.has(alertType)) {
      void jobs.refresh();
    }
  }, [
    latestAlert?.id,
    latestAlert?.type,
    channels.refresh,
    invoices.refresh,
    jobs.refresh,
    polledAlerts.refresh,
    payments.refresh,
  ]);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color="gray">Tab focus | 1-6 jump | j/k scroll | r refresh | q quit</Text>

      <Panel title="1. Node Status" focused={focusedPanel === 1}>
        <NodeStatus node={node.node} online={node.online} loading={node.loading} focused={focusedPanel === 1} />
      </Panel>

      <Box>
        <Box flexGrow={3} marginRight={1}>
          <Panel title="2. Channel List" focused={focusedPanel === 2}>
            <ChannelList
              channels={channels.channels}
              loading={channels.loading}
              recentlyChangedChannelIds={recentChannelIds}
              scrollOffset={scroll[2]}
              maxRows={8}
            />
          </Panel>
        </Box>

        <Box flexGrow={2} flexDirection="column">
          <Panel title="3. Invoice Tracker" focused={focusedPanel === 3}>
            <InvoiceTracker
              invoices={invoices.invoices}
              loading={invoices.loading}
              scrollOffset={scroll[3]}
              maxRows={4}
            />
          </Panel>
          <Panel title="4. Payment Tracker" focused={focusedPanel === 4}>
            <PaymentTracker
              payments={payments.payments}
              loading={payments.loading}
              scrollOffset={scroll[4]}
              maxRows={4}
            />
          </Panel>
        </Box>
      </Box>

      <Box>
        <Box flexGrow={1} marginRight={1}>
          <Panel title="5. Job Dashboard" focused={focusedPanel === 5}>
            <JobDashboard jobs={jobs.jobs} loading={jobs.loading} scrollOffset={scroll[5]} maxRows={6} />
          </Panel>
        </Box>

        <Box flexGrow={1}>
          <Panel title="6. Alert Feed" focused={focusedPanel === 6}>
            <AlertFeed
              alerts={effectiveAlerts}
              connected={alerts.connected}
              connectionState={alerts.connectionState}
              mode={alertMode}
              scrollOffset={scroll[6]}
              maxRows={20}
            />
          </Panel>
        </Box>
      </Box>
    </Box>
  );
}
