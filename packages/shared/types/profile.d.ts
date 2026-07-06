import type {DB} from './db';
import type {FingerprintSnapshot} from './fingerprint';

export type ProfileStorageHealth = 'ok' | 'warning' | 'error';

export interface ProfileStorageStatus {
  windowId?: number;
  profileId: string;
  path: string;
  exists: boolean;
  running: boolean;
  sizeBytes: number;
  permissions?: string;
  lastModifiedAt?: string;
  health: ProfileStorageHealth;
  issues: string[];
}

export interface ProfileBackupManifest {
  schemaVersion: 1;
  kind: 'chrome-power-profile';
  exportedAt: string;
  appVersion?: string;
  chromiumVersion: string;
  profileId: string;
  profileDirectoryName: 'profile';
  window: Partial<DB.Window>;
  fingerprint?: FingerprintSnapshot;
  proxy?: {
    id?: number | null;
    proxy?: string;
    proxy_type?: string;
    ip?: string;
    ip_country?: string;
    remark?: string;
  };
}

export interface ProfileBackupResult {
  success: boolean;
  message: string;
  archivePath?: string;
  manifest?: ProfileBackupManifest;
}

export interface ProfileRestoreResult {
  success: boolean;
  message: string;
  windowId?: number;
  profileId?: string;
}

export interface OrphanProfile {
  profileId: string;
  path: string;
  sizeBytes: number;
  lastModifiedAt?: string;
}
