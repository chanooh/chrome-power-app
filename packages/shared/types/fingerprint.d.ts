export type MacDeviceTemplateId =
  | 'auto'
  | 'mac-mini-m4'
  | 'macbook-pro-14-m4'
  | 'imac-24-m4';

export type FingerprintDiagnosticStatus = 'pass' | 'warning' | 'fail';

export interface FingerprintNavigatorSnapshot {
  platform: 'MacIntel';
  vendor: 'Google Inc.';
  hardwareConcurrency: number;
  deviceMemory: number;
  maxTouchPoints: number;
}

export interface FingerprintUaBrand {
  brand: string;
  version: string;
}

export interface FingerprintUaHighEntropy {
  architecture: string;
  bitness: string;
  brands: FingerprintUaBrand[];
  fullVersionList: FingerprintUaBrand[];
  mobile: boolean;
  model: string;
  platform: string;
  platformVersion: string;
  uaFullVersion: string;
  fullVersion: string;
  wow64: boolean;
}

export interface FingerprintScreenSnapshot {
  width: number;
  height: number;
  availWidth: number;
  availHeight: number;
  colorDepth: number;
  pixelDepth: number;
  deviceScaleFactor: number;
}

export interface FingerprintWebglSnapshot {
  vendor: string;
  renderer: string;
  unmaskedVendor: string;
  unmaskedRenderer: string;
}

export interface FingerprintNoiseSnapshot {
  mode: 'stable-native-noise';
  seed: string;
}

export interface FingerprintWebgpuSnapshot {
  mode: 'native-masked-adapter-info';
  vendor: string;
  architecture: string;
  device: string;
  description: string;
}

export interface FingerprintMediaDeviceSnapshot {
  kind: 'audioinput' | 'audiooutput' | 'videoinput';
  label: string;
  deviceId: string;
  groupId: string;
}

export interface FingerprintSnapshot {
  schemaVersion: 2;
  fingerprintEngineVersion: string;
  profileId: string;
  generationId?: string;
  managedBrowserVersion: string;
  requestedTemplateId: MacDeviceTemplateId;
  templateId: Exclude<MacDeviceTemplateId, 'auto'>;
  templateConfidence: 'high';
  nativePatchRequired: boolean;
  seed: string;
  ua: string;
  uaCh: FingerprintUaHighEntropy;
  locale: string;
  languages: string[];
  timezone: string;
  platform: 'MacIntel';
  hardwareConcurrency: number;
  deviceMemory: number;
  navigator: FingerprintNavigatorSnapshot;
  screen: FingerprintScreenSnapshot;
  fonts: string[];
  webgl: FingerprintWebglSnapshot;
  webgpu: FingerprintWebgpuSnapshot;
  noise: {
    canvas: number;
    audio: number;
    webgl: number;
  };
  canvas: FingerprintNoiseSnapshot;
  audio: FingerprintNoiseSnapshot;
  mediaDevices: FingerprintMediaDeviceSnapshot[];
  networkConsistency: {
    proxyRequired: boolean;
    webrtcPolicy: 'disable_non_proxied_udp';
    timezoneSource: 'snapshot' | 'proxy';
    localeSource: 'snapshot' | 'proxy';
  };
}

export interface FingerprintRegenerationResult {
  success: boolean;
  message: string;
  data?: FingerprintSnapshot;
}

export interface MacDeviceTemplate {
  id: Exclude<MacDeviceTemplateId, 'auto'>;
  name: string;
  model: string;
  cpuLabel: string;
  screen: FingerprintScreenSnapshot;
  hardwareConcurrency: number;
  deviceMemory: number;
  webglRenderer: string;
  webgpu: {
    vendor: string;
    architecture: string;
    device: string;
    description: string;
  };
  mediaLabels: {
    microphone: string;
    camera: string;
    speaker: string;
  };
}

export interface FingerprintDiagnosticItem {
  key: string;
  label: string;
  expected: string;
  actual: string;
  status: FingerprintDiagnosticStatus;
  message?: string;
}

export interface FingerprintDiagnosticResult {
  windowId: number;
  profileId: string;
  overallStatus: FingerprintDiagnosticStatus;
  items: FingerprintDiagnosticItem[];
  limitations: string[];
}
