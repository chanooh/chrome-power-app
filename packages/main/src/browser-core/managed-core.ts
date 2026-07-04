import {createHash} from 'crypto';
import {execFileSync} from 'child_process';
import {existsSync, readFileSync, statSync} from 'fs';
import {join} from 'path';
import type {ManagedBrowserCoreStatus} from '../../../shared/types/common';

export const MANAGED_BROWSER_VOLUME_PATH = '/Volumes/F';
export const MANAGED_BROWSER_BUILD_ROOT = join(MANAGED_BROWSER_VOLUME_PATH, 'ChromePowerBuild');
export const MANAGED_BROWSER_CORE_ROOT = join(MANAGED_BROWSER_VOLUME_PATH, 'ChromePowerCore');
export const MANAGED_BROWSER_PROFILE_ROOT = join(MANAGED_BROWSER_VOLUME_PATH, 'ChromePowerCache');

export const MANAGED_CHROMIUM_VERSION = '150.0.7871.47';
export const MANAGED_CHROMIUM_TAG = '150.0.7871.47';
export const MANAGED_CHROMIUM_COMMIT = '0c3cca15d78645281db2d339b2dc3d6fad4ee90a';
export const MANAGED_CHROMIUM_ARCH = 'mac-arm64';

export const getManagedChromiumVersionDir = (rootPath = MANAGED_BROWSER_CORE_ROOT) =>
  join(rootPath, 'chromium', MANAGED_CHROMIUM_VERSION, MANAGED_CHROMIUM_ARCH);

export const getDefaultManagedBrowserManifestPath = (rootPath = MANAGED_BROWSER_CORE_ROOT) =>
  join(getManagedChromiumVersionDir(rootPath), 'manifest.json');

export const getDefaultManagedBrowserExecutablePath = (rootPath = MANAGED_BROWSER_CORE_ROOT) =>
  join(
    getManagedChromiumVersionDir(rootPath),
    'Chromium.app',
    'Contents',
    'MacOS',
    'Chromium',
  );

export interface ManagedBrowserManifest {
  schemaVersion: 1;
  kind: 'chromium';
  version: string;
  tag: string;
  commit: string;
  arch: 'mac-arm64';
  platform: 'darwin';
  executablePath: string;
  gnArgs: string[];
  depotToolsCommit: string;
  executableSha256: string;
  builtAt: string;
}

export interface ResolveManagedBrowserOptions {
  rootPath?: string;
  manifestPath?: string;
  verifyHash?: boolean;
  verifyVersion?: boolean;
}

export interface ResolvedManagedBrowserCore {
  manifest: ManagedBrowserManifest;
  manifestPath: string;
  executablePath: string;
}

export const isMountedVolume = (volumePath: string) => {
  try {
    const output = execFileSync('diskutil', ['info', volumePath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return /Mounted:\s+Yes/.test(output) && new RegExp(`Mount Point:\\s+${volumePath}`).test(output);
  } catch {
    return false;
  }
};

export const computeFileSha256 = (filePath: string) => {
  const hash = createHash('sha256');
  hash.update(readFileSync(filePath));
  return hash.digest('hex');
};

export const loadManagedBrowserManifest = (manifestPath = getDefaultManagedBrowserManifestPath()) => {
  if (!existsSync(manifestPath)) {
    throw new Error(`Managed Chromium manifest not found: ${manifestPath}`);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ManagedBrowserManifest;
  validateManagedBrowserManifest(manifest, manifestPath);
  return manifest;
};

export const validateManagedBrowserManifest = (
  manifest: ManagedBrowserManifest,
  manifestPath = getDefaultManagedBrowserManifestPath(),
) => {
  const expectedExecutable = getDefaultManagedBrowserExecutablePath(
    manifestPath.split('/chromium/')[0] || MANAGED_BROWSER_CORE_ROOT,
  );

  if (manifest.schemaVersion !== 1) {
    throw new Error(`Unsupported managed Chromium manifest schema: ${manifest.schemaVersion}`);
  }
  if (manifest.kind !== 'chromium') {
    throw new Error(`Unsupported managed browser kind: ${manifest.kind}`);
  }
  if (manifest.version !== MANAGED_CHROMIUM_VERSION) {
    throw new Error(`Managed Chromium version mismatch: ${manifest.version}`);
  }
  if (manifest.tag !== MANAGED_CHROMIUM_TAG) {
    throw new Error(`Managed Chromium tag mismatch: ${manifest.tag}`);
  }
  if (manifest.commit !== MANAGED_CHROMIUM_COMMIT) {
    throw new Error(`Managed Chromium commit mismatch: ${manifest.commit}`);
  }
  if (manifest.arch !== MANAGED_CHROMIUM_ARCH) {
    throw new Error(`Managed Chromium arch mismatch: ${manifest.arch}`);
  }
  if (manifest.platform !== 'darwin') {
    throw new Error(`Managed Chromium platform mismatch: ${manifest.platform}`);
  }
  if (!manifest.executablePath || manifest.executablePath !== expectedExecutable) {
    throw new Error(`Managed Chromium executable path mismatch: ${manifest.executablePath}`);
  }
  if (!manifest.executableSha256 || !/^[a-f0-9]{64}$/i.test(manifest.executableSha256)) {
    throw new Error('Managed Chromium executable sha256 is missing or invalid');
  }
};

export const verifyManagedBrowserVersion = (executablePath: string) => {
  const output = execFileSync(executablePath, ['--version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

  if (!output.includes(MANAGED_CHROMIUM_VERSION)) {
    throw new Error(`Managed Chromium version output mismatch: ${output}`);
  }

  return output;
};

export const resolveManagedBrowserCore = (
  options: ResolveManagedBrowserOptions = {},
): ResolvedManagedBrowserCore => {
  if (process.platform !== 'darwin') {
    throw new Error('Managed Chromium core is only supported on macOS');
  }
  if (!isMountedVolume(MANAGED_BROWSER_VOLUME_PATH)) {
    throw new Error(`Managed Chromium volume is not mounted: ${MANAGED_BROWSER_VOLUME_PATH}`);
  }

  const rootPath = options.rootPath || MANAGED_BROWSER_CORE_ROOT;
  const manifestPath = options.manifestPath || getDefaultManagedBrowserManifestPath(rootPath);
  const manifest = loadManagedBrowserManifest(manifestPath);
  const executablePath = manifest.executablePath;

  if (!existsSync(executablePath) || !statSync(executablePath).isFile()) {
    throw new Error(`Managed Chromium executable not found: ${executablePath}`);
  }

  if (options.verifyHash !== false) {
    const hash = computeFileSha256(executablePath);
    if (hash !== manifest.executableSha256) {
      throw new Error(`Managed Chromium executable hash mismatch: ${executablePath}`);
    }
  }

  if (options.verifyVersion !== false) {
    verifyManagedBrowserVersion(executablePath);
  }

  return {
    manifest,
    manifestPath,
    executablePath,
  };
};

export const getManagedBrowserCoreStatus = (
  options: ResolveManagedBrowserOptions = {},
): ManagedBrowserCoreStatus => {
  const rootPath = options.rootPath || MANAGED_BROWSER_CORE_ROOT;
  const manifestPath = options.manifestPath || getDefaultManagedBrowserManifestPath(rootPath);
  const executablePath = getDefaultManagedBrowserExecutablePath(rootPath);
  const baseStatus = {
    available: false,
    version: MANAGED_CHROMIUM_VERSION,
    rootPath,
    manifestPath,
    executablePath,
    mounted: isMountedVolume(MANAGED_BROWSER_VOLUME_PATH),
    manifestExists: existsSync(manifestPath),
    executableExists: existsSync(executablePath),
    hashVerified: false,
    versionVerified: false,
    message: '',
  };

  try {
    const resolved = resolveManagedBrowserCore({
      rootPath,
      manifestPath,
      verifyHash: options.verifyHash,
      verifyVersion: options.verifyVersion,
    });
    return {
      ...baseStatus,
      available: true,
      hashVerified: options.verifyHash === false ? true : true,
      versionVerified: options.verifyVersion === false ? true : true,
      executablePath: resolved.executablePath,
      message: 'Managed Chromium core is ready',
    };
  } catch (error) {
    return {
      ...baseStatus,
      message: (error as Error).message,
    };
  }
};
