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

export const FINGERPRINT_ENGINE_VERSION = 'native-macos-v2';

const CHROMIUM_MAJOR_VERSION = MANAGED_CHROMIUM_VERSION.split('.')[0];
const CHROMIUM_REDUCED_VERSION = `${CHROMIUM_MAJOR_VERSION}.0.0.0`;
const MACOS_REDUCED_UA_VERSION = '10_15_7';
const MACOS_PLATFORM_VERSION = '26.5.0';

const BASE_UA = `Mozilla/5.0 (Macintosh; Intel Mac OS X ${MACOS_REDUCED_UA_VERSION}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_REDUCED_VERSION} Safari/537.36`;

const COMMON_MAC_FONTS = [
  'Arial',
  'Courier New',
  'Helvetica',
  'Helvetica Neue',
  'Menlo',
  'Monaco',
  'San Francisco',
  'Times',
  'Times New Roman',
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
    id: 'mac-mini-m4',
    name: 'Mac mini M4',
    model: 'Mac16,10',
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
    webgpu: {
      vendor: 'Apple',
      architecture: 'Apple M4',
      device: 'Apple M4',
      description: 'Apple M4',
    },
    mediaLabels: {
      microphone: 'External Microphone',
      camera: 'Studio Display Camera',
      speaker: 'External Speakers',
    },
  },
  {
    id: 'macbook-pro-14-m4',
    name: 'MacBook Pro 14 M4',
    model: 'Mac16,1',
    cpuLabel: 'Apple M4',
    screen: {
      width: 1512,
      height: 982,
      availWidth: 1512,
      availHeight: 945,
      colorDepth: 30,
      pixelDepth: 30,
      deviceScaleFactor: 2,
    },
    hardwareConcurrency: 10,
    deviceMemory: 16,
    webglRenderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)',
    webgpu: {
      vendor: 'Apple',
      architecture: 'Apple M4',
      device: 'Apple M4',
      description: 'Apple M4',
    },
    mediaLabels: {
      microphone: 'MacBook Pro Microphone',
      camera: 'FaceTime HD Camera',
      speaker: 'MacBook Pro Speakers',
    },
  },
  {
    id: 'imac-24-m4',
    name: 'iMac 24 M4',
    model: 'Mac16,12',
    cpuLabel: 'Apple M4',
    screen: {
      width: 2240,
      height: 1260,
      availWidth: 2240,
      availHeight: 1215,
      colorDepth: 30,
      pixelDepth: 30,
      deviceScaleFactor: 2,
    },
    hardwareConcurrency: 10,
    deviceMemory: 16,
    webglRenderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)',
    webgpu: {
      vendor: 'Apple',
      architecture: 'Apple M4',
      device: 'Apple M4',
      description: 'Apple M4',
    },
    mediaLabels: {
      microphone: 'iMac Microphone',
      camera: 'FaceTime HD Camera',
      speaker: 'iMac Speakers',
    },
  },
];

const LEGACY_TEMPLATE_ID_MAP: Record<string, ConcreteTemplateId> = {
  'macbook-air-13': 'macbook-pro-14-m4',
  'macbook-pro-14': 'macbook-pro-14-m4',
  'imac-24': 'imac-24-m4',
  'mac-mini': 'mac-mini-m4',
};

const TEMPLATE_IDS = TEMPLATES.map(template => template.id);

const hashHex = (value: string) =>
  createHash('sha256')
    .update(value)
    .digest('hex');

const stableUint32 = (seed: string) => Number.parseInt(hashHex(seed).slice(0, 8), 16);

const stableIndex = (seed: string, modulo: number) => stableUint32(seed) % modulo;

const stableId = (profileId: string, key: string) =>
  hashHex(`chrome-power:${MANAGED_CHROMIUM_VERSION}:${FINGERPRINT_ENGINE_VERSION}:${profileId}:${key}`).slice(0, 32);

export const normalizeMacDeviceTemplateId = (
  templateId?: string | null,
): MacDeviceTemplateId => {
  if (!templateId) {
    return FINGERPRINT_TEMPLATE_AUTO_ID;
  }
  if (templateId in LEGACY_TEMPLATE_ID_MAP) {
    return LEGACY_TEMPLATE_ID_MAP[templateId];
  }
  return MAC_DEVICE_TEMPLATE_OPTIONS.some(template => template.id === templateId)
    ? (templateId as MacDeviceTemplateId)
    : FINGERPRINT_TEMPLATE_AUTO_ID;
};

export const resolveMacDeviceTemplate = (
  profileId: string,
  requestedTemplateId?: string | null,
  generationId?: string,
) => {
  const normalizedTemplateId = normalizeMacDeviceTemplateId(requestedTemplateId);
  const stableProfileKey = generationId ? `${profileId}:generation:${generationId}` : profileId;
  let templateId: ConcreteTemplateId;
  if (normalizedTemplateId === FINGERPRINT_TEMPLATE_AUTO_ID) {
    templateId =
      TEMPLATE_IDS[
        stableIndex(
          `template:${stableProfileKey}:${MANAGED_CHROMIUM_VERSION}:${FINGERPRINT_ENGINE_VERSION}`,
          TEMPLATE_IDS.length,
        )
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
  generationId?: string,
): FingerprintSnapshot => {
  if (!profileId) {
    throw new Error('Cannot generate a fingerprint snapshot without profile_id');
  }

  const normalizedGenerationId = generationId?.trim() || undefined;
  const stableProfileKey = normalizedGenerationId
    ? `${profileId}:generation:${normalizedGenerationId}`
    : profileId;
  const {requestedTemplateId: normalizedTemplateId, template} = resolveMacDeviceTemplate(
    profileId,
    requestedTemplateId,
    normalizedGenerationId,
  );
  const localeTimezone =
    LOCALE_TIMEZONE_POOL[
      stableIndex(`locale:${stableProfileKey}:${template.id}`, LOCALE_TIMEZONE_POOL.length)
    ];
  const seed = stableId(stableProfileKey, `snapshot:${template.id}`);

  return {
    schemaVersion: 2,
    fingerprintEngineVersion: FINGERPRINT_ENGINE_VERSION,
    profileId,
    ...(normalizedGenerationId ? {generationId: normalizedGenerationId} : {}),
    managedBrowserVersion: MANAGED_CHROMIUM_VERSION,
    requestedTemplateId: normalizedTemplateId,
    templateId: template.id,
    templateConfidence: 'high',
    nativePatchRequired: true,
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
      platformVersion: MACOS_PLATFORM_VERSION,
      uaFullVersion: MANAGED_CHROMIUM_VERSION,
      fullVersion: MANAGED_CHROMIUM_VERSION,
      wow64: false,
    },
    locale: localeTimezone.locale,
    languages: localeTimezone.languages,
    timezone: localeTimezone.timezone,
    platform: 'MacIntel',
    hardwareConcurrency: template.hardwareConcurrency,
    deviceMemory: template.deviceMemory,
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
      mode: 'native-masked-adapter-info',
      vendor: template.webgpu.vendor,
      architecture: template.webgpu.architecture,
      device: template.webgpu.device,
      description: template.webgpu.description,
    },
    noise: {
      canvas: stableUint32(stableId(stableProfileKey, 'canvas:native')),
      audio: stableUint32(stableId(stableProfileKey, 'audio:native')),
      webgl: stableUint32(stableId(stableProfileKey, 'webgl:native')),
    },
    canvas: {
      mode: 'stable-native-noise',
      seed: stableId(stableProfileKey, 'canvas'),
    },
    audio: {
      mode: 'stable-native-noise',
      seed: stableId(stableProfileKey, 'audio'),
    },
    mediaDevices: createMediaDevices(stableProfileKey, template.mediaLabels),
    networkConsistency: {
      proxyRequired: true,
      webrtcPolicy: 'disable_non_proxied_udp',
      timezoneSource: 'snapshot',
      localeSource: 'snapshot',
    },
  };
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isFingerprintSnapshotV2 = (value: unknown): value is FingerprintSnapshot => {
  if (!isObject(value)) {
    return false;
  }
  return (
    value.schemaVersion === 2 &&
    value.fingerprintEngineVersion === FINGERPRINT_ENGINE_VERSION &&
    typeof value.profileId === 'string' &&
    (value.generationId === undefined || typeof value.generationId === 'string') &&
    value.managedBrowserVersion === MANAGED_CHROMIUM_VERSION &&
    typeof value.ua === 'string' &&
    typeof value.timezone === 'string' &&
    typeof value.platform === 'string' &&
    typeof value.hardwareConcurrency === 'number' &&
    typeof value.deviceMemory === 'number' &&
    isObject(value.navigator) &&
    isObject(value.screen) &&
    isObject(value.webgl) &&
    isObject(value.webgpu) &&
    isObject(value.noise) &&
    isObject(value.canvas) &&
    isObject(value.audio) &&
    isObject(value.networkConsistency) &&
    Array.isArray(value.fonts) &&
    Array.isArray(value.mediaDevices)
  );
};

const migrateLegacySnapshot = (value: Record<string, unknown>): FingerprintSnapshot | null => {
  if (value.schemaVersion !== 1 || typeof value.profileId !== 'string') {
    return null;
  }
  return generateFingerprintSnapshot(
    value.profileId,
    typeof value.templateId === 'string'
      ? value.templateId
      : typeof value.requestedTemplateId === 'string'
        ? value.requestedTemplateId
        : undefined,
  );
};

export const isFingerprintSnapshot = (value: unknown): value is FingerprintSnapshot =>
  isFingerprintSnapshotV2(value);

export const parseFingerprintSnapshot = (
  fingerprint?: string | null | unknown,
): FingerprintSnapshot | null => {
  if (!fingerprint) {
    return null;
  }
  try {
    const parsed = typeof fingerprint === 'string' ? JSON.parse(fingerprint) : fingerprint;
    if (isFingerprintSnapshotV2(parsed)) {
      return parsed;
    }
    return isObject(parsed) ? migrateLegacySnapshot(parsed) : null;
  } catch {
    return null;
  }
};

export const serializeFingerprintSnapshot = (snapshot: FingerprintSnapshot) =>
  JSON.stringify(snapshot);
