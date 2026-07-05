export type MacDeviceTemplateId =
  | 'auto'
  | 'macbook-air-13'
  | 'macbook-pro-14'
  | 'imac-24'
  | 'mac-mini';

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
  mode: 'stable-noise';
  seed: string;
}

export interface FingerprintWebgpuSnapshot {
  mode: 'disabled';
  reason: string;
}

export interface FingerprintMediaDeviceSnapshot {
  kind: 'audioinput' | 'audiooutput' | 'videoinput';
  label: string;
  deviceId: string;
  groupId: string;
}

export interface FingerprintSnapshot {
  schemaVersion: 1;
  profileId: string;
  managedBrowserVersion: string;
  requestedTemplateId: MacDeviceTemplateId;
  templateId: Exclude<MacDeviceTemplateId, 'auto'>;
  seed: string;
  ua: string;
  uaCh: FingerprintUaHighEntropy;
  locale: string;
  languages: string[];
  timezone: string;
  navigator: FingerprintNavigatorSnapshot;
  screen: FingerprintScreenSnapshot;
  fonts: string[];
  webgl: FingerprintWebglSnapshot;
  webgpu: FingerprintWebgpuSnapshot;
  canvas: FingerprintNoiseSnapshot;
  audio: FingerprintNoiseSnapshot;
  mediaDevices: FingerprintMediaDeviceSnapshot[];
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
