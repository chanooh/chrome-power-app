import {mkdtempSync, rmSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

const mockState = vi.hoisted(() => ({
  profileCachePath: '',
}));

vi.mock('../src/utils/get-settings', () => ({
  getSettings: () => ({
    profileCachePath: mockState.profileCachePath,
  }),
  ensureProfileCachePath: vi.fn(),
}));

describe('rpa artifacts', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'chrome-power-rpa-artifacts-'));
    mockState.profileCachePath = tempDir;
  });

  afterEach(() => {
    rmSync(tempDir, {recursive: true, force: true});
  });

  test('creates artifact directories under the configured cache root', async () => {
    const {getRpaProfileArtifactDir, resolveRpaArtifactPath} = await import('../src/rpa/artifacts');

    const dir = getRpaProfileArtifactDir(12, 'profile-alpha');
    const screenshot = resolveRpaArtifactPath(dir, '001-step.png');

    expect(dir).toContain('rpa/runs/12/profile-alpha');
    expect(screenshot).toContain('001-step.png');
  });

  test('rejects unsafe profile ids and artifact file names', async () => {
    const {getRpaProfileArtifactDir, resolveRpaArtifactPath} = await import('../src/rpa/artifacts');

    expect(() => getRpaProfileArtifactDir(12, '../escape')).toThrow('Invalid profile id');
    expect(() => resolveRpaArtifactPath(tempDir, '../escape.png')).toThrow('Invalid artifact file name');
  });
});
