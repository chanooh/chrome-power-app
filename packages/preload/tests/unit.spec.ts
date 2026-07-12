import {createHash} from 'crypto';
import {beforeEach, expect, test, vi} from 'vitest';
import {ipcRenderer} from 'electron';
import {sha256sum, versions, SyncBridge, WindowBridge} from '../src';

vi.mock('electron', () => ({
  ipcRenderer: {
    invoke: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    removeListener: vi.fn(),
  },
}));

beforeEach(() => {
  vi.mocked(ipcRenderer.invoke).mockReset();
});

test('versions', async () => {
  expect(versions).toBe(process.versions);
});

test('nodeCrypto', async () => {
  // Test hashing a random string.
  const testString = Math.random().toString(36).slice(2, 7);
  const expectedHash = createHash('sha256').update(testString).digest('hex');

  expect(sha256sum(testString)).toBe(expectedHash);
});

test('regenerateFingerprint invokes the window fingerprint IPC', async () => {
  const result = {success: true, message: 'ok'};
  vi.mocked(ipcRenderer.invoke).mockResolvedValue(result);

  await expect(WindowBridge.regenerateFingerprint(42)).resolves.toEqual(result);
  expect(ipcRenderer.invoke).toHaveBeenCalledWith('window-fingerprint-regenerate', 42);
});

test('mac sync bridge forwards options and permission requests', async () => {
  vi.mocked(ipcRenderer.invoke).mockResolvedValue({success: true});
  const request = {
    masterWindowId: 1,
    slaveWindowIds: [2, 3],
    options: {engine: 'hybrid' as const, enableTextSync: true},
  };
  await SyncBridge.startSync(request);
  await SyncBridge.requestPermissions();
  expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(1, 'multi-window-sync-start', request);
  expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(2, 'multi-window-sync-request-permissions');
});
