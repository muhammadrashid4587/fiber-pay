import type { Script } from '@fiber-pay/sdk';

const CELLS_PAGE_SIZE = 100;

interface IndexerCellsResponse {
  objects: Array<{ output?: { capacity?: string } }>;
  last_cursor?: string;
}

export async function callJsonRpc<TResult>(
  url: string,
  method: string,
  params: unknown[],
): Promise<TResult> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as {
    result?: TResult;
    error?: { message?: string; code?: number };
  };

  if (payload.error) {
    const code = payload.error.code ?? 'unknown';
    const message = payload.error.message ?? 'JSON-RPC error';
    throw new Error(`${message} (code: ${code})`);
  }

  if (payload.result === undefined) {
    throw new Error('Missing JSON-RPC result');
  }

  return payload.result;
}

export async function getLockBalanceShannons(
  ckbRpcUrl: string,
  lockScript: Script,
): Promise<bigint> {
  let cursor: string | undefined;
  let total = 0n;
  const limitHex = `0x${CELLS_PAGE_SIZE.toString(16)}`;

  for (let i = 0; i < 2000; i++) {
    const params: unknown[] = [{ script: lockScript, script_type: 'lock' }, 'asc', limitHex];
    if (cursor) {
      params.push(cursor);
    }

    const page = await callJsonRpc<IndexerCellsResponse>(ckbRpcUrl, 'get_cells', params);
    const cells = page.objects ?? [];

    for (const cell of cells) {
      if (cell.output?.capacity) {
        total += BigInt(cell.output.capacity);
      }
    }

    const nextCursor = page.last_cursor;
    if (!nextCursor || nextCursor === cursor || cells.length < CELLS_PAGE_SIZE) {
      break;
    }
    cursor = nextCursor;
  }

  return total;
}
