import {mkdtempSync, rmSync, statSync, writeFileSync, mkdirSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath() {
      return '/tmp/chrome-power-test';
    },
  },
  shell: {
    trashItem: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock('../src/fingerprint/device', () => ({
  getChromePath: () => '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
}));

describe('profile storage', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'chrome-power-profile-storage-'));
  });

  afterEach(() => {
    rmSync(tempDir, {recursive: true, force: true});
  });

  test('rejects profile ids that escape the managed cache root', async () => {
    const {resolveManagedProfilePath} = await import('../src/profile/storage');

    expect(() => resolveManagedProfilePath('../escape', tempDir)).toThrow('Invalid profile_id');
    expect(() => resolveManagedProfilePath('nested/profile', tempDir)).toThrow('Invalid profile_id');
  });

  test('creates managed profile directories with 0700 permissions', async () => {
    const {ensureManagedProfileDirectory} = await import('../src/profile/storage');
    const profilePath = ensureManagedProfileDirectory('profile-alpha', tempDir);

    expect(profilePath).toContain('managed-chromium/150.0.7871.47/profile-alpha');
    expect(`0${(statSync(profilePath).mode & 0o777).toString(8)}`).toBe('0700');
  });

  test('reports profile storage status and scans orphan profiles', async () => {
    const {
      ensureManagedProfileDirectory,
      getProfileStorageStatus,
      scanOrphanProfiles,
    } = await import('../src/profile/storage');

    const activePath = ensureManagedProfileDirectory('active-profile', tempDir);
    const orphanPath = ensureManagedProfileDirectory('orphan-profile', tempDir);
    mkdirSync(join(activePath, 'Default'), {recursive: true});
    writeFileSync(join(activePath, 'Default', 'Cookies'), 'cookie-data');
    writeFileSync(join(orphanPath, 'Preferences'), '{}');

    const status = getProfileStorageStatus(
      {id: 1, profile_id: 'active-profile', status: 1},
      tempDir,
    );
    const orphans = scanOrphanProfiles(['active-profile'], tempDir);

    expect(status.exists).toBe(true);
    expect(status.permissions).toBe('0700');
    expect(status.sizeBytes).toBeGreaterThan(0);
    expect(orphans.map(profile => profile.profileId)).toEqual(['orphan-profile']);
  });

  test('creates backup manifests without proxy secrets or runtime process state', async () => {
    const {createProfileBackupManifest} = await import('../src/profile/backup');

    const manifest = createProfileBackupManifest({
      id: 10,
      profile_id: 'profile-alpha',
      name: 'Profile Alpha',
      proxy_id: 3,
      proxy: '127.0.0.1:8080:user:******',
      proxy_type: 'HTTP',
      pid: 12345,
      port: 9222,
      status: 2,
      fingerprint: JSON.stringify({schemaVersion: 2, profileId: 'profile-alpha'}),
    });

    expect(manifest.kind).toBe('chrome-power-profile');
    expect(manifest.profileId).toBe('profile-alpha');
    expect(JSON.stringify(manifest)).not.toContain('12345');
    expect(JSON.stringify(manifest)).not.toContain('secret');
    expect(manifest.proxy?.proxy).toBe('127.0.0.1:8080:user:******');
  });
});
