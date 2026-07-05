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

  test('uses a requested concrete macOS template', () => {
    const snapshot = generateFingerprintSnapshot('profile-pro', 'macbook-pro-14');

    expect(snapshot.requestedTemplateId).toBe('macbook-pro-14');
    expect(snapshot.templateId).toBe('macbook-pro-14');
    expect(snapshot.navigator.hardwareConcurrency).toBe(12);
    expect(snapshot.screen.width).toBe(1512);
  });

  test('parses only valid managed Chromium snapshots', () => {
    const snapshot = generateFingerprintSnapshot('profile-alpha', 'auto');

    expect(parseFingerprintSnapshot(serializeFingerprintSnapshot(snapshot))).toEqual(snapshot);
    expect(parseFingerprintSnapshot('{}')).toBeNull();
    expect(parseFingerprintSnapshot('{bad json')).toBeNull();
  });
});
