import type { IncomingMessage } from 'node:http';

const MAX_REQUEST_BODY_BYTES = 1024 * 1024;

export async function readRawBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  return await new Promise<Buffer>((resolve, reject) => {
    let settled = false;
    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      totalBytes += chunk.length;
      if (totalBytes > MAX_REQUEST_BODY_BYTES) {
        settled = true;
        req.destroy();
        reject(new PayloadTooLargeError());
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => { if (!settled) { settled = true; resolve(Buffer.concat(chunks)); } });
    req.on('error', (err) => { if (!settled) { settled = true; reject(err); } });
  });
}

class PayloadTooLargeError extends Error {
  constructor() {
    super('Payload too large');
    this.name = 'PayloadTooLargeError';
  }
}

export function isPayloadTooLargeError(error: unknown): boolean {
  return error instanceof PayloadTooLargeError;
}
