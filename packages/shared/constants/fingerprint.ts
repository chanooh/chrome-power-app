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
    id: 'macbook-air-13',
    name: 'MacBook Air 13',
    description: 'Apple Silicon laptop profile with compact Retina display',
  },
  {
    id: 'macbook-pro-14',
    name: 'MacBook Pro 14',
    description: 'Apple Silicon Pro laptop profile with high-DPI display',
  },
  {
    id: 'imac-24',
    name: 'iMac 24',
    description: 'Apple Silicon desktop profile with built-in Retina display',
  },
  {
    id: 'mac-mini',
    name: 'Mac mini',
    description: 'Apple Silicon desktop profile with external display',
  },
];
