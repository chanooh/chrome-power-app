export interface OperationResult {
  success: boolean;
  message: string;
  data?: SafeAny;
}

export type BrowserMode = 'managed' | 'local';

export interface SettingOptions {
  profileCachePath: string;
  browserMode: BrowserMode;
  managedBrowserRoot: string;
  managedBrowserVersion: string;
  managedBrowserManifestPath: string;
  useLocalChrome: boolean;
  localChromePath: string;
  chromiumBinPath: string;
  automationConnect: boolean;
}

export interface ManagedBrowserCoreStatus {
  available: boolean;
  version: string;
  rootPath: string;
  manifestPath: string;
  executablePath: string;
  mounted: boolean;
  manifestExists: boolean;
  executableExists: boolean;
  hashVerified: boolean;
  versionVerified: boolean;
  message: string;
}

export type NoticeType = 'info' | 'success' | 'error' | 'warning' | 'loading';

export interface BridgeMessage {
  type: NoticeType;
  text: string;
}
