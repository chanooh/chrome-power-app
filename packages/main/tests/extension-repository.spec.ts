import {execFileSync} from 'child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

const mockState = vi.hoisted(() => ({
  profileCachePath: '',
}));

vi.mock('../src/utils/get-settings', () => ({
  getSettings: () => ({
    profileCachePath: mockState.profileCachePath,
  }),
  ensureProfileCachePath: (path: string) => mkdirSync(path, {recursive: true}),
}));

const writeExtensionSource = (root: string, version: string, updateUrl = true) => {
  mkdirSync(root, {recursive: true});
  writeFileSync(
    join(root, 'manifest.json'),
    JSON.stringify(
      {
        manifest_version: 3,
        name: 'Local Test Extension',
        version,
        description: 'test extension',
        permissions: ['storage'],
        host_permissions: ['https://example.com/*'],
        ...(updateUrl ? {update_url: 'https://clients2.google.com/service/update2/crx'} : {}),
      },
      null,
      2,
    ),
    'utf8',
  );
  writeFileSync(join(root, 'background.js'), `globalThis.version = "${version}";`, 'utf8');
};

describe('extension repository', () => {
  let tempDir: string;
  let cacheDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'chrome-power-extension-repo-'));
    cacheDir = join(tempDir, 'cache');
    mockState.profileCachePath = cacheDir;
  });

  afterEach(() => {
    rmSync(tempDir, {recursive: true, force: true});
  });

  test('imports an unpacked directory into current and removes update_url', async () => {
    const sourceDir = join(tempDir, 'source');
    writeExtensionSource(sourceDir, '1.0.0');
    const {importExtensionToRepository, verifyExtensionRepository} = await import(
      '../src/extensions/repository'
    );

    const result = await importExtensionToRepository(sourceDir, {id: 42} as never);

    expect(result.success).toBe(true);
    expect(result.path).toBe(join(cacheDir, 'extensions', 'extension-42', 'current'));
    expect(result.version).toBe('1.0.0');
    expect(result.manifest?.update_url_removed).toBe(true);
    expect(JSON.parse(readFileSync(join(result.path!, 'manifest.json'), 'utf8')).update_url).toBeUndefined();
    expect(verifyExtensionRepository(result.extension as never).success).toBe(true);
  });

  test('detects extension file tampering through sha256', async () => {
    const sourceDir = join(tempDir, 'source');
    writeExtensionSource(sourceDir, '1.0.0', false);
    const {importExtensionToRepository, verifyExtensionRepository} = await import(
      '../src/extensions/repository'
    );
    const result = await importExtensionToRepository(sourceDir, {id: 43} as never);

    writeFileSync(join(result.path!, 'background.js'), 'tampered', 'utf8');
    const verification = verifyExtensionRepository(result.extension as never);

    expect(verification.success).toBe(false);
    expect(verification.message).toContain('hash mismatch');
  });

  test('updates in place and keeps the same current path', async () => {
    const v1 = join(tempDir, 'v1');
    const v2 = join(tempDir, 'v2');
    writeExtensionSource(v1, '1.0.0', false);
    writeExtensionSource(v2, '2.0.0', false);
    const {importExtensionToRepository} = await import('../src/extensions/repository');

    const first = await importExtensionToRepository(v1, {id: 44} as never);
    const second = await importExtensionToRepository(v2, {
      id: 44,
      extension_uid: first.extension.extension_uid,
      current_path: first.currentPath,
      repository_path: first.repositoryPath,
    } as never);

    expect(second.success).toBe(true);
    expect(second.currentPath).toBe(first.currentPath);
    expect(second.sha256).not.toBe(first.sha256);
    expect(JSON.parse(readFileSync(join(second.currentPath!, 'manifest.json'), 'utf8')).version).toBe('2.0.0');
  });

  test('imports a zip package with a nested manifest', async () => {
    const nestedRoot = join(tempDir, 'zip-root', 'nested-extension');
    writeExtensionSource(nestedRoot, '3.0.0');
    const zipPath = join(tempDir, 'extension.zip');
    execFileSync('ditto', ['-c', '-k', join(tempDir, 'zip-root'), zipPath]);
    expect(existsSync(zipPath)).toBe(true);
    const {importExtensionToRepository} = await import('../src/extensions/repository');

    const result = await importExtensionToRepository(zipPath, {id: 45} as never);

    expect(result.success).toBe(true);
    expect(result.version).toBe('3.0.0');
    expect(existsSync(join(result.currentPath!, 'manifest.json'))).toBe(true);
  });
});
