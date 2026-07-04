import {existsSync, readFileSync, writeFileSync, mkdirSync} from 'fs';
import {join} from 'path';
import {execFileSync} from 'child_process';
import type {SettingOptions} from '../../../shared/types/common';
import {getChromePath} from '../fingerprint/device';
import {app} from 'electron';
import {CONFIG_FILE_PATH} from '../constants';

const MACOS_PROFILE_VOLUME_PATH = '/Volumes/F';
const MACOS_PROFILE_CACHE_PATH = '/Volumes/F/ChromePowerCache';

const isMacProfileCachePath = (profileCachePath: string) =>
  profileCachePath === MACOS_PROFILE_VOLUME_PATH ||
  profileCachePath.startsWith(`${MACOS_PROFILE_VOLUME_PATH}/`);

const isMountedVolume = (volumePath: string) => {
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

export const getSettings = (): SettingOptions => {
  const configFilePath = CONFIG_FILE_PATH;
  const isMac = process.platform === 'darwin';
  const legacyMacCachePath = `${app.getPath('documents')}/ChromePowerCache`;
  const defaultCachePath = isMac ? MACOS_PROFILE_CACHE_PATH : join(app.getPath('appData'), 'ChromePowerCache');
  let settings = {
    profileCachePath: defaultCachePath,
    useLocalChrome: true,
    localChromePath: '',
    chromiumBinPath: '',
    automationConnect: false,
  };

  try {
    if (existsSync(configFilePath)) {
      const fileContent = readFileSync(configFilePath, 'utf8');
      settings = JSON.parse(fileContent);
      if (isMac && settings.profileCachePath === legacyMacCachePath) {
        settings.profileCachePath = defaultCachePath;
        writeFileSync(configFilePath, JSON.stringify(settings), 'utf8');
      }
    } else {
      ensureProfileCachePath(defaultCachePath);
      writeFileSync(configFilePath, JSON.stringify(settings), 'utf8');
    }

    ensureProfileCachePath(settings.profileCachePath);
  } catch (error) {
    console.error('Error handling the settings file:', error);
  }

  if (!settings.localChromePath) {
    settings.localChromePath = getChromePath() as string;
  }
  settings.useLocalChrome = true;
  if (!settings.chromiumBinPath || settings.chromiumBinPath === 'Chrome-bin\\chrome.exe') {
    if (import.meta.env.DEV) {
      settings.chromiumBinPath = 'Chrome-bin\\chrome.exe';
    } else {
      settings.chromiumBinPath = join(process.resourcesPath, 'Chrome-bin', 'chrome.exe');
    }
  }
  return settings;
};
