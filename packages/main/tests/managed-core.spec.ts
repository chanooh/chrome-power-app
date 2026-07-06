import {mkdtempSync, rmSync, writeFileSync, mkdirSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

const execFileSyncMock = vi.fn();

vi.mock('child_process', () => ({
  execFileSync: execFileSyncMock,
}));

describe('managed Chromium core', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'chrome-power-managed-core-'));
    execFileSyncMock.mockReset();
    execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'diskutil' && args[0] === 'info') {
        return 'Mounted: Yes\nMount Point: /Volumes/F\nFile System Personality: APFS\n';
      }
      if (args[0] === '--version') {
        return 'Chromium 150.0.7871.47\n';
      }
      return '';
    });
  });

  afterEach(() => {
    rmSync(tempDir, {recursive: true, force: true});
  });

  test('resolves a manifest-backed managed Chromium executable', async () => {
    const {
      computeFileSha256,
      getDefaultManagedBrowserExecutablePath,
      getDefaultManagedBrowserManifestPath,
      resolveManagedBrowserCore,
    } = await import('../src/browser-core/managed-core');
    const executablePath = getDefaultManagedBrowserExecutablePath(tempDir);
    const manifestPath = getDefaultManagedBrowserManifestPath(tempDir);
    mkdirSync(join(executablePath, '..'), {recursive: true});
    writeFileSync(executablePath, 'fake chromium');
    writeFileSync(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        kind: 'chromium',
        version: '150.0.7871.47',
        tag: '150.0.7871.47',
        commit: '0c3cca15d78645281db2d339b2dc3d6fad4ee90a',
        arch: 'mac-arm64',
        platform: 'darwin',
        executablePath,
        gnArgs: [],
        depotToolsCommit: '1b1b01fa912786b88a79f3504176a275183839b5',
        fingerprintEngineVersion: 'native-macos-v2',
        patchsetVersion: 'native-fingerprint-kernel-v1',
        chromiumPatchsetSha256: '1'.repeat(64),
        executableSha256: computeFileSha256(executablePath),
        builtAt: '2026-07-04T00:00:00.000Z',
      }),
    );

    const resolved = resolveManagedBrowserCore({
      rootPath: tempDir,
      manifestPath,
    });

    expect(resolved.executablePath).toBe(executablePath);
    expect(resolved.manifest.version).toBe('150.0.7871.47');
  });

  test('rejects an unmounted F volume', async () => {
    const {resolveManagedBrowserCore} = await import('../src/browser-core/managed-core');
    execFileSyncMock.mockImplementationOnce(() => 'Mounted: No\n');

    expect(() =>
      resolveManagedBrowserCore({
        rootPath: tempDir,
        verifyHash: false,
        verifyVersion: false,
      }),
    ).toThrow('/Volumes/F');
  });

  test('rejects a mismatched executable hash', async () => {
    const {
      getDefaultManagedBrowserExecutablePath,
      getDefaultManagedBrowserManifestPath,
      resolveManagedBrowserCore,
    } = await import('../src/browser-core/managed-core');
    const executablePath = getDefaultManagedBrowserExecutablePath(tempDir);
    const manifestPath = getDefaultManagedBrowserManifestPath(tempDir);
    mkdirSync(join(executablePath, '..'), {recursive: true});
    writeFileSync(executablePath, 'fake chromium');
    writeFileSync(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        kind: 'chromium',
        version: '150.0.7871.47',
        tag: '150.0.7871.47',
        commit: '0c3cca15d78645281db2d339b2dc3d6fad4ee90a',
        arch: 'mac-arm64',
        platform: 'darwin',
        executablePath,
        gnArgs: [],
        depotToolsCommit: '1b1b01fa912786b88a79f3504176a275183839b5',
        fingerprintEngineVersion: 'native-macos-v2',
        patchsetVersion: 'native-fingerprint-kernel-v1',
        chromiumPatchsetSha256: '1'.repeat(64),
        executableSha256: '0'.repeat(64),
        builtAt: '2026-07-04T00:00:00.000Z',
      }),
    );

    expect(() =>
      resolveManagedBrowserCore({
        rootPath: tempDir,
        manifestPath,
      }),
    ).toThrow('hash mismatch');
  });
});
