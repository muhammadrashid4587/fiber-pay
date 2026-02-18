import { createHash } from 'node:crypto';
import http from 'node:http';
import type { Duplex } from 'node:stream';
import type { Alert, AlertBackend } from '../types.js';

export interface WebsocketAlertBackendConfig {
  host: string;
  port: number;
}

export class WebsocketAlertBackend implements AlertBackend {
  private readonly config: WebsocketAlertBackendConfig;
  private readonly clients = new Set<Duplex>();
  private server: http.Server | undefined;

  constructor(config: WebsocketAlertBackendConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    if (this.server) {
      return;
    }

    this.server = http.createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    });

    this.server.on('upgrade', (request, socket) => {
      const key = request.headers['sec-websocket-key'];
      if (!key || typeof key !== 'string') {
        socket.destroy();
        return;
      }

      const accept = createHash('sha1')
        .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest('base64');

      const headers = [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
      ];

      socket.write(`${headers.join('\r\n')}\r\n\r\n`);
      this.clients.add(socket);
      socket.on('close', () => this.clients.delete(socket));
      socket.on('end', () => this.clients.delete(socket));
      socket.on('error', () => this.clients.delete(socket));
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(this.config.port, this.config.host, () => {
        this.server?.off('error', reject);
        resolve();
      });
    });
  }

  async send(alert: Alert): Promise<void> {
    const payload = Buffer.from(JSON.stringify(alert), 'utf8');
    const frame = buildWebSocketFrame(payload);

    for (const client of this.clients) {
      try {
        client.write(frame);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  async stop(): Promise<void> {
    for (const client of this.clients) {
      client.destroy();
    }
    this.clients.clear();

    if (!this.server) {
      return;
    }

    const server = this.server;
    this.server = undefined;

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
}

function buildWebSocketFrame(payload: Buffer): Buffer {
  const payloadLength = payload.length;
  if (payloadLength < 126) {
    return Buffer.concat([Buffer.from([0x81, payloadLength]), payload]);
  }

  if (payloadLength < 65536) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payloadLength, 2);
    return Buffer.concat([header, payload]);
  }

  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeUInt32BE(0, 2);
  header.writeUInt32BE(payloadLength, 6);
  return Buffer.concat([header, payload]);
}
