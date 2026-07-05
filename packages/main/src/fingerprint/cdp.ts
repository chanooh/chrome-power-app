import puppeteer, {type Browser, type Page, type Target} from 'puppeteer';
import type {FingerprintSnapshot} from '../../../shared/types/fingerprint';
import {createLogger} from '../../../shared/utils/logger';
import {WINDOW_LOGGER_LABEL} from '../constants';

const logger = createLogger(WINDOW_LOGGER_LABEL);

export interface FingerprintCdpCommand {
  method: string;
  params: Record<string, unknown>;
}

export interface FingerprintCdpSession {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  detach?(): Promise<void>;
}

const cdpSessions = new Map<number, Browser>();

export const getFingerprintCdpCommands = (
  snapshot: FingerprintSnapshot,
): FingerprintCdpCommand[] => [
  {
    method: 'Emulation.setUserAgentOverride',
    params: {
      userAgent: snapshot.ua,
      acceptLanguage: snapshot.languages.join(','),
      platform: snapshot.navigator.platform,
      userAgentMetadata: {
        brands: snapshot.uaCh.brands,
        fullVersionList: snapshot.uaCh.fullVersionList,
        fullVersion: snapshot.uaCh.uaFullVersion,
        platform: snapshot.uaCh.platform,
        platformVersion: snapshot.uaCh.platformVersion,
        architecture: snapshot.uaCh.architecture,
        model: snapshot.uaCh.model,
        mobile: snapshot.uaCh.mobile,
        bitness: snapshot.uaCh.bitness,
        wow64: snapshot.uaCh.wow64,
      },
    },
  },
  {
    method: 'Emulation.setLocaleOverride',
    params: {
      locale: snapshot.locale,
    },
  },
  {
    method: 'Emulation.setTimezoneOverride',
    params: {
      timezoneId: snapshot.timezone,
    },
  },
  {
    method: 'Emulation.setDeviceMetricsOverride',
    params: {
      width: snapshot.screen.width,
      height: snapshot.screen.height,
      deviceScaleFactor: snapshot.screen.deviceScaleFactor,
      mobile: false,
      screenWidth: snapshot.screen.width,
      screenHeight: snapshot.screen.height,
      positionX: 0,
      positionY: 0,
      dontSetVisibleSize: true,
    },
  },
];

export const applyFingerprintCdpToSession = async (
  session: FingerprintCdpSession,
  snapshot: FingerprintSnapshot,
) => {
  for (const command of getFingerprintCdpCommands(snapshot)) {
    await session.send(command.method, command.params);
  }
};

export const applyFingerprintCdpToPage = async (page: Page, snapshot: FingerprintSnapshot) => {
  const session = await page.target().createCDPSession();
  try {
    await applyFingerprintCdpToSession(session, snapshot);
  } finally {
    await session.detach?.();
  }
};

const applyFingerprintCdpToTarget = async (target: Target, snapshot: FingerprintSnapshot) => {
  if (!['page', 'webview'].includes(target.type())) {
    return;
  }
  const page = await target.page();
  if (!page) {
    return;
  }
  try {
    await applyFingerprintCdpToPage(page, snapshot);
  } catch (error) {
    logger.warn('Failed to apply fingerprint CDP overrides', error);
  }
};

export const startFingerprintCdpSession = async (
  windowId: number,
  browserWSEndpoint: string,
  snapshot: FingerprintSnapshot,
) => {
  stopFingerprintCdpSession(windowId);

  const browser = await puppeteer.connect({
    browserWSEndpoint,
    defaultViewport: null,
  });
  cdpSessions.set(windowId, browser);

  const applyTarget = async (target: Target) => {
    await applyFingerprintCdpToTarget(target, snapshot);
  };

  browser.on('targetcreated', applyTarget);
  browser.on('targetchanged', applyTarget);

  await Promise.all(browser.targets().map(target => applyFingerprintCdpToTarget(target, snapshot)));
  return browser;
};

export const stopFingerprintCdpSession = (windowId: number) => {
  const browser = cdpSessions.get(windowId);
  if (!browser) {
    return;
  }
  try {
    browser.disconnect();
  } catch (error) {
    logger.warn('Failed to disconnect fingerprint CDP session', error);
  } finally {
    cdpSessions.delete(windowId);
  }
};
