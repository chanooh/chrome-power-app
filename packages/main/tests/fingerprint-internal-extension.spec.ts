import {mkdtempSync, readFileSync, rmSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';
import {ensureInternalFingerprintExtension} from '../src/fingerprint/internal-extension';
import {generateFingerprintSnapshot} from '../src/fingerprint/snapshot';

describe('internal fingerprint extension', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'chrome-power-fingerprint-extension-'));
  });

  afterEach(() => {
    rmSync(tempDir, {recursive: true, force: true});
  });

  test('writes a profile-specific MV3 extension with embedded snapshot', () => {
    const snapshot = generateFingerprintSnapshot('profile-alpha', 'mac-mini-m4');
    const extensionPath = ensureInternalFingerprintExtension(tempDir, snapshot);
    const manifest = JSON.parse(readFileSync(join(extensionPath, 'manifest.json'), 'utf8'));
    const contentScript = readFileSync(join(extensionPath, 'content.js'), 'utf8');

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.content_scripts[0]).toMatchObject({
      run_at: 'document_start',
      all_frames: true,
      world: 'MAIN',
    });
    expect(contentScript).toContain(snapshot.profileId);
    expect(contentScript).toContain(snapshot.canvas.seed);
    expect(contentScript).toContain('__chromePowerFingerprintState');
  });
});
