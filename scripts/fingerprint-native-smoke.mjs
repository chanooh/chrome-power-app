#!/usr/bin/env node

import {spawn} from 'node:child_process';
import {mkdirSync, mkdtempSync, rmSync} from 'node:fs';
import {get as httpGet} from 'node:http';
import {createServer} from 'node:net';
import {join} from 'node:path';
import puppeteer from 'puppeteer';

const VERSION = '150.0.7871.47';
const EXECUTABLE_PATH = `/Volumes/F/ChromePowerCore/chromium/${VERSION}/mac-arm64/Chromium.app/Contents/MacOS/Chromium`;
const PROFILE_ROOT = '/Volumes/F/ChromePowerCache/native-smoke';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const removeProfileDir = async path => {
  let lastError;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      rmSync(path, {recursive: true, force: true});
      return;
    } catch (error) {
      lastError = error;
      await sleep(250);
    }
  }
  throw lastError;
};

const snapshot = {
  schemaVersion: 2,
  fingerprintEngineVersion: 'native-macos-v2',
  profileId: 'native-smoke',
  managedBrowserVersion: VERSION,
  requestedTemplateId: 'mac-mini-m4',
  templateId: 'mac-mini-m4',
  templateConfidence: 'high',
  nativePatchRequired: true,
  seed: 'native-smoke-seed',
  ua: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${VERSION.split('.')[0]}.0.0.0 Safari/537.36`,
  uaCh: {
    architecture: 'arm',
    bitness: '64',
    brands: [
      {brand: 'Chromium', version: VERSION.split('.')[0]},
      {brand: 'Not=A?Brand', version: '24'},
    ],
    fullVersionList: [
      {brand: 'Chromium', version: VERSION},
      {brand: 'Not=A?Brand', version: '24.0.0.0'},
    ],
    mobile: false,
    model: '',
    platform: 'macOS',
    platformVersion: '26.5.0',
    uaFullVersion: VERSION,
    fullVersion: VERSION,
    wow64: false,
  },
  locale: 'en-US',
  languages: ['en-US', 'en'],
  timezone: 'America/Los_Angeles',
  platform: 'MacIntel',
  hardwareConcurrency: 10,
  deviceMemory: 16,
  screen: {
    width: 1920,
    height: 1080,
    availWidth: 1920,
    availHeight: 1040,
    colorDepth: 24,
    pixelDepth: 24,
    deviceScaleFactor: 1,
  },
  webgl: {
    vendor: 'WebKit',
    renderer: 'WebKit WebGL',
    unmaskedVendor: 'Google Inc. (Apple)',
    unmaskedRenderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)',
  },
  webgpu: {
    mode: 'native-masked-adapter-info',
    vendor: 'Apple',
    architecture: 'Apple M4',
    device: 'Apple M4',
    description: 'Apple M4',
  },
  noise: {
    canvas: 10101,
    audio: 20202,
    webgl: 30303,
  },
  mediaDevices: [],
};

const encode = value => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

const assertEqual = (label, actual, expected) => {
  if (actual !== expected) {
    throw new Error(`${label} mismatch: expected ${expected}, got ${actual}`);
  }
};

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const getFreeLocalPort = () =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(error => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });

const readCdpVersion = port =>
  new Promise((resolve, reject) => {
    const req = httpGet({hostname: '127.0.0.1', port, path: '/json/version', timeout: 1000}, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('CDP request timed out')));
    req.on('error', reject);
  });

const waitForCdp = async (port, child) => {
  const deadline = Date.now() + 30000;
  let lastError = new Error('CDP did not respond');
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error('Chromium exited before CDP became available');
    }
    try {
      return await readCdpVersion(port);
    } catch (error) {
      lastError = error;
      await delay(500);
    }
  }
  throw lastError;
};

mkdirSync(PROFILE_ROOT, {recursive: true});
const profileDir = mkdtempSync(join(PROFILE_ROOT, '-'));
const port = await getFreeLocalPort();
let child;
let browser;

try {
  child = spawn(
    EXECUTABLE_PATH,
    [
      `--user-data-dir=${profileDir}`,
      `--remote-debugging-port=${port}`,
      `--user-agent=${snapshot.ua}`,
      `--lang=${snapshot.locale}`,
      `--accept-lang=${snapshot.languages.join(',')}`,
      `--chrome-power-fingerprint=${encode(snapshot)}`,
      '--remote-debugging-address=127.0.0.1',
      '--disable-component-update',
      '--disable-sync',
      '--disable-background-networking',
      '--webrtc-ip-handling-policy=disable_non_proxied_udp',
      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
      '--no-first-run',
      '--no-default-browser-check',
      '--headless=new',
      'about:blank',
    ],
    {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: {
        ...process.env,
        TZ: snapshot.timezone,
        LANG: `${snapshot.locale}.UTF-8`,
      },
    },
  );

  const version = await waitForCdp(port, child);
  browser = await puppeteer.connect({
    browserWSEndpoint: version.webSocketDebuggerUrl,
    defaultViewport: null,
  });

  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body></body></html>');
  const values = await page.evaluate(async () => {
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    const iframeValues = {
      userAgent: iframe.contentWindow.navigator.userAgent,
      platform: iframe.contentWindow.navigator.platform,
      hardwareConcurrency: iframe.contentWindow.navigator.hardwareConcurrency,
      timezone: iframe.contentWindow.Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
    iframe.remove();

    const workerValues = await new Promise(resolve => {
      const workerUrl = URL.createObjectURL(
        new Blob(
          [
            `onmessage = () => postMessage({
              userAgent: navigator.userAgent,
              platform: navigator.platform,
              hardwareConcurrency: navigator.hardwareConcurrency,
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
            })`,
          ],
          {type: 'text/javascript'},
        ),
      );
      const worker = new Worker(workerUrl);
      worker.onmessage = event => {
        worker.terminate();
        URL.revokeObjectURL(workerUrl);
        resolve(event.data);
      };
      worker.postMessage(null);
    });

    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl');
    const debugInfo = gl?.getExtension('WEBGL_debug_renderer_info');

    return {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: navigator.deviceMemory,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      iframe: iframeValues,
      worker: workerValues,
      webgl: debugInfo
        ? {
            vendor: gl.getParameter(gl.VENDOR),
            renderer: gl.getParameter(gl.RENDERER),
            unmaskedVendor: gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL),
            unmaskedRenderer: gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL),
          }
        : null,
      chromePowerState: globalThis.__chromePowerFingerprintState,
      getImageDataSource: CanvasRenderingContext2D.prototype.getImageData.toString(),
    };
  });

  for (const [scope, item] of Object.entries({
    main: values,
    iframe: values.iframe,
    worker: values.worker,
  })) {
    assertEqual(`${scope} userAgent`, item.userAgent, snapshot.ua);
    assertEqual(`${scope} platform`, item.platform, snapshot.platform);
    assertEqual(`${scope} hardwareConcurrency`, item.hardwareConcurrency, snapshot.hardwareConcurrency);
    assertEqual(`${scope} timezone`, item.timezone, snapshot.timezone);
  }
  if (values.deviceMemory !== undefined) {
    assertEqual('deviceMemory', values.deviceMemory, snapshot.deviceMemory);
  } else {
    console.warn('[fingerprint-native-smoke] navigator.deviceMemory is unavailable in this Chromium context');
  }
  assertEqual('WebGL vendor', values.webgl?.vendor, snapshot.webgl.vendor);
  assertEqual('WebGL renderer', values.webgl?.renderer, snapshot.webgl.renderer);
  assertEqual('WebGL unmaskedVendor', values.webgl?.unmaskedVendor, snapshot.webgl.unmaskedVendor);
  assertEqual('WebGL unmaskedRenderer', values.webgl?.unmaskedRenderer, snapshot.webgl.unmaskedRenderer);
  assertEqual('legacy JS state', values.chromePowerState, undefined);
  if (!String(values.getImageDataSource).includes('[native code]')) {
    throw new Error('Canvas getImageData does not look native');
  }
  console.log('[fingerprint-native-smoke] pass');
} finally {
  if (browser) {
    await browser.close();
  }
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
  }
  await removeProfileDir(profileDir);
}
