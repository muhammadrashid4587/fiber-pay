/**
 * Permission URL parser
 * Handles fiber://perm/<base64url> format for permission requests
 */

import { type PermissionRequest, PermissionRequestSchema } from '../types/permissions.js';

/**
 * Error thrown when permission URL parsing fails
 */
export class PermissionUrlError extends Error {
  constructor(
    message: string,
    public readonly code: 'INVALID_URL' | 'INVALID_BASE64' | 'INVALID_JSON' | 'VALIDATION_ERROR',
  ) {
    super(message);
    this.name = 'PermissionUrlError';
  }
}

/**
 * Convert standard base64 to base64url (URL-safe base64)
 * Replaces + with -, / with _, and removes padding =
 */
function toBase64Url(base64: string): string {
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Convert base64url back to standard base64
 * Replaces - with +, _ with /, and adds padding
 */
function fromBase64Url(base64url: string): string {
  // Replace URL-safe characters with standard base64 characters
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');

  // Add padding if necessary
  const padding = base64.length % 4;
  if (padding === 2) {
    base64 += '==';
  } else if (padding === 3) {
    base64 += '=';
  }

  return base64;
}

/**
 * JSON replacer for bigint serialization
 */
function bigintReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  return value;
}

/**
 * JSON reviver for bigint deserialization
 * Converts string representations of numbers that might be bigints back to bigint
 */
function bigintReviver(key: string, value: unknown): unknown {
  // Fields that should be bigints based on the schema
  const bigintFields = ['max_amount', 'daily_limit', 'max_funding', 'total_amount_paid'];

  if (typeof value === 'string' && bigintFields.includes(key)) {
    try {
      return BigInt(value);
    } catch {
      return value;
    }
  }
  return value;
}

/**
 * Parse a permission URL in the format fiber://perm/<base64url-encoded-json>
 *
 * @param url - The permission URL to parse
 * @returns The parsed PermissionRequest object
 * @throws PermissionUrlError if the URL is invalid or malformed
 */
export function parsePermissionUrl(url: string): PermissionRequest {
  // Validate URL format
  if (!url.startsWith('fiber://perm/')) {
    throw new PermissionUrlError(
      `Invalid permission URL format. Expected fiber://perm/<base64url>, got: ${url}`,
      'INVALID_URL',
    );
  }

  // Extract the base64url part
  const base64urlPart = url.slice('fiber://perm/'.length);

  if (!base64urlPart) {
    throw new PermissionUrlError('Missing base64url payload in permission URL', 'INVALID_URL');
  }

  // Decode base64url to standard base64
  let base64: string;
  try {
    base64 = fromBase64Url(base64urlPart);
  } catch (error) {
    throw new PermissionUrlError(
      `Failed to convert base64url to base64: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'INVALID_BASE64',
    );
  }

  // Decode base64 to string
  let jsonString: string;
  try {
    jsonString = Buffer.from(base64, 'base64').toString('utf-8');
  } catch (error) {
    throw new PermissionUrlError(
      `Failed to decode base64: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'INVALID_BASE64',
    );
  }

  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString, bigintReviver);
  } catch (error) {
    throw new PermissionUrlError(
      `Failed to parse JSON: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'INVALID_JSON',
    );
  }

  // Validate against schema
  const result = PermissionRequestSchema.safeParse(parsed);
  if (!result.success) {
    throw new PermissionUrlError(
      `Invalid permission request: ${result.error.message}`,
      'VALIDATION_ERROR',
    );
  }

  return result.data;
}

/**
 * Build a permission URL in the format fiber://perm/<base64url-encoded-json>
 *
 * @param request - The PermissionRequest to encode
 * @returns The permission URL string
 * @throws PermissionUrlError if the request is invalid
 */
export function buildPermissionUrl(request: PermissionRequest): string {
  // Validate the request
  const result = PermissionRequestSchema.safeParse(request);
  if (!result.success) {
    throw new PermissionUrlError(
      `Invalid permission request: ${result.error.message}`,
      'VALIDATION_ERROR',
    );
  }

  // Serialize to JSON (handling bigints)
  const jsonString = JSON.stringify(request, bigintReplacer);

  // Encode to base64
  const base64 = Buffer.from(jsonString, 'utf-8').toString('base64');

  // Convert to base64url
  const base64url = toBase64Url(base64);

  // Build the URL
  return `fiber://perm/${base64url}`;
}
