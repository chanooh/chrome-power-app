import {createHash} from 'crypto';
import {beforeEach, expect, test, vi} from 'vitest';
import {ipcRenderer} from 'electron';
import {sha256sum, versions, WindowBridge} from '../src';

vi.mock('electron', () => ({
  ipcRenderer: {
    invoke: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
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
