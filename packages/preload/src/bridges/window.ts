import type {IpcRendererEvent} from 'electron';
import {ipcRenderer} from 'electron';
import type {DB, SafeAny} from '../../../shared/types/db';
import type {
  OrphanProfile,
  ProfileBackupResult,
  ProfileRestoreResult,
  ProfileStorageStatus,
} from '../../../shared/types/profile';

export const WindowBridge = {
  async import(file: string) {
    const result = await ipcRenderer.invoke('window-import', file);
    return result;
  },

  async create(window: DB.Window, fingerprints: SafeAny) {
    const result = await ipcRenderer.invoke('window-create', window, fingerprints);
    return result;
  },

  async update(id: number, window: DB.Window) {
    const result = await ipcRenderer.invoke('window-update', id, window);
    return result;
  },
  async delete(id: number) {
    const result = await ipcRenderer.invoke('window-delete', id);
    return result;
  },
  async batchClear(ids: number[]) {
    const result = await ipcRenderer.invoke('window-batchClear', ids);
    return result;
  },
  async batchDelete(ids: number[]) {
    const result = await ipcRenderer.invoke('window-batchDelete', ids);
    return result;
  },
  async getAll() {
    const result = await ipcRenderer.invoke('window-getAll');
    return result;
  },
  async getOpenedWindows() {
    const result = await ipcRenderer.invoke('window-getOpened');
    return result;
  },
  async getFingerprint(windowId?: number) {
    const result = await ipcRenderer.invoke('window-fingerprint', windowId);
    return result;
  },
  async getFingerprintDiagnostics(windowId: number) {
    const result = await ipcRenderer.invoke('window-fingerprint-diagnostics', windowId);
    return result;
  },
  async getProfileStorageStatus(windowId: number): Promise<ProfileStorageStatus> {
    const result = await ipcRenderer.invoke('window-profile-storage-status', windowId);
    return result;
  },
  async backupProfile(windowId: number): Promise<ProfileBackupResult> {
    const result = await ipcRenderer.invoke('window-profile-backup', windowId);
    return result;
  },
  async restoreProfile(archivePath?: string): Promise<ProfileRestoreResult> {
    const result = await ipcRenderer.invoke('window-profile-restore', archivePath);
    return result;
  },
  async scanOrphanProfiles(): Promise<OrphanProfile[]> {
    const result = await ipcRenderer.invoke('window-profile-scan-orphans');
    return result;
  },
  async trashOrphanProfile(profileId: string) {
    const result = await ipcRenderer.invoke('window-profile-trash-orphan', profileId);
    return result;
  },
  async getById(id: number) {
    const result = await ipcRenderer.invoke('window-getById', id);
    return result;
  },

  async open(id: number) {
    const result = await ipcRenderer.invoke('window-open', id);
    return result;
  },

  async close(id: number) {
    const result = await ipcRenderer.invoke('window-close', id, true);
    return result;
  },

  async toogleSetCookie(id: number) {
    const result = await ipcRenderer.invoke('window-set-cookie', id);
    return result;
  },

  onWindowClosed: (callback: (event: IpcRendererEvent, id: number) => void) =>
    ipcRenderer.on('window-closed', callback),

  onWindowOpened: (callback: (event: IpcRendererEvent, id: number) => void) =>
    ipcRenderer.on('window-opened', callback),

  offWindowClosed: (callback: (event: IpcRendererEvent, id: number) => void) =>
    ipcRenderer.off('window-closed', callback),

  offWindowOpened: (callback: (event: IpcRendererEvent, id: number) => void) =>
    ipcRenderer.off('window-opened', callback),
};
