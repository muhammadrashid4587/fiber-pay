/**
 * @fiber-pay/node
 * Fiber Network node binary management and process lifecycle
 *
 * @packageDocumentation
 */

export type {
  BinaryInfo,
  DownloadOptions,
  DownloadProgress,
} from './binary/index.js';
// Binary management
export {
  BinaryManager,
  downloadFiberBinary,
  ensureFiberBinary,
  getDefaultBinaryPath,
  getFiberBinaryInfo,
} from './binary/index.js';

// Process management
export { ProcessManager } from './process/index.js';
export type { FiberNodeConfig } from './process/manager.js';
