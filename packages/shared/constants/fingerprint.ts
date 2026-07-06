import type {MacDeviceTemplateId} from '../types/fingerprint';

export const FINGERPRINT_TEMPLATE_AUTO_ID: MacDeviceTemplateId = 'auto';

export const MAC_DEVICE_TEMPLATE_OPTIONS: Array<{
  id: MacDeviceTemplateId;
  name: string;
  description: string;
}> = [
  {
    id: 'auto',
    name: 'Auto',
    description: 'Stable macOS template selected from the profile id',
  },
  {
    id: 'mac-mini-m4',
    name: 'Mac mini M4',
    description: 'High-confidence Apple M4 desktop profile with external display',
  },
  {
    id: 'macbook-pro-14-m4',
    name: 'MacBook Pro 14 M4',
    description: 'High-confidence Apple M4 laptop profile with Retina display',
  },
  {
    id: 'imac-24-m4',
    name: 'iMac 24 M4',
    description: 'High-confidence Apple M4 desktop profile with built-in Retina display',
  },
];
