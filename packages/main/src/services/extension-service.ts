import {ipcMain} from 'electron';
import type {DB} from '../../../shared/types/db';
import {ExtensionDB} from '../db/extension';
import {db} from '../db';
import {
  importExtensionToRepository,
  verifyExtensionRepository,
} from '../extensions/repository';
import {existsSync, rmSync} from 'fs';

export const initExtensionService = () => {
  ipcMain.handle('extension-create', async (_, extension: DB.Extension) => {
    return await ExtensionDB.createExtension({
      ...extension,
      updated_at: db.fn.now() as unknown as string,
    });
  });

  ipcMain.handle('extension-get-all', async () => {
    return await ExtensionDB.getAllExtensions();
  });

  ipcMain.handle(
    'extension-apply-to-windows',
    async (_, extensionId: number, windowIds: number[]) => {
      return await ExtensionDB.insertExtensionWindows(extensionId, windowIds);
    },
  );

  ipcMain.handle('extension-get-windows', async (_, extensionId: number) => {
    return await ExtensionDB.getExtensionWindows(extensionId);
  });

  ipcMain.handle(
    'delete-extension-windows',
    async (_, extensionId: number, windowIds: number[]) => {
      return await ExtensionDB.deleteExtensionWindows(extensionId, windowIds);
    },
  );

  ipcMain.handle('extension-delete', async (_, extensionId: number) => {
    const extension = await ExtensionDB.getExtensionById(extensionId);
    const result = await ExtensionDB.deleteExtension(extensionId);
    if (typeof result === 'number' && result > 0 && extension?.repository_path && existsSync(extension.repository_path)) {
      rmSync(extension.repository_path, {recursive: true, force: true});
    }
    return result;
  });

  ipcMain.handle(
    'extension-update',
    async (_, extensionId: number, extension: Partial<DB.Extension>) => {
      return await ExtensionDB.updateExtension(extensionId, extension);
    },
  );

  const uploadPackage = async (filePath: string, existingExtensionId?: number) => {
    try {
      const existingExtension = existingExtensionId
        ? await ExtensionDB.getExtensionById(existingExtensionId)
        : undefined;
      const imported = await importExtensionToRepository(filePath, existingExtension);
      if (!imported.success) return imported;

      let extensionId = existingExtensionId;
      if (existingExtension && extensionId) {
        await ExtensionDB.updateExtension(extensionId, {
          ...imported.extension,
          updated_at: db.fn.now() as unknown as string,
        });
      } else {
        const createdIds = await ExtensionDB.createExtension({
          ...(imported.extension as DB.Extension),
          updated_at: db.fn.now() as unknown as string,
          imported_at: db.fn.now() as unknown as string,
        });
        extensionId = createdIds[0];
      }

      const runningWindowIds = extensionId
        ? await ExtensionDB.getRunningWindowIds(extensionId)
        : [];
      const {extension: _extension, ...publicImported} = imported;
      return {
        ...publicImported,
        extensionId,
        runningWindowIds,
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
        message: (error as Error).message,
      };
    }
  };

  ipcMain.handle('extension-upload-package', async (_, filePath: string, existingExtensionId?: number) =>
    uploadPackage(filePath, existingExtensionId),
  );

  ipcMain.handle('extension-batch-update', async (_, extensionId: number, filePath: string) =>
    uploadPackage(filePath, extensionId),
  );

  ipcMain.handle('extension-verify', async (_, extensionId: number) => {
    const extension = await ExtensionDB.getExtensionById(extensionId);
    if (!extension) {
      return {
        success: false,
        extensionId,
        message: 'Extension not found.',
      };
    }
    const result = verifyExtensionRepository(extension);
    if (result.success) {
      await ExtensionDB.updateExtension(extensionId, {
        last_verified_at: db.fn.now() as unknown as string,
      });
    }
    return result;
  });

  ipcMain.handle('extension-sync-windows', async (_, extensionId: number, windowIds: number[]) => {
    try {
      // 获取当前扩展已关联的所有窗口
      const currentWindows = await ExtensionDB.getExtensionWindows(extensionId);
      const currentWindowIds = currentWindows.map(w => w.window_id);

      // 需要删除的窗口关联
      const toDelete = currentWindowIds.filter(id => !windowIds.includes(id));
      if (toDelete.length > 0) {
        await ExtensionDB.deleteExtensionWindows(extensionId, toDelete);
      }

      // 需要新增的窗口关联
      const toAdd = windowIds.filter(id => !currentWindowIds.includes(id));
      if (toAdd.length > 0) {
        await ExtensionDB.insertExtensionWindows(extensionId, toAdd);
      }

      return {
        success: true,
        message: '同步成功',
      };
    } catch (error) {
      return {
        success: false,
        message: '同步失败',
      };
    }
  });
};
