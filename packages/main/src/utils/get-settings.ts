import {existsSync, readFileSync, writeFileSync, mkdirSync} from 'fs';
import {join} from 'path';
import type {SettingOptions} from '../../../shared/types/common';
import {getChromePath} from '../fingerprint/device';
import {app} from 'electron';
import {CONFIG_FILE_PATH} from '../constants';
import {
  getDefaultManagedBrowserExecutablePath,
  getDefaultManagedBrowserManifestPath,
  isMountedVolume,
  MANAGED_BROWSER_CORE_ROOT,
  MANAGED_BROWSER_PROFILE_ROOT,
  MANAGED_BROWSER_VOLUME_PATH,
  MANAGED_CHROMIUM_VERSION,
} from '../browser-core/managed-core';

const MACOS_PROFILE_VOLUME_PATH = MANAGED_BROWSER_VOLUME_PATH;
const MACOS_PROFILE_CACHE_PATH = MANAGED_BROWSER_PROFILE_ROOT;

const isMacProfileCachePath = (profileCachePath: string) =>
  profileCachePath === MACOS_PROFILE_VOLUME_PATH ||
  profileCachePath.startsWith(`${MACOS_PROFILE_VOLUME_PATH}/`);

export const ensureProfileCachePath = (profileCachePath: string) => {
  if (
    process.platform === 'darwin' &&
    isMacProfileCachePath(profileCachePath) &&
    !isMountedVolume(MACOS_PROFILE_VOLUME_PATH)
  ) {
    throw new Error(`Profile cache volume is not mounted: ${MACOS_PROFILE_VOLUME_PATH}`);
  }

  if (!existsSync(profileCachePath)) {
    mkdirSync(profileCachePath, {recursive: true, mode: 0o755});
  }
};

const getDefaultSettings = (): SettingOptions => {
  const isMac = process.platform === 'darwin';
  const defaultCachePath = isMac ? MACOS_PROFILE_CACHE_PATH : join(app.getPath('appData'), 'ChromePowerCache');

  return {
    profileCachePath: defaultCachePath,
    browserMode: isMac ? 'managed' : 'local',
    managedBrowserRoot: MANAGED_BROWSER_CORE_ROOT,
    managedBrowserVersion: MANAGED_CHROMIUM_VERSION,
    managedBrowserManifestPath: getDefaultManagedBrowserManifestPath(),
    useLocalChrome: !isMac,
    localChromePath: '',
    chromiumBinPath: isMac ? getDefaultManagedBrowserExecutablePath() : '',
    automationConnect: false,
  };
};

export const normalizeSettings = (rawSettings: Partial<SettingOptions> = {}): SettingOptions => {
  const defaults = getDefaultSettings();
  const browserMode = rawSettings.browserMode === 'local' ? 'local' : defaults.browserMode;
  const managedBrowserRoot = rawSettings.managedBrowserRoot || defaults.managedBrowserRoot;
  const settings = {
    ...defaults,
    ...rawSettings,
    browserMode,
    managedBrowserRoot,
    managedBrowserVersion: rawSettings.managedBrowserVersion || defaults.managedBrowserVersion,
    managedBrowserManifestPath: rawSettings.managedBrowserManifestPath || getDefaultManagedBrowserManifestPath(managedBrowserRoot),
  };

  settings.useLocalChrome = settings.browserMode === 'local';
  if (settings.browserMode === 'managed') {
    settings.chromiumBinPath = getDefaultManagedBrowserExecutablePath(settings.managedBrowserRoot);
  }

  return settings;
};

export const getSettings = (): SettingOptions => {
  const configFilePath = CONFIG_FILE_PATH;
  const isMac = process.platform === 'darwin';
  const legacyMacCachePath = `${app.getPath('documents')}/ChromePowerCache`;
  const defaultSettings = getDefaultSettings();
  let settings = defaultSettings;

  try {
    if (existsSync(configFilePath)) {
      const fileContent = readFileSync(configFilePath, 'utf8');
      const parsedSettings = JSON.parse(fileContent) as Partial<SettingOptions>;
      settings = normalizeSettings(parsedSettings);
      if (isMac && settings.profileCachePath === legacyMacCachePath) {
        settings.profileCachePath = defaultSettings.profileCachePath;
      }
      if (JSON.stringify(parsedSettings) !== JSON.stringify(settings)) {
        writeFileSync(configFilePath, JSON.stringify(settings), 'utf8');
      }
    } else {
      ensureProfileCachePath(defaultSettings.profileCachePath);
      writeFileSync(configFilePath, JSON.stringify(settings), 'utf8');
    }

    ensureProfileCachePath(settings.profileCachePath);
  } catch (error) {
    console.error('Error handling the settings file:', error);
  }

  if (!settings.localChromePath) {
    settings.localChromePath = getChromePath() as string;
  }
  if (
    settings.browserMode === 'local' &&
    (!settings.chromiumBinPath || settings.chromiumBinPath === 'Chrome-bin\\chrome.exe')
  ) {
    if (import.meta.env.DEV) {
      settings.chromiumBinPath = 'Chrome-bin\\chrome.exe';
    } else {
      settings.chromiumBinPath = join(process.resourcesPath, 'Chrome-bin', 'chrome.exe');
    }
  }
  return settings;
};
