import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'fs';
import {join} from 'path';
import type {FingerprintSnapshot} from '../../../shared/types/fingerprint';

const EXTENSION_DIR_NAME = 'ChromePowerFingerprintExtension';
const EXTENSION_VERSION = '1.0.0';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BrowserAny = any;

const writeFileIfChanged = (filePath: string, content: string) => {
  if (existsSync(filePath) && readFileSync(filePath, 'utf8') === content) {
    return;
  }
  writeFileSync(filePath, content, 'utf8');
};

function installFingerprintOverrides(snapshot: FingerprintSnapshot) {
  const browserGlobal = globalThis as unknown as Record<string, BrowserAny>;
  const stateWindow = browserGlobal as unknown as {
    __chromePowerFingerprintState?: {
      profileId: string;
      templateId: string;
      canvasSeed: string;
      audioSeed: string;
      webgpuMode: string;
    };
  };
  if (stateWindow.__chromePowerFingerprintState?.profileId === snapshot.profileId) {
    return;
  }

  const defineGetter = (
    target: object,
    property: string,
    getter: () => unknown,
  ) => {
    try {
      Object.defineProperty(target, property, {
        configurable: true,
        get: getter,
      });
    } catch {
      // Some browser-owned descriptors are not configurable on every page.
    }
  };

  const defineValue = (target: object, property: string, value: unknown) => {
    try {
      Object.defineProperty(target, property, {
        configurable: true,
        value,
      });
    } catch {
      // Some browser-owned descriptors are not configurable on every page.
    }
  };

  const stableNumber = (seed: string, index: number) => {
    let hash = 2166136261;
    const input = `${seed}:${index}`;
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return Math.abs(hash >>> 0);
  };

  const noiseImageData = (imageData: BrowserAny, seed: string) => {
    const data = imageData.data;
    const step = Math.max(16, Math.floor(data.length / 96));
    for (let i = 0; i < data.length; i += step) {
      const channel = i + (stableNumber(seed, i) % 3);
      if (channel < data.length) {
        data[channel] = Math.max(
          0,
          Math.min(255, data[channel] + ((stableNumber(seed, channel) % 3) - 1)),
        );
      }
    }
    return imageData;
  };

  const createMediaDevice = (device: FingerprintSnapshot['mediaDevices'][number]) => ({
    kind: device.kind,
    label: device.label,
    deviceId: device.deviceId,
    groupId: device.groupId,
    toJSON() {
      return {
        kind: device.kind,
        label: device.label,
        deviceId: device.deviceId,
        groupId: device.groupId,
      };
    },
  });

  const navigatorPrototype = browserGlobal.Navigator?.prototype;
  if (navigatorPrototype) {
    defineGetter(navigatorPrototype, 'userAgent', () => snapshot.ua);
    defineGetter(navigatorPrototype, 'appVersion', () =>
      snapshot.ua.replace(/^Mozilla\//, ''),
    );
    defineGetter(navigatorPrototype, 'platform', () => snapshot.navigator.platform);
    defineGetter(navigatorPrototype, 'vendor', () => snapshot.navigator.vendor);
    defineGetter(navigatorPrototype, 'language', () => snapshot.locale);
    defineGetter(navigatorPrototype, 'languages', () => [...snapshot.languages]);
    defineGetter(
      navigatorPrototype,
      'hardwareConcurrency',
      () => snapshot.navigator.hardwareConcurrency,
    );
    defineGetter(navigatorPrototype, 'deviceMemory', () => snapshot.navigator.deviceMemory);
    defineGetter(navigatorPrototype, 'maxTouchPoints', () => snapshot.navigator.maxTouchPoints);
    defineGetter(navigatorPrototype, 'webdriver', () => false);
    defineGetter(navigatorPrototype, 'gpu', () => undefined);
  }

  const userAgentData = {
    brands: snapshot.uaCh.brands,
    mobile: snapshot.uaCh.mobile,
    platform: snapshot.uaCh.platform,
    getHighEntropyValues: async (hints: string[] = []) => {
      const values: Record<string, unknown> = {
        architecture: snapshot.uaCh.architecture,
        bitness: snapshot.uaCh.bitness,
        brands: snapshot.uaCh.brands,
        fullVersionList: snapshot.uaCh.fullVersionList,
        mobile: snapshot.uaCh.mobile,
        model: snapshot.uaCh.model,
        platform: snapshot.uaCh.platform,
        platformVersion: snapshot.uaCh.platformVersion,
        uaFullVersion: snapshot.uaCh.uaFullVersion,
        wow64: snapshot.uaCh.wow64,
      };
      return hints.reduce<Record<string, unknown>>(
        (acc, hint) => {
          if (hint in values) {
            acc[hint] = values[hint];
          }
          return acc;
        },
        {
          brands: snapshot.uaCh.brands,
          mobile: snapshot.uaCh.mobile,
          platform: snapshot.uaCh.platform,
        },
      );
    },
    toJSON() {
      return {
        brands: snapshot.uaCh.brands,
        mobile: snapshot.uaCh.mobile,
        platform: snapshot.uaCh.platform,
      };
    },
  };
  if (navigatorPrototype) {
    defineGetter(navigatorPrototype, 'userAgentData', () => userAgentData);
  }

  const mediaDevices = {
    enumerateDevices: async () => snapshot.mediaDevices.map(createMediaDevice),
    getSupportedConstraints: () => ({}),
  };
  if (navigatorPrototype) {
    defineGetter(navigatorPrototype, 'mediaDevices', () => mediaDevices);
  }

  if (browserGlobal.Screen?.prototype) {
    defineGetter(browserGlobal.Screen.prototype, 'width', () => snapshot.screen.width);
    defineGetter(browserGlobal.Screen.prototype, 'height', () => snapshot.screen.height);
    defineGetter(
      browserGlobal.Screen.prototype,
      'availWidth',
      () => snapshot.screen.availWidth,
    );
    defineGetter(
      browserGlobal.Screen.prototype,
      'availHeight',
      () => snapshot.screen.availHeight,
    );
    defineGetter(
      browserGlobal.Screen.prototype,
      'colorDepth',
      () => snapshot.screen.colorDepth,
    );
    defineGetter(
      browserGlobal.Screen.prototype,
      'pixelDepth',
      () => snapshot.screen.pixelDepth,
    );
  }
  defineGetter(browserGlobal, 'devicePixelRatio', () => snapshot.screen.deviceScaleFactor);
  defineGetter(browserGlobal, 'outerWidth', () => snapshot.screen.width);
  defineGetter(browserGlobal, 'outerHeight', () => snapshot.screen.height);

  if (Intl?.DateTimeFormat) {
    const OriginalDateTimeFormat = Intl.DateTimeFormat;
    const PatchedDateTimeFormat = function (
      this: Intl.DateTimeFormat,
      locales?: string | string[],
      options?: Intl.DateTimeFormatOptions,
    ) {
      const instance = new OriginalDateTimeFormat(locales || snapshot.locale, options);
      const originalResolvedOptions = instance.resolvedOptions.bind(instance);
      defineValue(instance, 'resolvedOptions', () => ({
        ...originalResolvedOptions(),
        locale: snapshot.locale,
        timeZone: snapshot.timezone,
      }));
      return instance;
    } as unknown as typeof Intl.DateTimeFormat;
    Object.setPrototypeOf(PatchedDateTimeFormat, OriginalDateTimeFormat);
    (PatchedDateTimeFormat as BrowserAny).prototype = OriginalDateTimeFormat.prototype;
    defineValue(Intl, 'DateTimeFormat', PatchedDateTimeFormat);
  }

  if (browserGlobal.HTMLCanvasElement?.prototype) {
    const noisedCanvases = new WeakSet<object>();
    const originalToDataURL = browserGlobal.HTMLCanvasElement.prototype.toDataURL;
    const originalToBlob = browserGlobal.HTMLCanvasElement.prototype.toBlob;
    const applyCanvasNoise = (canvas: BrowserAny) => {
      if (noisedCanvases.has(canvas)) {
        return;
      }
      try {
        const context = canvas.getContext('2d');
        if (!context || canvas.width <= 0 || canvas.height <= 0) {
          return;
        }
        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        context.putImageData(noiseImageData(imageData, snapshot.canvas.seed), 0, 0);
        noisedCanvases.add(canvas);
      } catch {
        // Cross-origin or WebGL-backed canvases can reject pixel reads.
      }
    };
    browserGlobal.HTMLCanvasElement.prototype.toDataURL = function (...args: BrowserAny[]) {
      applyCanvasNoise(this);
      return originalToDataURL.apply(this, args);
    };
    browserGlobal.HTMLCanvasElement.prototype.toBlob = function (...args: BrowserAny[]) {
      applyCanvasNoise(this);
      return originalToBlob.apply(this, args);
    };
  }

  if (browserGlobal.CanvasRenderingContext2D?.prototype) {
    const originalGetImageData = browserGlobal.CanvasRenderingContext2D.prototype.getImageData;
    browserGlobal.CanvasRenderingContext2D.prototype.getImageData = function (
      ...args: BrowserAny[]
    ) {
      const imageData = originalGetImageData.apply(this, args);
      return noiseImageData(imageData, snapshot.canvas.seed);
    };
  }

  const patchWebGL = (prototype?: BrowserAny) => {
    if (!prototype) {
      return;
    }
    const target = prototype as unknown as {
      getParameter?: (parameter: number) => unknown;
      getExtension?: (name: string) => unknown;
      getSupportedExtensions?: () => string[] | null;
      readPixels?: (...args: unknown[]) => unknown;
    };
    const originalGetParameter = target.getParameter;
    if (originalGetParameter) {
      target.getParameter = function (this: BrowserAny, parameter: number) {
        if (parameter === 0x1f00) {
          return snapshot.webgl.vendor;
        }
        if (parameter === 0x1f01) {
          return snapshot.webgl.renderer;
        }
        if (parameter === 0x9245) {
          return snapshot.webgl.unmaskedVendor;
        }
        if (parameter === 0x9246) {
          return snapshot.webgl.unmaskedRenderer;
        }
        return originalGetParameter.call(this, parameter);
      };
    }
    const originalGetExtension = target.getExtension;
    if (originalGetExtension) {
      target.getExtension = function (this: BrowserAny, name: string) {
        if (name === 'WEBGL_debug_renderer_info') {
          return {
            UNMASKED_VENDOR_WEBGL: 0x9245,
            UNMASKED_RENDERER_WEBGL: 0x9246,
          };
        }
        return originalGetExtension.call(this, name);
      };
    }
    const originalGetSupportedExtensions = target.getSupportedExtensions;
    if (originalGetSupportedExtensions) {
      target.getSupportedExtensions = function (this: BrowserAny) {
        const extensions = originalGetSupportedExtensions.call(this) || [];
        return extensions.includes('WEBGL_debug_renderer_info')
          ? extensions
          : [...extensions, 'WEBGL_debug_renderer_info'];
      };
    }
  };
  if (browserGlobal.WebGLRenderingContext?.prototype) {
    patchWebGL(browserGlobal.WebGLRenderingContext.prototype);
  }
  if (browserGlobal.WebGL2RenderingContext?.prototype) {
    patchWebGL(browserGlobal.WebGL2RenderingContext.prototype);
  }

  if (browserGlobal.AudioBuffer?.prototype) {
    const noisedBuffers = new WeakSet<object>();
    const originalGetChannelData = browserGlobal.AudioBuffer.prototype.getChannelData;
    browserGlobal.AudioBuffer.prototype.getChannelData = function (...args: BrowserAny[]) {
      const data = originalGetChannelData.apply(this, args);
      if (!noisedBuffers.has(this)) {
        for (let i = 0; i < data.length; i += Math.max(1, Math.floor(data.length / 128))) {
          data[i] += ((stableNumber(snapshot.audio.seed, i) % 5) - 2) * 0.0000001;
        }
        noisedBuffers.add(this);
      }
      return data;
    };
  }

  if (browserGlobal.AnalyserNode?.prototype) {
    const originalGetFloatFrequencyData =
      browserGlobal.AnalyserNode.prototype.getFloatFrequencyData;
    browserGlobal.AnalyserNode.prototype.getFloatFrequencyData = function (
      ...args: BrowserAny[]
    ) {
      const array = args[0];
      originalGetFloatFrequencyData.apply(this, args);
      for (let i = 0; i < array.length; i += Math.max(1, Math.floor(array.length / 64))) {
        array[i] += ((stableNumber(snapshot.audio.seed, i) % 5) - 2) * 0.000001;
      }
    };
  }

  if (browserGlobal.FontFaceSet?.prototype) {
    const originalCheck = browserGlobal.FontFaceSet.prototype.check;
    browserGlobal.FontFaceSet.prototype.check = function (...args: BrowserAny[]) {
      const font = String(args[0] || '');
      const matched = snapshot.fonts.some(fontName => font.includes(fontName));
      return matched || originalCheck.apply(this, args);
    };
  }

  defineValue(stateWindow, '__chromePowerFingerprintState', {
    profileId: snapshot.profileId,
    templateId: snapshot.templateId,
    canvasSeed: snapshot.canvas.seed,
    audioSeed: snapshot.audio.seed,
    webgpuMode: snapshot.webgpu.mode,
  });
}

export const getFingerprintOverrideSource = (snapshot: FingerprintSnapshot) =>
  `;(${installFingerprintOverrides.toString()})(${JSON.stringify(snapshot)});`;

export const getInternalFingerprintExtensionPath = (windowDataDir: string) =>
  join(windowDataDir, EXTENSION_DIR_NAME);

export const ensureInternalFingerprintExtension = (
  windowDataDir: string,
  snapshot: FingerprintSnapshot,
) => {
  const extensionPath = getInternalFingerprintExtensionPath(windowDataDir);
  mkdirSync(extensionPath, {recursive: true, mode: 0o755});

  const manifest = {
    manifest_version: 3,
    name: 'Chrome Power Fingerprint Guard',
    version: EXTENSION_VERSION,
    content_scripts: [
      {
        matches: ['<all_urls>'],
        js: ['content.js'],
        run_at: 'document_start',
        all_frames: true,
        match_about_blank: true,
        world: 'MAIN',
      },
    ],
    host_permissions: ['<all_urls>'],
  };

  const overrideSource = getFingerprintOverrideSource(snapshot);
  const contentScript = `
${overrideSource}
(() => {
  const source = ${JSON.stringify(overrideSource)};
  try {
    const script = document.createElement('script');
    script.textContent = source;
    (document.documentElement || document.head || document.body).prepend(script);
    script.remove();
  } catch (_) {}
})();
`;

  writeFileIfChanged(
    join(extensionPath, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  writeFileIfChanged(join(extensionPath, 'content.js'), contentScript.trimStart());

  return extensionPath;
};
