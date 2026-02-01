/**
 * Binary Manager
 * Handles downloading, installing, and managing the Fiber Network Node (fnn) binary
 */

import { createWriteStream, existsSync, mkdirSync, chmodSync, unlinkSync, renameSync } from 'fs';
import { join, dirname } from 'path';
import { pipeline } from 'stream/promises';
import { createGunzip } from 'zlib';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// =============================================================================
// Types
// =============================================================================

export type Platform = 'darwin' | 'linux' | 'win32';
export type Arch = 'x64' | 'arm64';

export interface BinaryInfo {
  /** Path to the binary */
  path: string;
  /** Version of the binary */
  version: string;
  /** Whether the binary exists and is executable */
  ready: boolean;
}

export interface DownloadOptions {
  /** Target directory for the binary */
  installDir?: string;
  /** Specific version to download (default: latest) */
  version?: string;
  /** Force re-download even if binary exists */
  force?: boolean;
  /** Progress callback */
  onProgress?: (progress: DownloadProgress) => void;
}

export interface DownloadProgress {
  phase: 'fetching' | 'downloading' | 'extracting' | 'installing';
  percent?: number;
  message: string;
}

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

export interface GithubRelease {
  tag_name: string;
  name: string;
  assets: ReleaseAsset[];
}

// =============================================================================
// Constants
// =============================================================================

const GITHUB_REPO = 'nervosnetwork/fiber';
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases`;
const DEFAULT_INSTALL_DIR = join(process.env.HOME || '~', '.fiber-pay', 'bin');

// Binary naming patterns for different platforms
// Pattern used to match assets: fnn_vX.X.X-{pattern}.tar.gz
const BINARY_PATTERNS: Record<Platform, Record<Arch, string>> = {
  darwin: {
    x64: 'x86_64-darwin',
    arm64: 'aarch64-darwin',  // May not exist yet, will fallback to x64
  },
  linux: {
    x64: 'x86_64-linux',
    arm64: 'aarch64-linux',
  },
  win32: {
    x64: 'x86_64-windows',
    arm64: 'aarch64-windows',
  },
};

// =============================================================================
// Binary Manager
// =============================================================================

export class BinaryManager {
  private installDir: string;

  constructor(installDir?: string) {
    this.installDir = installDir || DEFAULT_INSTALL_DIR;
  }

  /**
   * Get the current platform and architecture
   */
  getPlatformInfo(): { platform: Platform; arch: Arch } {
    const platform = process.platform as Platform;
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';

    if (!['darwin', 'linux', 'win32'].includes(platform)) {
      throw new Error(`Unsupported platform: ${platform}`);
    }

    return { platform, arch };
  }

  /**
   * Get the pattern to match for the current platform
   */
  getAssetPattern(): string {
    const { platform, arch } = this.getPlatformInfo();
    const pattern = BINARY_PATTERNS[platform]?.[arch];

    if (!pattern) {
      throw new Error(`No binary pattern for ${platform}/${arch}`);
    }

    return pattern;
  }

  /**
   * Get the path where the binary should be installed
   */
  getBinaryPath(): string {
    const { platform } = this.getPlatformInfo();
    const binaryName = platform === 'win32' ? 'fnn.exe' : 'fnn';
    return join(this.installDir, binaryName);
  }

  /**
   * Check if the binary is installed and get its info
   */
  async getBinaryInfo(): Promise<BinaryInfo> {
    const binaryPath = this.getBinaryPath();
    const exists = existsSync(binaryPath);

    let version = 'unknown';
    let ready = false;

    if (exists) {
      try {
        const { stdout } = await execAsync(`"${binaryPath}" --version`);
        // Output format: "fnn Fiber v0.6.1 (f761b6d 2026-01-14)"
        // Extract the version number
        const versionMatch = stdout.match(/v(\d+\.\d+\.\d+)/);
        version = versionMatch ? versionMatch[1] : stdout.trim();
        ready = true;
      } catch {
        // Binary exists but may not be executable
        ready = false;
      }
    }

    return { path: binaryPath, version, ready };
  }

  /**
   * Fetch the latest release info from GitHub
   */
  async getLatestRelease(): Promise<GithubRelease> {
    const response = await fetch(`${GITHUB_API_URL}/latest`, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'fiber-pay',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch release info: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<GithubRelease>;
  }

  /**
   * Fetch a specific release by version tag
   */
  async getRelease(version: string): Promise<GithubRelease> {
    const tag = version.startsWith('v') ? version : `v${version}`;
    const response = await fetch(`${GITHUB_API_URL}/tags/${tag}`, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'fiber-pay',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch release ${version}: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<GithubRelease>;
  }

  /**
   * Find the matching asset for the current platform
   */
  findAsset(release: GithubRelease): { asset: ReleaseAsset; usesRosetta: boolean } {
    const { platform, arch } = this.getPlatformInfo();
    
    // Get the pattern for current platform/arch
    const pattern = BINARY_PATTERNS[platform][arch];
    
    // Find asset matching the pattern
    let asset = release.assets.find(a => a.name.includes(pattern));

    // On ARM64 macOS, fallback to x86_64 with Rosetta 2
    if (!asset && platform === 'darwin' && arch === 'arm64') {
      const x64Pattern = BINARY_PATTERNS.darwin.x64;
      asset = release.assets.find(a => a.name.includes(x64Pattern));
      if (asset) {
        return { asset, usesRosetta: true };
      }
    }

    // On ARM64 Linux, try x86_64 (some systems support this)
    if (!asset && platform === 'linux' && arch === 'arm64') {
      const x64Pattern = BINARY_PATTERNS.linux.x64;
      asset = release.assets.find(a => a.name.includes(x64Pattern));
      if (asset) {
        return { asset, usesRosetta: true };  // Not rosetta but similar fallback
      }
    }

    if (!asset) {
      const availableAssets = release.assets.map(a => a.name).join(', ');
      throw new Error(
        `No matching binary found for ${platform}/${arch} (pattern: ${pattern}). ` +
        `Available assets: ${availableAssets}`
      );
    }

    return { asset, usesRosetta: false };
  }

  /**
   * Download and install the Fiber binary
   */
  async download(options: DownloadOptions = {}): Promise<BinaryInfo> {
    const {
      version,
      force = false,
      onProgress = () => {},
    } = options;

    const binaryPath = this.getBinaryPath();

    // Check if already installed
    if (!force && existsSync(binaryPath)) {
      const info = await this.getBinaryInfo();
      if (info.ready) {
        onProgress({ phase: 'installing', message: `Binary already installed at ${binaryPath}` });
        return info;
      }
    }

    // Ensure install directory exists
    if (!existsSync(this.installDir)) {
      mkdirSync(this.installDir, { recursive: true });
    }

    // Fetch release info
    onProgress({ phase: 'fetching', message: 'Fetching release information...' });
    const release = version 
      ? await this.getRelease(version)
      : await this.getLatestRelease();

    onProgress({ phase: 'fetching', message: `Found release: ${release.tag_name}` });

    // Find matching asset
    const { asset, usesRosetta } = this.findAsset(release);
    
    if (usesRosetta) {
      onProgress({ 
        phase: 'downloading', 
        message: `No ARM64 binary available, using x86_64 version with Rosetta 2...` 
      });
    }
    
    onProgress({ phase: 'downloading', message: `Downloading ${asset.name}...`, percent: 0 });

    // Download the asset
    const response = await fetch(asset.browser_download_url, {
      headers: { 'User-Agent': 'fiber-pay' },
    });

    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }

    const contentLength = parseInt(response.headers.get('content-length') || '0');
    const tempPath = `${binaryPath}.download`;

    // Stream download with progress
    const body = response.body;
    if (!body) {
      throw new Error('No response body');
    }

    let downloaded = 0;
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      chunks.push(value);
      downloaded += value.length;
      
      if (contentLength > 0) {
        const percent = Math.round((downloaded / contentLength) * 100);
        onProgress({ 
          phase: 'downloading', 
          message: `Downloading... ${percent}%`, 
          percent 
        });
      }
    }

    const buffer = Buffer.concat(chunks);
    
    // Handle different archive formats
    onProgress({ phase: 'extracting', message: 'Extracting binary...' });

    if (asset.name.endsWith('.tar.gz') || asset.name.endsWith('.tgz')) {
      await this.extractTarGz(buffer, binaryPath);
    } else if (asset.name.endsWith('.zip')) {
      await this.extractZip(buffer, binaryPath);
    } else {
      // Direct binary
      const { writeFile } = await import('fs/promises');
      await writeFile(binaryPath, buffer);
    }

    // Make executable (Unix)
    const { platform } = this.getPlatformInfo();
    if (platform !== 'win32') {
      chmodSync(binaryPath, 0o755);
    }

    onProgress({ phase: 'installing', message: `Installed to ${binaryPath}` });

    return this.getBinaryInfo();
  }

  /**
   * Extract tar.gz archive
   */
  private async extractTarGz(buffer: Buffer, targetPath: string): Promise<void> {
    const { writeFile, readdir, rename, rm } = await import('fs/promises');
    const tempDir = `${targetPath}.extract`;
    
    // Create temp directory
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }

    // Write archive to temp file
    const archivePath = `${tempDir}/archive.tar.gz`;
    await writeFile(archivePath, buffer);

    // Extract using tar command
    try {
      await execAsync(`tar -xzf "${archivePath}" -C "${tempDir}"`);
    } catch (error) {
      // Fallback: try with gunzip + tar separately
      await execAsync(`gunzip -c "${archivePath}" | tar -xf - -C "${tempDir}"`);
    }

    // Find the binary in extracted files
    const files = await readdir(tempDir, { recursive: true });
    const binaryFile = files.find(f => {
      const name = String(f);
      return name.endsWith('fnn') || name.endsWith('fnn.exe');
    });

    if (binaryFile) {
      const sourcePath = join(tempDir, String(binaryFile));
      await rename(sourcePath, targetPath);
    } else {
      // If no fnn found, maybe the archive contains a single binary
      const extractedFiles = await readdir(tempDir);
      const possibleBinary = extractedFiles.find(f => 
        f !== 'archive.tar.gz' && !f.startsWith('.')
      );
      if (possibleBinary) {
        await rename(join(tempDir, possibleBinary), targetPath);
      }
    }

    // Cleanup temp directory
    await rm(tempDir, { recursive: true, force: true });
  }

  /**
   * Extract zip archive (primarily for Windows)
   */
  private async extractZip(buffer: Buffer, targetPath: string): Promise<void> {
    const { writeFile, readdir, rename, rm } = await import('fs/promises');
    const tempDir = `${targetPath}.extract`;
    
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }

    const archivePath = `${tempDir}/archive.zip`;
    await writeFile(archivePath, buffer);

    // Extract using unzip command
    const { platform } = this.getPlatformInfo();
    if (platform === 'win32') {
      await execAsync(`powershell -command "Expand-Archive -Path '${archivePath}' -DestinationPath '${tempDir}'"`);
    } else {
      await execAsync(`unzip -o "${archivePath}" -d "${tempDir}"`);
    }

    // Find and move the binary
    const files = await readdir(tempDir, { recursive: true });
    const binaryFile = files.find(f => {
      const name = String(f);
      return name.endsWith('fnn') || name.endsWith('fnn.exe');
    });

    if (binaryFile) {
      await rename(join(tempDir, String(binaryFile)), targetPath);
    }

    await rm(tempDir, { recursive: true, force: true });
  }

  /**
   * Remove the installed binary
   */
  async uninstall(): Promise<void> {
    const binaryPath = this.getBinaryPath();
    if (existsSync(binaryPath)) {
      unlinkSync(binaryPath);
    }
  }
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Download the Fiber binary to the default location
 */
export async function downloadFiberBinary(
  options: DownloadOptions = {}
): Promise<BinaryInfo> {
  const manager = new BinaryManager(options.installDir);
  return manager.download(options);
}

/**
 * Get information about the installed binary
 */
export async function getFiberBinaryInfo(
  installDir?: string
): Promise<BinaryInfo> {
  const manager = new BinaryManager(installDir);
  return manager.getBinaryInfo();
}

/**
 * Ensure the Fiber binary is available, downloading if necessary
 */
export async function ensureFiberBinary(
  options: DownloadOptions = {}
): Promise<string> {
  const manager = new BinaryManager(options.installDir);
  const info = await manager.getBinaryInfo();

  if (info.ready) {
    return info.path;
  }

  const downloaded = await manager.download(options);
  return downloaded.path;
}

/**
 * Get the default binary path
 */
export function getDefaultBinaryPath(): string {
  const manager = new BinaryManager();
  return manager.getBinaryPath();
}
