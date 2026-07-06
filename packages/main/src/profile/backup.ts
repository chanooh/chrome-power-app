import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import {execFileSync} from 'child_process';
import {dirname, join} from 'path';
import {tmpdir} from 'os';
import type {DB} from '../../../shared/types/db';
import type {
  ProfileBackupManifest,
  ProfileBackupResult,
  ProfileRestoreResult,
} from '../../../shared/types/profile';
import {MANAGED_CHROMIUM_VERSION} from '../browser-core/managed-core';
import {WindowDB} from '../db/window';
import {ProxyDB} from '../db/proxy';
import {parseFingerprintSnapshot} from '../fingerprint/snapshot';
import {
  assertSafeProfileId,
  ensureManagedProfileDirectory,
  getProfileStorageStatus,
  resolveManagedProfilePath,
} from './storage';

const BACKUP_KIND = 'chrome-power-profile';
const PROFILE_DIR_NAME = 'profile';

const sanitizeWindowForBackup = (windowData: DB.Window): Partial<DB.Window> => ({
  profile_id: windowData.profile_id,
  name: windowData.name,
  group_id: windowData.group_id ?? null,
  tags: windowData.tags,
  remark: windowData.remark,
  ua: windowData.ua,
  fingerprint: windowData.fingerprint,
  proxy_id: windowData.proxy_id ?? null,
});

export const createProfileBackupManifest = (windowData: DB.Window): ProfileBackupManifest => {
  const profileId = assertSafeProfileId(windowData.profile_id);
  return {
    schemaVersion: 1,
    kind: BACKUP_KIND,
    exportedAt: new Date().toISOString(),
    chromiumVersion: MANAGED_CHROMIUM_VERSION,
    profileId,
    profileDirectoryName: PROFILE_DIR_NAME,
    window: sanitizeWindowForBackup(windowData),
    fingerprint: parseFingerprintSnapshot(windowData.fingerprint) || undefined,
    proxy: windowData.proxy_id
      ? {
          id: windowData.proxy_id,
          proxy: windowData.proxy,
          proxy_type: windowData.proxy_type,
          ip: windowData.ip,
          ip_country: windowData.ip_country,
          remark: undefined,
        }
      : undefined,
  };
};

const zipDirectory = (sourceDir: string, archivePath: string) => {
  execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', sourceDir, archivePath], {
    stdio: 'pipe',
  });
};

const unzipArchive = (archivePath: string, targetDir: string) => {
  execFileSync('ditto', ['-x', '-k', archivePath, targetDir], {
    stdio: 'pipe',
  });
};

export const backupProfileToArchive = async (
  windowId: number,
  archivePath: string,
): Promise<ProfileBackupResult> => {
  const windowData = await WindowDB.getById(windowId);
  if (!windowData) {
    return {success: false, message: `Window ${windowId} not found.`};
  }
  if (windowData.status === 2) {
    return {success: false, message: 'Close the profile before creating a backup.'};
  }

  const status = getProfileStorageStatus(windowData);
  if (!status.exists) {
    return {success: false, message: 'Profile directory does not exist.'};
  }

  const tempDir = mkdtempSync(join(tmpdir(), 'chrome-power-profile-backup-'));
  try {
    const manifest = createProfileBackupManifest(windowData);
    writeFileSync(join(tempDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    cpSync(status.path, join(tempDir, PROFILE_DIR_NAME), {
      recursive: true,
      force: true,
      errorOnExist: false,
    });
    zipDirectory(tempDir, archivePath);
    return {
      success: true,
      message: 'Profile backup created successfully.',
      archivePath,
      manifest,
    };
  } finally {
    rmSync(tempDir, {recursive: true, force: true});
  }
};

export const readProfileBackupManifest = (extractedDir: string): ProfileBackupManifest => {
  const manifestPath = join(extractedDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error('Backup manifest.json is missing.');
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ProfileBackupManifest;
  if (manifest.schemaVersion !== 1 || manifest.kind !== BACKUP_KIND) {
    throw new Error('Unsupported profile backup format.');
  }
  if (manifest.chromiumVersion !== MANAGED_CHROMIUM_VERSION) {
    throw new Error(
      `Backup Chromium version ${manifest.chromiumVersion} does not match ${MANAGED_CHROMIUM_VERSION}.`,
    );
  }
  assertSafeProfileId(manifest.profileId);
  return manifest;
};

export const restoreProfileFromArchive = async (
  archivePath: string,
): Promise<ProfileRestoreResult> => {
  if (!existsSync(archivePath)) {
    return {success: false, message: 'Backup archive does not exist.'};
  }

  const tempDir = mkdtempSync(join(tmpdir(), 'chrome-power-profile-restore-'));
  let copiedTargetPath: string | undefined;
  try {
    unzipArchive(archivePath, tempDir);
    const manifest = readProfileBackupManifest(tempDir);
    const profileSource = join(tempDir, manifest.profileDirectoryName);
    if (!existsSync(profileSource)) {
      return {success: false, message: 'Backup profile directory is missing.'};
    }

    const existingRows = await WindowDB.find({profile_id: manifest.profileId});
    if (existingRows.length > 0) {
      return {
        success: false,
        message: `Profile ${manifest.profileId} already exists locally.`,
        profileId: manifest.profileId,
      };
    }

    const targetPath = resolveManagedProfilePath(manifest.profileId);
    if (existsSync(targetPath)) {
      return {
        success: false,
        message: `Profile directory already exists: ${targetPath}`,
        profileId: manifest.profileId,
      };
    }

    mkdirSync(dirname(targetPath), {recursive: true, mode: 0o700});
    cpSync(profileSource, targetPath, {
      recursive: true,
      force: true,
      errorOnExist: false,
    });
    copiedTargetPath = targetPath;
    ensureManagedProfileDirectory(manifest.profileId);

    let proxyId = manifest.window.proxy_id ?? null;
    if (proxyId) {
      const proxy = await ProxyDB.getById(proxyId);
      if (!proxy) {
        proxyId = null;
      }
    }

    const restoredWindow: DB.Window = {
      name: manifest.window.name || manifest.profileId,
      group_id: manifest.window.group_id ?? null,
      tags: manifest.window.tags ?? null,
      remark: manifest.window.remark,
      ua: manifest.window.ua,
      fingerprint: manifest.window.fingerprint,
      profile_id: manifest.profileId,
      proxy_id: proxyId,
      status: 1,
    };

    const result = await WindowDB.create(restoredWindow, manifest.fingerprint);
    if (!result.success || !result.data?.id) {
      rmSync(targetPath, {recursive: true, force: true});
      copiedTargetPath = undefined;
      return {success: false, message: result.message || 'Failed to restore profile.'};
    }
    copiedTargetPath = undefined;

    return {
      success: true,
      message: 'Profile restored successfully.',
      windowId: result.data.id,
      profileId: manifest.profileId,
    };
  } catch (error) {
    if (copiedTargetPath) {
      rmSync(copiedTargetPath, {recursive: true, force: true});
    }
    return {
      success: false,
      message: (error as Error).message,
    };
  } finally {
    rmSync(tempDir, {recursive: true, force: true});
  }
};
