import {createHash} from 'crypto';
import {
  FINGERPRINT_TEMPLATE_AUTO_ID,
  MAC_DEVICE_TEMPLATE_OPTIONS,
} from '../../../shared/constants/fingerprint';
import type {
  FingerprintMediaDeviceSnapshot,
  FingerprintSnapshot,
  FingerprintUaBrand,
  MacDeviceTemplate,
  MacDeviceTemplateId,
} from '../../../shared/types/fingerprint';
import {MANAGED_CHROMIUM_VERSION} from '../browser-core/managed-core';

type ConcreteTemplateId = Exclude<MacDeviceTemplateId, 'auto'>;

const CHROMIUM_MAJOR_VERSION = MANAGED_CHROMIUM_VERSION.split('.')[0];
const CHROMIUM_REDUCED_VERSION = `${CHROMIUM_MAJOR_VERSION}.0.0.0`;
const MACOS_REDUCED_UA_VERSION = '10_15_7';

const BASE_UA = `Mozilla/5.0 (Macintosh; Intel Mac OS X ${MACOS_REDUCED_UA_VERSION}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_REDUCED_VERSION} Safari/537.36`;

const COMMON_MAC_FONTS = [
  'Arial',
  'Arial Black',
  'Arial Narrow',
  'Avenir',
  'Avenir Next',
  'Courier New',
  'Georgia',
  'Helvetica',
  'Helvetica Neue',
  'Menlo',
  'Monaco',
  'San Francisco',
  'Times',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana',
];

const LOCALE_TIMEZONE_POOL = [
  {locale: 'en-US', languages: ['en-US', 'en'], timezone: 'America/Los_Angeles'},
  {locale: 'en-US', languages: ['en-US', 'en'], timezone: 'America/New_York'},
  {locale: 'en-GB', languages: ['en-GB', 'en'], timezone: 'Europe/London'},
  {locale: 'en-CA', languages: ['en-CA', 'en-US', 'en'], timezone: 'America/Toronto'},
  {locale: 'en-AU', languages: ['en-AU', 'en'], timezone: 'Australia/Sydney'},
];

const TEMPLATES: MacDeviceTemplate[] = [
  {
    id: 'macbook-air-13',
    name: 'MacBook Air 13',
    model: 'MacBookAir10,1',
    cpuLabel: 'Apple M2',
    screen: {
      width: 1470,
      height: 956,
      availWidth: 1470,
      availHeight: 923,
      colorDepth: 30,
      pixelDepth: 30,
      deviceScaleFactor: 2,
    },
    hardwareConcurrency: 8,
    deviceMemory: 8,
    webglRenderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)',
    mediaLabels: {
      microphone: 'MacBook Air Microphone',
      camera: 'FaceTime HD Camera',
      speaker: 'MacBook Air Speakers',
    },
  },
  {
    id: 'macbook-pro-14',
    name: 'MacBook Pro 14',
    model: 'MacBookPro18,3',
    cpuLabel: 'Apple M3 Pro',
    screen: {
      width: 1512,
      height: 982,
      availWidth: 1512,
      availHeight: 945,
      colorDepth: 30,
      pixelDepth: 30,
      deviceScaleFactor: 2,
    },
    hardwareConcurrency: 12,
    deviceMemory: 16,
    webglRenderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified Version)',
    mediaLabels: {
      microphone: 'MacBook Pro Microphone',
      camera: 'FaceTime HD Camera',
      speaker: 'MacBook Pro Speakers',
    },
  },
  {
    id: 'imac-24',
    name: 'iMac 24',
    model: 'iMac21,1',
    cpuLabel: 'Apple M3',
    screen: {
      width: 2240,
      height: 1260,
      availWidth: 2240,
      availHeight: 1215,
      colorDepth: 30,
      pixelDepth: 30,
      deviceScaleFactor: 2,
    },
    hardwareConcurrency: 8,
    deviceMemory: 8,
    webglRenderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3, Unspecified Version)',
    mediaLabels: {
      microphone: 'iMac Microphone',
      camera: 'FaceTime HD Camera',
      speaker: 'iMac Speakers',
    },
  },
  {
    id: 'mac-mini',
    name: 'Mac mini',
    model: 'Macmini9,1',
    cpuLabel: 'Apple M4',
    screen: {
      width: 1920,
      height: 1080,
      availWidth: 1920,
      availHeight: 1040,
      colorDepth: 24,
      pixelDepth: 24,
      deviceScaleFactor: 1,
    },
    hardwareConcurrency: 10,
    deviceMemory: 16,
    webglRenderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)',
    mediaLabels: {
      microphone: 'External Microphone',
      camera: 'Studio Display Camera',
      speaker: 'External Speakers',
    },
  },
];

const TEMPLATE_IDS = TEMPLATES.map(template => template.id);

const hashHex = (value: string) =>
  createHash('sha256')
    .update(value)
    .digest('hex');

const stableIndex = (seed: string, modulo: number) => {
  const first32Bits = Number.parseInt(hashHex(seed).slice(0, 8), 16);
  return first32Bits % modulo;
};

const stableId = (profileId: string, key: string) =>
  hashHex(`chrome-power:${MANAGED_CHROMIUM_VERSION}:${profileId}:${key}`).slice(0, 32);

export const normalizeMacDeviceTemplateId = (
  templateId?: string | null,
): MacDeviceTemplateId => {
  if (!templateId) {
    return FINGERPRINT_TEMPLATE_AUTO_ID;
  }
  return MAC_DEVICE_TEMPLATE_OPTIONS.some(template => template.id === templateId)
    ? (templateId as MacDeviceTemplateId)
    : FINGERPRINT_TEMPLATE_AUTO_ID;
};

export const resolveMacDeviceTemplate = (
  profileId: string,
  requestedTemplateId?: string | null,
) => {
  const normalizedTemplateId = normalizeMacDeviceTemplateId(requestedTemplateId);
  let templateId: ConcreteTemplateId;
  if (normalizedTemplateId === FINGERPRINT_TEMPLATE_AUTO_ID) {
    templateId =
      TEMPLATE_IDS[
        stableIndex(`template:${profileId}:${MANAGED_CHROMIUM_VERSION}`, TEMPLATE_IDS.length)
      ];
  } else {
    templateId = normalizedTemplateId as ConcreteTemplateId;
  }
  const template = TEMPLATES.find(item => item.id === templateId);
  if (!template) {
    throw new Error(`Unknown macOS fingerprint template: ${templateId}`);
  }
  return {
    requestedTemplateId: normalizedTemplateId,
    template,
  };
};

const getUaBrands = (): FingerprintUaBrand[] => [
  {brand: 'Chromium', version: CHROMIUM_MAJOR_VERSION},
  {brand: 'Not=A?Brand', version: '24'},
];

const getFullVersionBrands = (): FingerprintUaBrand[] => [
  {brand: 'Chromium', version: MANAGED_CHROMIUM_VERSION},
  {brand: 'Not=A?Brand', version: '24.0.0.0'},
];

const createMediaDevices = (
  profileId: string,
  labels: MacDeviceTemplate['mediaLabels'],
): FingerprintMediaDeviceSnapshot[] => {
  const groupId = stableId(profileId, 'media:group');
  return [
    {
      kind: 'audioinput',
      label: labels.microphone,
      deviceId: stableId(profileId, 'media:audioinput'),
      groupId,
    },
    {
      kind: 'videoinput',
      label: labels.camera,
      deviceId: stableId(profileId, 'media:videoinput'),
      groupId,
    },
    {
      kind: 'audiooutput',
      label: labels.speaker,
      deviceId: stableId(profileId, 'media:audiooutput'),
      groupId,
    },
  ];
};

export const generateFingerprintSnapshot = (
  profileId: string,
  requestedTemplateId?: string | null,
): FingerprintSnapshot => {
  if (!profileId) {
    throw new Error('Cannot generate a fingerprint snapshot without profile_id');
  }

  const {requestedTemplateId: normalizedTemplateId, template} = resolveMacDeviceTemplate(
    profileId,
    requestedTemplateId,
  );
  const localeTimezone =
    LOCALE_TIMEZONE_POOL[
      stableIndex(`locale:${profileId}:${template.id}`, LOCALE_TIMEZONE_POOL.length)
    ];
  const seed = stableId(profileId, `snapshot:${template.id}`);

  return {
    schemaVersion: 1,
    profileId,
    managedBrowserVersion: MANAGED_CHROMIUM_VERSION,
    requestedTemplateId: normalizedTemplateId,
    templateId: template.id,
    seed,
    ua: BASE_UA,
    uaCh: {
      architecture: 'arm',
      bitness: '64',
      brands: getUaBrands(),
      fullVersionList: getFullVersionBrands(),
      mobile: false,
      model: '',
      platform: 'macOS',
      platformVersion: '26.5.0',
      uaFullVersion: MANAGED_CHROMIUM_VERSION,
      wow64: false,
    },
    locale: localeTimezone.locale,
    languages: localeTimezone.languages,
    timezone: localeTimezone.timezone,
    navigator: {
      platform: 'MacIntel',
      vendor: 'Google Inc.',
      hardwareConcurrency: template.hardwareConcurrency,
      deviceMemory: template.deviceMemory,
      maxTouchPoints: 0,
    },
    screen: template.screen,
    fonts: [...COMMON_MAC_FONTS],
    webgl: {
      vendor: 'WebKit',
      renderer: 'WebKit WebGL',
      unmaskedVendor: 'Google Inc. (Apple)',
      unmaskedRenderer: template.webglRenderer,
    },
    webgpu: {
      mode: 'disabled',
      reason: 'P2 masks WebGPU without rebuilding Chromium',
    },
    canvas: {
      mode: 'stable-noise',
      seed: stableId(profileId, 'canvas'),
    },
    audio: {
      mode: 'stable-noise',
      seed: stableId(profileId, 'audio'),
    },
    mediaDevices: createMediaDevices(profileId, template.mediaLabels),
  };
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const isFingerprintSnapshot = (value: unknown): value is FingerprintSnapshot => {
  if (!isObject(value)) {
    return false;
  }
  return (
    value.schemaVersion === 1 &&
    typeof value.profileId === 'string' &&
    value.managedBrowserVersion === MANAGED_CHROMIUM_VERSION &&
    typeof value.ua === 'string' &&
    typeof value.timezone === 'string' &&
    isObject(value.navigator) &&
    isObject(value.screen) &&
    isObject(value.webgl) &&
    isObject(value.webgpu) &&
    isObject(value.canvas) &&
    isObject(value.audio) &&
    Array.isArray(value.fonts) &&
    Array.isArray(value.mediaDevices)
  );
};

export const parseFingerprintSnapshot = (
  fingerprint?: string | null | unknown,
): FingerprintSnapshot | null => {
  if (!fingerprint) {
    return null;
  }
  try {
    const parsed = typeof fingerprint === 'string' ? JSON.parse(fingerprint) : fingerprint;
    return isFingerprintSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const serializeFingerprintSnapshot = (snapshot: FingerprintSnapshot) =>
  JSON.stringify(snapshot);
