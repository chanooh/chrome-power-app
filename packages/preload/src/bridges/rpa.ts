import type {IpcRendererEvent} from 'electron';
import {ipcRenderer} from 'electron';
import type {
  RpaRecorderEvent,
  RpaRecorderOptions,
  RpaRecorderSession,
  RpaRun,
  RpaRunOptions,
  RpaTask,
  RpaValidationResult,
} from '../../../shared/types/rpa';

export const RpaBridge = {
  listTasks(): Promise<RpaTask[]> {
    return ipcRenderer.invoke('rpa-task-list');
  },

  createTask(task: RpaTask): Promise<RpaTask> {
    return ipcRenderer.invoke('rpa-task-create', task);
  },

  updateTask(id: number, patch: Partial<RpaTask>): Promise<RpaTask> {
    return ipcRenderer.invoke('rpa-task-update', id, patch);
  },

  deleteTask(id: number): Promise<{success: boolean; message: string}> {
    return ipcRenderer.invoke('rpa-task-delete', id);
  },

  validateTask(task: Partial<RpaTask>): Promise<RpaValidationResult> {
    return ipcRenderer.invoke('rpa-task-validate', task);
  },

  startRun(taskId: number, options?: RpaRunOptions): Promise<RpaRun> {
    return ipcRenderer.invoke('rpa-run-start', taskId, options);
  },

  pauseRun(runId: number): Promise<RpaRun> {
    return ipcRenderer.invoke('rpa-run-pause', runId);
  },

  resumeRun(runId: number): Promise<RpaRun> {
    return ipcRenderer.invoke('rpa-run-resume', runId);
  },

  stopRun(runId: number): Promise<RpaRun> {
    return ipcRenderer.invoke('rpa-run-stop', runId);
  },

  getRun(runId: number): Promise<RpaRun> {
    return ipcRenderer.invoke('rpa-run-get', runId);
  },

  listRuns(taskId?: number): Promise<RpaRun[]> {
    return ipcRenderer.invoke('rpa-run-list', taskId);
  },

  startRecorder(windowId: number, options?: RpaRecorderOptions): Promise<RpaRecorderSession> {
    return ipcRenderer.invoke('rpa-recorder-start', windowId, options);
  },

  stopRecorder(sessionId: string): Promise<RpaRecorderSession> {
    return ipcRenderer.invoke('rpa-recorder-stop', sessionId);
  },

  onRunUpdated(callback: (event: IpcRendererEvent, run: RpaRun) => void) {
    ipcRenderer.on('rpa-run-updated', callback);
    return () => ipcRenderer.off('rpa-run-updated', callback);
  },

  onStepUpdated(callback: (event: IpcRendererEvent, run: RpaRun) => void) {
    ipcRenderer.on('rpa-step-updated', callback);
    return () => ipcRenderer.off('rpa-step-updated', callback);
  },

  onRecorderEvent(callback: (event: IpcRendererEvent, recorderEvent: RpaRecorderEvent) => void) {
    ipcRenderer.on('rpa-recorder-event', callback);
    return () => ipcRenderer.off('rpa-recorder-event', callback);
  },
};
