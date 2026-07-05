import {describe, expect, test} from 'vitest';
import {buildBrowserLaunchParameters} from '../src/fingerprint/launch-params';
import {generateFingerprintSnapshot} from '../src/fingerprint/snapshot';

describe('fingerprint launch parameters', () => {
  test('adds managed fingerprint arguments and keeps user extensions', () => {
    const snapshot = generateFingerprintSnapshot('profile-alpha', 'mac-mini');
    const args = buildBrowserLaunchParameters({
      managed: true,
      chromePort: 9222,
      windowDataDir: '/Volumes/F/ChromePowerCache/managed-chromium/150.0.7871.47/profile-alpha',
      internalExtensionPath: '/tmp/internal-fingerprint-extension',
      userExtensionPaths: ['/tmp/user-extension-a', '/tmp/user-extension-b'],
      appStartUrl: 'http://localhost:5173/#/start',
      snapshot,
      isMac: true,
    });

    expect(args).toContain(`--user-agent=${snapshot.ua}`);
    expect(args).toContain(`--lang=${snapshot.locale}`);
    expect(args).toContain(`--user-data-dir=/Volumes/F/ChromePowerCache/managed-chromium/150.0.7871.47/profile-alpha`);
    expect(args).toContain('--disable-features=WebGPU,UnsafeWebGPU');
    expect(args).toContain(
      '--load-extension=/tmp/internal-fingerprint-extension,/tmp/user-extension-a,/tmp/user-extension-b',
    );
    expect(args).toContain('http://localhost:5173/#/start');
    expect(args.some(arg => arg.startsWith('--timezone='))).toBe(false);
    expect(args.some(arg => arg.startsWith('--tz='))).toBe(false);
  });

  test('does not apply fingerprint arguments to local browser mode', () => {
    const snapshot = generateFingerprintSnapshot('profile-alpha', 'auto');
    const args = buildBrowserLaunchParameters({
      managed: false,
      chromePort: 9222,
      windowDataDir: '/tmp/local-profile',
      internalExtensionPath: '/tmp/internal-fingerprint-extension',
      userExtensionPaths: ['/tmp/user-extension'],
      snapshot,
    });

    expect(args).not.toContain(`--user-agent=${snapshot.ua}`);
    expect(args).toContain('--load-extension=/tmp/user-extension');
  });
});
