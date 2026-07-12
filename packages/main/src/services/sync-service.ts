import {app, ipcMain} from 'electron';
import path from 'path';
import type {SafeAny} from '../../../shared/types/db';
import {createLogger} from '../../../shared/utils/logger';
import {MAIN_LOGGER_LABEL} from '../constants';
const logger = createLogger(MAIN_LOGGER_LABEL);
let addon: unknown;
if (!app.isPackaged) {
  // 开发环境：直接从构建目录加载
  addon = require(path.join(__dirname, '../src/native-addon/build/Release/', 'window-addon.node'));
} else {
  // 生产环境：根据平台和架构选择正确路径
  // const addonDir = `${process.platform}-${process.arch}`;

  const addonPath = path.join(
    process.resourcesPath,
    'app.asar.unpacked/node_modules/window-addon/',
    'window-addon.node',
  );

  try {
    addon = require(addonPath);
  } catch (error) {
    logger.error('Failed to load addon:', error);
    logger.error('Attempted path:', addonPath);
    logger.error('Platform and arch:', process.platform, process.arch);
  }
}

export const initSyncService = () => {
  if (!addon) {
    logger.error('Window addon not loaded properly', process.resourcesPath);
    return;
  }

  const windowManager = new (addon as SafeAny).WindowManager();

  logger.info('WindowManager initialized');

  ipcMain.handle('window-arrange', async (_, args) => {
    const {mainPid, childPids, columns, size, spacing, monitorIndex} = args;
    logger.info('Arranging windows', {mainPid, childPids, columns, size, spacing, monitorIndex});
    try {
      if (!windowManager) {
        logger.error('WindowManager not initialized');
        throw new Error('WindowManager not initialized');
      }
      logger.info('arrangeWindows', windowManager.arrangeWindows.toString());
      try {
        // Pass monitorIndex if provided, otherwise let native addon use default (0)
        if (monitorIndex !== undefined) {
          windowManager.arrangeWindows(mainPid, childPids, columns, size, spacing, monitorIndex);
        } else {
          windowManager.arrangeWindows(mainPid, childPids, columns, size, spacing);
        }
      } catch (e) {
        logger.error('Native function execution error:', e);
        throw e;
      }

      return {success: true};
    } catch (error) {
      logger.error('Window arrangement failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  ipcMain.handle('window-get-monitors', async () => {
    logger.info('Getting available monitors');
    try {
      if (!windowManager) {
        logger.error('WindowManager not initialized');
        throw new Error('WindowManager not initialized');
      }

      const monitors = windowManager.getMonitors();
      logger.info('Available monitors:', monitors);
      return {success: true, monitors};
    } catch (error) {
      logger.error('Failed to get monitors:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        monitors: [],
      };
    }
  });
};
