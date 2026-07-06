import puppeteer, {type Page} from 'puppeteer';
import type {
  FingerprintDiagnosticItem,
  FingerprintDiagnosticResult,
  FingerprintDiagnosticStatus,
  FingerprintSnapshot,
} from '../../../shared/types/fingerprint';
import api from '../../../shared/api/api';
import type {DB} from '../../../shared/types/db';
import {parseFingerprintSnapshot} from './snapshot';

const HOST = '127.0.0.1';

const toText = (value: unknown) => {
  if (Array.isArray(value)) {
    return value.join(', ');
  }
  if (value === undefined) {
    return 'undefined';
  }
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
};

const createItem = (
  key: string,
  label: string,
  expected: unknown,
  actual: unknown,
  pass: boolean,
  message?: string,
  warning = false,
): FingerprintDiagnosticItem => ({
  key,
  label,
  expected: toText(expected),
  actual: toText(actual),
  status: pass ? 'pass' : warning ? 'warning' : 'fail',
  message,
});

const getOverallStatus = (
  items: FingerprintDiagnosticItem[],
): FingerprintDiagnosticStatus => {
  if (items.some(item => item.status === 'fail')) {
    return 'fail';
  }
  if (items.some(item => item.status === 'warning')) {
    return 'warning';
  }
  return 'pass';
};

const compareArray = (expected: string[], actual: unknown) =>
  Array.isArray(actual) &&
  expected.length === actual.length &&
  expected.every((item, index) => item === actual[index]);

export const collectRuntimeFingerprintValues = async (
  page: Page,
) =>
  await page.evaluate(async () => {
    const browserGlobal = globalThis as unknown as Record<string, any>;
    const hashText = (value: string) => {
      let hash = 2166136261;
      for (let i = 0; i < value.length; i++) {
        hash ^= value.charCodeAt(i);
        hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
      }
      return (hash >>> 0).toString(16).padStart(8, '0');
    };
    const getCanvasHash = () => {
      try {
        const documentRef = browserGlobal.document;
        const canvas = documentRef.createElement('canvas');
        canvas.width = 64;
        canvas.height = 32;
        const context = canvas.getContext('2d');
        context.fillStyle = '#f6f1e8';
        context.fillRect(0, 0, 64, 32);
        context.fillStyle = '#1f2937';
        context.font = '13px Arial';
        context.fillText('ChromePower', 4, 20);
        const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let text = '';
        for (let i = 0; i < data.length; i += 17) {
          text += String.fromCharCode(data[i]);
        }
        return hashText(text);
      } catch (error) {
        return `error:${(error as Error).message}`;
      }
    };
    const getWebgl = () => {
      try {
        const documentRef = browserGlobal.document;
        const canvas = documentRef.createElement('canvas');
        const gl =
          canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (!gl) {
          return {};
        }
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        return {
          vendor: gl.getParameter(gl.VENDOR),
          renderer: gl.getParameter(gl.RENDERER),
          unmaskedVendor: debugInfo
            ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL)
            : undefined,
          unmaskedRenderer: debugInfo
            ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
            : undefined,
        };
      } catch (error) {
        return {error: (error as Error).message};
      }
    };
    const getCoreValues = () => ({
      userAgent: browserGlobal.navigator.userAgent,
      language: browserGlobal.navigator.language,
      languages: browserGlobal.navigator.languages,
      platform: browserGlobal.navigator.platform,
      hardwareConcurrency: browserGlobal.navigator.hardwareConcurrency,
      deviceMemory: browserGlobal.navigator.deviceMemory,
      timezone: browserGlobal.Intl.DateTimeFormat().resolvedOptions().timeZone,
      screen: {
        width: browserGlobal.screen.width,
        height: browserGlobal.screen.height,
        availWidth: browserGlobal.screen.availWidth,
        availHeight: browserGlobal.screen.availHeight,
        colorDepth: browserGlobal.screen.colorDepth,
        pixelDepth: browserGlobal.screen.pixelDepth,
        deviceScaleFactor: browserGlobal.devicePixelRatio,
      },
    });
    const getIframeValues = async () => {
      try {
        const iframe = browserGlobal.document.createElement('iframe');
        browserGlobal.document.body.appendChild(iframe);
        const win = iframe.contentWindow;
        const values = {
          userAgent: win.navigator.userAgent,
          platform: win.navigator.platform,
          hardwareConcurrency: win.navigator.hardwareConcurrency,
          timezone: win.Intl.DateTimeFormat().resolvedOptions().timeZone,
        };
        iframe.remove();
        return values;
      } catch (error) {
        return {error: (error as Error).message};
      }
    };
    const getWorkerValues = async () => {
      try {
        const source = `
          self.onmessage = () => self.postMessage({
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            hardwareConcurrency: navigator.hardwareConcurrency,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
          });
        `;
        const url = URL.createObjectURL(new Blob([source], {type: 'text/javascript'}));
        const worker = new Worker(url);
        const values = await new Promise(resolve => {
          worker.onmessage = event => resolve(event.data);
          worker.postMessage(null);
        });
        worker.terminate();
        URL.revokeObjectURL(url);
        return values;
      } catch (error) {
        return {error: (error as Error).message};
      }
    };
    const getMediaDevices = async () => {
      try {
        const devices = await browserGlobal.navigator.mediaDevices?.enumerateDevices?.();
        return (devices || []).map((device: any) => ({
          kind: device.kind,
          label: device.label,
          deviceId: device.deviceId,
          groupId: device.groupId,
        }));
      } catch (error) {
        return [{error: (error as Error).message}];
      }
    };

    const uaCh =
      (await browserGlobal.navigator.userAgentData?.getHighEntropyValues?.([
        'architecture',
        'bitness',
        'fullVersionList',
        'model',
        'platform',
        'platformVersion',
        'uaFullVersion',
        'wow64',
      ])) || {};

    return {
      ...getCoreValues(),
      userAgentData: uaCh,
      iframe: await getIframeValues(),
      worker: await getWorkerValues(),
      webgl: getWebgl(),
      canvasHash: getCanvasHash(),
      mediaDevices: await getMediaDevices(),
      webgpu: browserGlobal.navigator.gpu ? 'available' : 'unavailable',
      chromePowerState: browserGlobal.__chromePowerFingerprintState,
      nativeFunctionSource: {
        getImageData: browserGlobal.CanvasRenderingContext2D?.prototype?.getImageData?.toString?.(),
        getParameter: browserGlobal.WebGLRenderingContext?.prototype?.getParameter?.toString?.(),
      },
    };
  });

export const buildFingerprintDiagnosticResult = (
  windowData: DB.Window,
  snapshot: FingerprintSnapshot,
  actual: Awaited<ReturnType<typeof collectRuntimeFingerprintValues>>,
): FingerprintDiagnosticResult => {
  const expectedScreen = `${snapshot.screen.width}x${snapshot.screen.height}@${snapshot.screen.deviceScaleFactor}`;
  const actualScreen = `${actual.screen.width}x${actual.screen.height}@${actual.screen.deviceScaleFactor}`;
  const expectedMedia = snapshot.mediaDevices.map(device => `${device.kind}:${device.label}`);
  const actualMedia = actual.mediaDevices.map(
    (device: {kind?: string; label?: string}) => `${device.kind}:${device.label}`,
  );
  const iframeValues = actual.iframe as {
    userAgent?: string;
    timezone?: string;
    platform?: string;
  };
  const workerValues = actual.worker as {
    userAgent?: string;
    timezone?: string;
    platform?: string;
  };
  const items: FingerprintDiagnosticItem[] = [
    createItem('ua', 'User-Agent', snapshot.ua, actual.userAgent, actual.userAgent === snapshot.ua),
    createItem(
      'ua-ch',
      'UA-CH',
      snapshot.uaCh,
      actual.userAgentData,
      actual.userAgentData?.platform === snapshot.uaCh.platform &&
        actual.userAgentData?.architecture === snapshot.uaCh.architecture &&
        actual.userAgentData?.uaFullVersion === snapshot.uaCh.uaFullVersion,
    ),
    createItem(
      'locale',
      'Locale',
      [snapshot.locale, ...snapshot.languages],
      [actual.language, ...(Array.isArray(actual.languages) ? actual.languages : [])],
      actual.language === snapshot.locale && compareArray(snapshot.languages, actual.languages),
    ),
    createItem(
      'timezone',
      'Timezone',
      snapshot.timezone,
      actual.timezone,
      actual.timezone === snapshot.timezone,
    ),
    createItem('screen', 'Screen', expectedScreen, actualScreen, expectedScreen === actualScreen),
    createItem(
      'hardware',
      'Hardware',
      `${snapshot.navigator.hardwareConcurrency} cores / ${snapshot.navigator.deviceMemory} GB`,
      `${actual.hardwareConcurrency} cores / ${actual.deviceMemory} GB`,
      actual.hardwareConcurrency === snapshot.navigator.hardwareConcurrency &&
        (actual.deviceMemory === snapshot.navigator.deviceMemory || actual.deviceMemory === undefined),
      actual.deviceMemory === undefined ? 'navigator.deviceMemory is unavailable in this Chromium context.' : undefined,
      actual.deviceMemory === undefined,
    ),
    createItem(
      'webgl',
      'WebGL',
      `${snapshot.webgl.unmaskedVendor} / ${snapshot.webgl.unmaskedRenderer}`,
      `${actual.webgl?.unmaskedVendor} / ${actual.webgl?.unmaskedRenderer}`,
      actual.webgl?.unmaskedVendor === snapshot.webgl.unmaskedVendor &&
        actual.webgl?.unmaskedRenderer === snapshot.webgl.unmaskedRenderer,
    ),
    createItem(
      'canvas',
      'Canvas',
      `native noise ${snapshot.noise.canvas}`,
      actual.canvasHash,
      !actual.chromePowerState,
      'Native canvas noise is verified by stable readback hash and absence of JS state.',
      true,
    ),
    createItem(
      'audio',
      'Audio',
      `native noise ${snapshot.noise.audio}`,
      'native readout path',
      !actual.chromePowerState,
      'Audio noise is applied in native AudioBuffer/Analyser readout paths.',
      true,
    ),
    createItem(
      'media-devices',
      'Media Devices',
      expectedMedia,
      actualMedia,
      compareArray(expectedMedia, actualMedia),
    ),
    createItem(
      'webgpu',
      'WebGPU',
      snapshot.webgpu.mode,
      actual.webgpu,
      actual.webgpu === 'available',
      'Stock WebGPU remains available; adapter info is masked natively.',
      true,
    ),
    createItem(
      'cross-context',
      'Cross Context',
      [snapshot.ua, snapshot.timezone, snapshot.navigator.platform],
      [actual.iframe, actual.worker],
      iframeValues.userAgent === snapshot.ua &&
        workerValues.userAgent === snapshot.ua &&
        iframeValues.timezone === snapshot.timezone &&
        workerValues.timezone === snapshot.timezone &&
        iframeValues.platform === snapshot.navigator.platform &&
        workerValues.platform === snapshot.navigator.platform,
    ),
    createItem(
      'js-integrity',
      'JS Integrity',
      'native functions',
      actual.nativeFunctionSource,
      !actual.chromePowerState &&
        String(actual.nativeFunctionSource?.getImageData || '').includes('[native code]') &&
        String(actual.nativeFunctionSource?.getParameter || '').includes('[native code]'),
    ),
  ];

  return {
    windowId: windowData.id!,
    profileId: snapshot.profileId,
    overallStatus: getOverallStatus(items),
    items,
    limitations: [
      'Service Worker and external fingerprint sites should still be used for final acceptance.',
      'Font availability follows the real macOS system font stack; the template font list is diagnostic only.',
      'Proxy ASN/city scoring depends on the selected proxy provider and is warned, not rewritten.',
    ],
  };
};

export const runFingerprintDiagnostics = async (
  windowData: DB.Window,
): Promise<FingerprintDiagnosticResult> => {
  const snapshot = parseFingerprintSnapshot(windowData.fingerprint);
  if (!windowData.id || !windowData.profile_id) {
    throw new Error('Window id/profile_id is missing');
  }
  if (!snapshot) {
    throw new Error('Fingerprint snapshot is missing or invalid');
  }
  if (windowData.status !== 2 || !windowData.port) {
    throw new Error('Fingerprint diagnostics require a running window');
  }

  const {data} = await api.get(`http://${HOST}:${windowData.port}/json/version`);
  const browser = await puppeteer.connect({
    browserWSEndpoint: data.webSocketDebuggerUrl,
    defaultViewport: null,
  });
  try {
    const pages = await browser.pages();
    const page =
      pages.find(item => !item.url().startsWith('chrome://')) ||
      pages[0] ||
      (await browser.newPage());
    const actual = await collectRuntimeFingerprintValues(page);
    return buildFingerprintDiagnosticResult(windowData, snapshot, actual);
  } finally {
    browser.disconnect();
  }
};
