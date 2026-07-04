import {createHash} from 'crypto';
import {expect, test, vi} from 'vitest';
import {sha256sum, versions} from '../src';

vi.mock('electron', () => ({
  ipcRenderer: {
    invoke: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
}));

test('versions', async () => {
  expect(versions).toBe(process.versions);
});

test('nodeCrypto', async () => {
  // Test hashing a random string.
  const testString = Math.random().toString(36).slice(2, 7);
  const expectedHash = createHash('sha256').update(testString).digest('hex');

  expect(sha256sum(testString)).toBe(expectedHash);
});
