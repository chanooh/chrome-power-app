import type {FingerprintSnapshot} from '../../../shared/types/fingerprint';

interface BrowserLaunchParameterOptions {
  managed: boolean;
  chromePort: number;
  windowDataDir: string;
  finalProxy?: string;
  headless?: boolean;
  isMac?: boolean;
  appStartUrl?: string;
  userExtensionPaths?: string[];
  snapshot?: FingerprintSnapshot;
}

const getExtensionArgument = (paths: string[]) =>
  paths.length > 0 ? `--load-extension=${paths.join(',')}` : '';

export const encodeNativeFingerprintPayload = (snapshot: FingerprintSnapshot) =>
  Buffer.from(JSON.stringify(snapshot), 'utf8').toString('base64url');

export const buildBrowserLaunchParameters = ({
  managed,
  chromePort,
  windowDataDir,
  finalProxy,
  headless = false,
  isMac = process.platform === 'darwin',
  appStartUrl,
  userExtensionPaths = [],
  snapshot,
}: BrowserLaunchParameterOptions) => {
  const launchParameters = !managed
    ? [
        '--remote-debugging-address=127.0.0.1',
        `--remote-debugging-port=${chromePort}`,
        `--user-data-dir=${windowDataDir}`,
        '--no-first-run',
      ]
    : [
        '--force-color-profile=srgb',
        '--no-first-run',
        '--no-default-browser-check',
        '--metrics-recording-only',
        '--disable-background-networking',
        '--disable-background-mode',
        '--disable-component-update',
        '--disable-sync',
        '--webrtc-ip-handling-policy=disable_non_proxied_udp',
        '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
        '--remote-debugging-address=127.0.0.1',
        `--remote-debugging-port=${chromePort}`,
        `--user-data-dir=${windowDataDir}`,
        '--unhandled-rejections=strict',
      ];

  if (managed && snapshot) {
    launchParameters.push(`--user-agent=${snapshot.ua}`);
    launchParameters.push(`--lang=${snapshot.locale}`);
    launchParameters.push(`--accept-lang=${snapshot.languages.join(',')}`);
    launchParameters.push(`--chrome-power-fingerprint=${encodeNativeFingerprintPayload(snapshot)}`);
  }

  if (finalProxy) {
    launchParameters.push(`--proxy-server=${finalProxy}`);
  }

  const extensionArgument = getExtensionArgument(
    userExtensionPaths.filter((path): path is string => Boolean(path)),
  );
  if (extensionArgument) {
    launchParameters.push(extensionArgument);
  }

  if (headless) {
    launchParameters.push('--headless=new');
    if (!isMac) {
      launchParameters.push('--disable-gpu');
    }
  } else {
    launchParameters.push('--new-window');
    if (appStartUrl) {
      launchParameters.push(appStartUrl);
    }
  }

  return launchParameters;
};
