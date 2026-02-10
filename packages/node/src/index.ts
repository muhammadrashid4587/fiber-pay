/**
 * @fiber-pay/node
 * Fiber Network node binary management and process lifecycle
 * 
 * @packageDocumentation
 */

// Binary management
export {
  BinaryManager,
  downloadFiberBinary,
  getFiberBinaryInfo,
  ensureFiberBinary,
  getDefaultBinaryPath,
} from './binary/index.js';
export type {
  BinaryInfo,
  DownloadOptions,
  DownloadProgress,
} from './binary/index.js';

// Process management
export { ProcessManager } from './process/index.js';
export type { FiberNodeConfig } from './process/manager.js';
