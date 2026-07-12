import {describe, expect, test} from 'vitest';
import {
  generateFingerprintSnapshot,
  parseFingerprintSnapshot,
  serializeFingerprintSnapshot,
} from '../src/fingerprint/snapshot';

describe('macOS fingerprint snapshot', () => {
  test('generates the exact same snapshot for the same profile id', () => {
    const first = generateFingerprintSnapshot('profile-alpha', 'auto');
    const second = generateFingerprintSnapshot('profile-alpha', 'auto');

    expect(second).toEqual(first);
  });

  test('generates stable but different noise for different profiles', () => {
    const first = generateFingerprintSnapshot('profile-alpha', 'auto');
    const second = generateFingerprintSnapshot('profile-beta', 'auto');

    expect(second.profileId).toBe('profile-beta');
    expect(second.seed).not.toBe(first.seed);
    expect(second.canvas.seed).not.toBe(first.canvas.seed);
    expect(second.audio.seed).not.toBe(first.audio.seed);
  });

  test('generates a new stable Auto snapshot when generation id changes', () => {
    const first = generateFingerprintSnapshot('profile-alpha', 'auto', 'generation-one');
    const repeated = generateFingerprintSnapshot('profile-alpha', 'auto', 'generation-one');
    const rotated = generateFingerprintSnapshot('profile-alpha', 'auto', 'generation-two');

    expect(repeated).toEqual(first);
    expect(first.generationId).toBe('generation-one');
    expect(rotated.generationId).toBe('generation-two');
    expect(rotated.seed).not.toBe(first.seed);
    expect(rotated.canvas.seed).not.toBe(first.canvas.seed);
    expect(rotated.audio.seed).not.toBe(first.audio.seed);
    expect(rotated.mediaDevices[0].deviceId).not.toBe(first.mediaDevices[0].deviceId);
  });

  test('uses a requested concrete macOS template', () => {
    const snapshot = generateFingerprintSnapshot('profile-pro', 'macbook-pro-14-m4');

    expect(snapshot.schemaVersion).toBe(2);
    expect(snapshot.requestedTemplateId).toBe('macbook-pro-14-m4');
    expect(snapshot.templateId).toBe('macbook-pro-14-m4');
    expect(snapshot.nativePatchRequired).toBe(true);
    expect(snapshot.navigator.hardwareConcurrency).toBe(10);
    expect(snapshot.screen.width).toBe(1512);
  });

  test('migrates legacy template ids to v2 templates', () => {
    const snapshot = generateFingerprintSnapshot('profile-pro', 'macbook-pro-14');

    expect(snapshot.templateId).toBe('macbook-pro-14-m4');
  });

  test('parses only valid managed Chromium snapshots', () => {
    const snapshot = generateFingerprintSnapshot('profile-alpha', 'auto');

    expect(parseFingerprintSnapshot(serializeFingerprintSnapshot(snapshot))).toEqual(snapshot);
    expect(parseFingerprintSnapshot('{}')).toBeNull();
    expect(parseFingerprintSnapshot('{bad json')).toBeNull();
  });
});
