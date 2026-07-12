import {ipcRenderer} from 'electron';
import type {
  SyncActionResult,
  SyncCapabilities,
  SyncOptions,
  SyncPermissionStatus,
  SyncSessionStatus,
  SyncStartRequest,
  SyncTargetState,
} from '../../../shared/types/sync';

export type {
  SyncActionResult,
  SyncCapabilities,
  SyncOptions,
  SyncPermissionStatus,
  SyncSessionStatus,
  SyncStartRequest,
  SyncTargetState,
};

export interface MonitorInfo {
  x: number;
  y: number;
  width: number;
  height: number;
  isPrimary: boolean;
  index: number;
}

const subscribe = <T>(channel: string, callback: (payload: T) => void) => {
  const listener = (_event: Electron.IpcRendererEvent, payload: T) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

export const SyncBridge = {
  arrangeWindows: (args: {
    mainPid: number;
    childPids: number[];
    columns: number;
    size: {width: number; height: number};
    spacing: number;
    monitorIndex?: number;
  }) => ipcRenderer.invoke('window-arrange', args),

  getMonitors: (): Promise<{success: boolean; monitors: MonitorInfo[]; error?: string}> =>
    ipcRenderer.invoke('window-get-monitors'),

  getCapabilities: (): Promise<SyncCapabilities> =>
    ipcRenderer.invoke('multi-window-sync-capabilities'),

  getPermissionStatus: (): Promise<SyncPermissionStatus> =>
    ipcRenderer.invoke('multi-window-sync-permissions'),

  requestPermissions: (): Promise<SyncPermissionStatus> =>
    ipcRenderer.invoke('multi-window-sync-request-permissions'),

  openPermissionSettings: (kind: 'accessibility' | 'inputMonitoring'): Promise<void> =>
    ipcRenderer.invoke('multi-window-sync-open-permission-settings', kind),

  startSync: (request: SyncStartRequest): Promise<SyncActionResult> =>
    ipcRenderer.invoke('multi-window-sync-start', request),

  stopSync: (): Promise<SyncActionResult> => ipcRenderer.invoke('multi-window-sync-stop'),

  getSyncStatus: (): Promise<SyncSessionStatus> => ipcRenderer.invoke('multi-window-sync-status'),

  retryTarget: (windowId: number): Promise<SyncActionResult> =>
    ipcRenderer.invoke('multi-window-sync-retry-target', windowId),

  onStatusUpdated: (callback: (status: SyncSessionStatus) => void) =>
    subscribe('sync-status-updated', callback),

  onTargetUpdated: (callback: (target: SyncTargetState) => void) =>
    subscribe('sync-target-updated', callback),

  onShortcutStart: (callback: () => void) => subscribe('sync-shortcut-start', callback),
  onShortcutStop: (callback: () => void) => subscribe('sync-shortcut-stop', callback),
};
