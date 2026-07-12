import {app} from 'electron';
import path from 'node:path';
import type {SyncNativeEvent, SyncPermissionStatus} from '../../../shared/types/sync';

export interface NativeWindowBounds {
  success: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NativeWindowInfo {
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  isExtension: boolean;
}

export interface NativeWindowManager {
  arrangeWindows(
    masterPid: number,
    slavePids: number[],
    columns: number,
    size: {width: number; height: number},
    spacing: number,
    monitorIndex?: number,
  ): void;
  getWindowBounds(pid: number): NativeWindowBounds;
  getAllWindows(pid: number): NativeWindowInfo[];
  getMonitors(): Array<{
    x: number;
    y: number;
    width: number;
    height: number;
    isPrimary: boolean;
    index: number;
  }>;
  isProcessWindowActive(pid: number): boolean;
  sendMouseEvent(pid: number, x: number, y: number, eventType: string): boolean;
  sendKeyboardEvent(
    pid: number,
    keyCode: number,
    eventType: string,
    mouseX?: number,
    mouseY?: number,
    flags?: number,
    text?: string,
  ): boolean;
  sendWheelEvent(pid: number, deltaX: number, deltaY: number, x?: number, y?: number): boolean;
  startEventCapture(callback: (event: SyncNativeEvent) => void): boolean;
  stopEventCapture(): boolean;
  getPermissionStatus(): Omit<SyncPermissionStatus, 'ready'>;
  requestListenAccess(): boolean;
  requestPostAccess(): boolean;
}

let cachedManager: NativeWindowManager | undefined;
let loadError: Error | undefined;

export const getNativeWindowManager = (): NativeWindowManager | undefined => {
  if (cachedManager || loadError) return cachedManager;
  try {
    const addonPath = app.isPackaged
      ? path.join(
          process.resourcesPath,
          'app.asar.unpacked/node_modules/window-addon/window-addon.node',
        )
      : path.join(__dirname, '../src/native-addon/build/Release/window-addon.node');
    const addon = require(addonPath) as {WindowManager: new () => NativeWindowManager};
    cachedManager = new addon.WindowManager();
  } catch (error) {
    loadError = error instanceof Error ? error : new Error(String(error));
  }
  return cachedManager;
};

export const getNativeWindowManagerLoadError = () => loadError;
