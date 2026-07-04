import {describe, expect, test, vi} from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath(name: string) {
      if (name === 'appData') return '/tmp/chrome-power-app-data';
      if (name === 'documents') return '/Users/test/Documents';
      return '/tmp';
    },
  },
}));

vi.mock('../src/fingerprint/device', () => ({
  getChromePath: () => '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
}));

describe('settings normalization', () => {
  test('defaults macOS settings to the managed Chromium core', async () => {
    const {MANAGED_BROWSER_CORE_ROOT, MANAGED_CHROMIUM_VERSION} = await import(
      '../src/browser-core/managed-core'
    );
    const {normalizeSettings} = await import('../src/utils/get-settings');

    const settings = normalizeSettings({});

    expect(settings.browserMode).toBe('managed');
    expect(settings.useLocalChrome).toBe(false);
    expect(settings.managedBrowserRoot).toBe(MANAGED_BROWSER_CORE_ROOT);
    expect(settings.managedBrowserVersion).toBe(MANAGED_CHROMIUM_VERSION);
    expect(settings.profileCachePath).toBe('/Volumes/F/ChromePowerCache');
  });

  test('keeps explicit local mode as a fallback', async () => {
    const {normalizeSettings} = await import('../src/utils/get-settings');

    const settings = normalizeSettings({
      browserMode: 'local',
      localChromePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    });

    expect(settings.browserMode).toBe('local');
    expect(settings.useLocalChrome).toBe(true);
    expect(settings.localChromePath).toBe('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  });
});
