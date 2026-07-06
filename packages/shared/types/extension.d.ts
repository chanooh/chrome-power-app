export type ExtensionSourceType = 'zip' | 'directory' | 'legacy';

export interface ExtensionManifestInfo {
  name: string;
  version: string;
  manifest_version: number;
  description?: string;
  permissions: string[];
  host_permissions: string[];
  update_url_removed: boolean;
}

export interface ExtensionImportResult {
  success: boolean;
  message?: string;
  error?: string;
  extensionId?: number;
  path?: string;
  currentPath?: string;
  repositoryPath?: string;
  version?: string;
  sha256?: string;
  manifest?: ExtensionManifestInfo;
  runningWindowIds?: number[];
}

export interface ExtensionVerificationResult {
  success: boolean;
  extensionId: number;
  message: string;
  path?: string;
  expectedSha256?: string;
  actualSha256?: string;
  manifest?: ExtensionManifestInfo;
  updateUrlPresent?: boolean;
}
