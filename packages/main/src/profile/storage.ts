import {existsSync, mkdirSync, readdirSync, statSync, chmodSync} from 'fs';
import {join, resolve, sep} from 'path';
import {shell} from 'electron';
import type {DB} from '../../../shared/types/db';
import type {OrphanProfile, ProfileStorageStatus} from '../../../shared/types/profile';
import {
  MANAGED_BROWSER_PROFILE_ROOT,
  MANAGED_CHROMIUM_VERSION,
} from '../browser-core/managed-core';
import {ensureProfileCachePath, getSettings} from '../utils/get-settings';

const PROFILE_ID_PATTERN = /^[a-zA-Z0-9._-]+$/;

export const assertSafeProfileId = (profileId?: string) => {
  if (!profileId || !PROFILE_ID_PATTERN.test(profileId) || profileId === '.' || profileId === '..') {
    throw new Error(`Invalid profile_id: ${profileId || '(empty)'}`);
  }
  return profileId;
};

export const getManagedProfileVersionRoot = (profileCachePath = getSettings().profileCachePath) =>
  resolve(profileCachePath, 'managed-chromium', MANAGED_CHROMIUM_VERSION);

export const resolveManagedProfilePath = (
  profileId: string,
  profileCachePath = getSettings().profileCachePath,
) => {
  assertSafeProfileId(profileId);
  const root = getManagedProfileVersionRoot(profileCachePath);
  const profilePath = resolve(root, profileId);
  if (profilePath !== root && profilePath.startsWith(`${root}${sep}`)) {
    return profilePath;
  }
  throw new Error(`Profile path escapes managed cache root: ${profileId}`);
};

export const ensureManagedProfileDirectory = (
  profileId: string,
  profileCachePath = getSettings().profileCachePath,
) => {
  ensureProfileCachePath(profileCachePath);
  const profilePath = resolveManagedProfilePath(profileId, profileCachePath);
  if (!existsSync(profilePath)) {
    mkdirSync(profilePath, {recursive: true, mode: 0o700});
  }
  if (process.platform === 'darwin') {
    chmodSync(profilePath, 0o700);
  }
  return profilePath;
};

export const directorySize = (path: string): number => {
  if (!existsSync(path)) return 0;
  const stat = statSync(path);
  if (stat.isSymbolicLink()) return 0;
  if (stat.isFile()) return stat.size;
  if (!stat.isDirectory()) return 0;
  return readdirSync(path).reduce((total, entry) => total + directorySize(join(path, entry)), 0);
};

export const getOctalPermissions = (path: string) => {
  if (!existsSync(path)) return undefined;
  return `0${(statSync(path).mode & 0o777).toString(8)}`;
};

export const getProfileStorageStatus = (
  windowData: DB.Window,
  profileCachePath = getSettings().profileCachePath,
): ProfileStorageStatus => {
  const profileId = assertSafeProfileId(windowData.profile_id);
  const profilePath = resolveManagedProfilePath(profileId, profileCachePath);
  const exists = existsSync(profilePath);
  const permissions = getOctalPermissions(profilePath);
  const stat = exists ? statSync(profilePath) : undefined;
  const issues: string[] = [];
  const running = windowData.status === 2;

  if (!exists) {
    issues.push('Profile directory does not exist.');
  }
  if (exists && process.platform === 'darwin' && permissions !== '0700') {
    issues.push(`Profile directory permissions are ${permissions}; expected 0700.`);
  }

  return {
    windowId: windowData.id,
    profileId,
    path: profilePath,
    exists,
    running,
    permissions,
    sizeBytes: exists ? directorySize(profilePath) : 0,
    lastModifiedAt: stat?.mtime.toISOString(),
    health: issues.length ? (exists ? 'warning' : 'error') : 'ok',
    issues,
  };
};

export const scanOrphanProfiles = (
  activeProfiles: string[],
  profileCachePath = getSettings().profileCachePath,
): OrphanProfile[] => {
  const root = getManagedProfileVersionRoot(profileCachePath);
  if (!existsSync(root)) return [];
  const active = new Set(activeProfiles);
  return readdirSync(root, {withFileTypes: true})
    .filter(entry => entry.isDirectory() && PROFILE_ID_PATTERN.test(entry.name) && !active.has(entry.name))
    .map(entry => {
      const profilePath = resolveManagedProfilePath(entry.name, profileCachePath);
      const stat = statSync(profilePath);
      return {
        profileId: entry.name,
        path: profilePath,
        sizeBytes: directorySize(profilePath),
        lastModifiedAt: stat.mtime.toISOString(),
      };
    });
};

export const trashProfileDirectory = async (
  profileId: string,
  profileCachePath = getSettings().profileCachePath,
) => {
  const profilePath = resolveManagedProfilePath(profileId, profileCachePath);
  if (existsSync(profilePath)) {
    await shell.trashItem(profilePath);
  }
  return profilePath;
};

export const getDefaultProfileCacheRoot = () =>
  join(MANAGED_BROWSER_PROFILE_ROOT, 'managed-chromium', MANAGED_CHROMIUM_VERSION);
