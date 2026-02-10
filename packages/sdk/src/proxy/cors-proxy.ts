/**
 * CORS Proxy Server
 * Simple HTTP proxy that adds CORS headers to Fiber RPC requests
 */

import http from 'node:http';

export interface CorsProxyConfig {
  /** Port to listen on */
  port: number;
  /** Target RPC URL to proxy to */
  targetUrl: string;
  /** Allowed origins (default: '*') */
  allowedOrigins?: string | string[];
}

export class CorsProxy {
  private server: http.Server | null = null;
  private config: CorsProxyConfig;

  constructor(config: CorsProxyConfig) {
    this.config = config;
  }

  /**
   * Start the CORS proxy server
   */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const targetUrl = new URL(this.config.targetUrl);

      this.server = http.createServer(async (req, res) => {
        const origin = req.headers.origin || '*';
        const allowedOrigin = this.getAllowedOrigin(origin);

        // Set CORS headers
        res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.setHeader('Access-Control-Max-Age', '86400');

        // Handle preflight requests
        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        // Only allow POST requests
        if (req.method !== 'POST') {
          res.writeHead(405, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        // Collect request body
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          const body = Buffer.concat(chunks);

          // Forward request to Fiber RPC
          const proxyReq = http.request(
            {
              hostname: targetUrl.hostname,
              port: targetUrl.port || 80,
              path: targetUrl.pathname,
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Content-Length': body.length,
                ...(req.headers.authorization && { Authorization: req.headers.authorization }),
              },
            },
            (proxyRes) => {
              // Copy status and headers from proxy response
              const headers: Record<string, string | string[] | undefined> = {
                ...proxyRes.headers,
                'Access-Control-Allow-Origin': allowedOrigin,
              };
              res.writeHead(proxyRes.statusCode || 500, headers);
              proxyRes.pipe(res);
            }
          );

          proxyReq.on('error', (err) => {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Proxy error: ${err.message}` }));
          });

          proxyReq.write(body);
          proxyReq.end();
        });

        req.on('error', (err) => {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Request error: ${err.message}` }));
        });
      });

      this.server.on('error', (err) => {
        reject(err);
      });

      this.server.listen(this.config.port, () => {
        resolve();
      });
    });
  }

  /**
   * Stop the CORS proxy server
   */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Get the allowed origin based on config
   */
  private getAllowedOrigin(requestOrigin: string): string {
    const allowed = this.config.allowedOrigins;

    if (!allowed || allowed === '*') {
      return '*';
    }

    if (Array.isArray(allowed)) {
      return allowed.includes(requestOrigin) ? requestOrigin : allowed[0];
    }

    return allowed;
  }

  /**
   * Get the proxy URL
   */
  getUrl(): string {
    return `http://127.0.0.1:${this.config.port}`;
  }
}
