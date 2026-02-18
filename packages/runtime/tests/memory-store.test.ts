import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/storage/memory-store.js';

describe('MemoryStore', () => {
  it('flushes and loads persisted state', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fiber-runtime-test-'));
    const stateFile = join(dir, 'state.json');

    const store = new MemoryStore({
      stateFilePath: stateFile,
      flushIntervalMs: 2000,
      maxAlertHistory: 10,
    });

    store.addTrackedInvoice('0x1');
    store.addTrackedPayment('0x2');
    store.addAlert({
      id: 'a1',
      timestamp: new Date().toISOString(),
      type: 'peer_connected',
      priority: 'low',
      source: 'test',
      data: {},
    });

    await store.flush();

    const loaded = new MemoryStore({
      stateFilePath: stateFile,
      flushIntervalMs: 2000,
      maxAlertHistory: 10,
    });

    await loaded.load();

    expect(loaded.listTrackedInvoices()).toHaveLength(1);
    expect(loaded.listTrackedPayments()).toHaveLength(1);
    expect(loaded.listAlerts()).toHaveLength(1);

    await rm(dir, { recursive: true, force: true });
  });
});
