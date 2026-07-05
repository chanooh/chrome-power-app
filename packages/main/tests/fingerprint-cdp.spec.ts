import {describe, expect, test, vi} from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/chrome-power-test',
  },
}));

import {
  applyFingerprintCdpToSession,
  getFingerprintCdpCommands,
} from '../src/fingerprint/cdp';
import {generateFingerprintSnapshot} from '../src/fingerprint/snapshot';

describe('fingerprint CDP overrides', () => {
  test('builds UA-CH, locale, timezone, and screen commands', () => {
    const snapshot = generateFingerprintSnapshot('profile-alpha', 'macbook-air-13');
    const commands = getFingerprintCdpCommands(snapshot);

    expect(commands.map(command => command.method)).toEqual([
      'Emulation.setUserAgentOverride',
      'Emulation.setLocaleOverride',
      'Emulation.setTimezoneOverride',
      'Emulation.setDeviceMetricsOverride',
    ]);
    expect(commands[0].params.userAgent).toBe(snapshot.ua);
    expect(commands[0].params.userAgentMetadata).toMatchObject({
      platform: 'macOS',
      architecture: 'arm',
      bitness: '64',
    });
    expect(commands[2].params.timezoneId).toBe(snapshot.timezone);
    expect(commands[3].params).toMatchObject({
      width: snapshot.screen.width,
      height: snapshot.screen.height,
      deviceScaleFactor: snapshot.screen.deviceScaleFactor,
      mobile: false,
    });
  });

  test('sends all commands to a CDP session in order', async () => {
    const snapshot = generateFingerprintSnapshot('profile-alpha', 'auto');
    const session = {
      send: vi.fn(() => Promise.resolve()),
    };

    await applyFingerprintCdpToSession(session, snapshot);

    expect(session.send).toHaveBeenCalledTimes(4);
    expect(session.send.mock.calls[0][0]).toBe('Emulation.setUserAgentOverride');
    expect(session.send.mock.calls[3][0]).toBe('Emulation.setDeviceMetricsOverride');
  });
});
