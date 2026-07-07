import {ipcMain} from 'electron';
import type {RpaRecorderOptions, RpaRunOptions, RpaTask} from '../../../shared/types/rpa';
import {RpaDB} from '../db/rpa';
import {rpaRecorder} from '../rpa/recorder';
import {rpaScheduler} from '../rpa/scheduler';
import {validateRpaTask} from '../rpa/validation';
import {createLogger} from '../../../shared/utils/logger';
import {SERVICE_LOGGER_LABEL} from '../constants';

const logger = createLogger(SERVICE_LOGGER_LABEL);

const safeInvoke = async <T>(fn: () => Promise<T>) => {
  try {
    return await fn();
  } catch (error) {
    logger.error('RPA service error', error);
    throw error;
  }
};

export const initRpaService = () => {
  logger.info('init rpa service...');

  ipcMain.handle('rpa-task-list', async () => safeInvoke(() => RpaDB.listTasks()));

  ipcMain.handle('rpa-task-create', async (_, task: RpaTask) =>
    safeInvoke(async () => RpaDB.createTask(task)),
  );

  ipcMain.handle('rpa-task-update', async (_, id: number, patch: Partial<RpaTask>) =>
    safeInvoke(async () => RpaDB.updateTask(id, patch)),
  );

  ipcMain.handle('rpa-task-delete', async (_, id: number) =>
    safeInvoke(async () => RpaDB.deleteTask(id)),
  );

  ipcMain.handle('rpa-task-validate', async (_, task: Partial<RpaTask>) =>
    safeInvoke(async () => validateRpaTask(task)),
  );

  ipcMain.handle('rpa-run-start', async (_, taskId: number, options?: RpaRunOptions) =>
    safeInvoke(async () => rpaScheduler.startRun(taskId, options || {})),
  );

  ipcMain.handle('rpa-run-pause', async (_, runId: number) =>
    safeInvoke(async () => rpaScheduler.pauseRun(runId)),
  );

  ipcMain.handle('rpa-run-resume', async (_, runId: number) =>
    safeInvoke(async () => rpaScheduler.resumeRun(runId)),
  );

  ipcMain.handle('rpa-run-stop', async (_, runId: number) =>
    safeInvoke(async () => rpaScheduler.stopRun(runId)),
  );

  ipcMain.handle('rpa-run-get', async (_, runId: number) =>
    safeInvoke(async () => RpaDB.getRun(runId)),
  );

  ipcMain.handle('rpa-run-list', async (_, taskId?: number) =>
    safeInvoke(async () => RpaDB.listRuns(taskId)),
  );

  ipcMain.handle('rpa-recorder-start', async (_, windowId: number, options?: RpaRecorderOptions) =>
    safeInvoke(async () => rpaRecorder.startRecorder(windowId, options || {})),
  );

  ipcMain.handle('rpa-recorder-stop', async (_, sessionId: string) =>
    safeInvoke(async () => rpaRecorder.stopRecorder(sessionId)),
  );
};
