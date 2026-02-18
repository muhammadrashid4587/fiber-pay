import type { ServerResponse } from 'node:http';

export const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
  'access-control-allow-headers': 'Content-Type, Authorization',
};

export const CORS_PREFLIGHT_HEADERS = {
  ...CORS_HEADERS,
  'access-control-max-age': '86400',
};

export function writeJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json',
    ...CORS_HEADERS,
  });
  res.end(JSON.stringify(value));
}

export function parseOptionalPositiveInteger(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
}
