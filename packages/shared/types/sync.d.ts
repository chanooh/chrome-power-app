export type SyncEngine = 'hybrid' | 'native';
export type SyncFailurePolicy = 'isolate';
export type SyncTargetStatus = 'ready' | 'syncing' | 'degraded' | 'disconnected';

export type SyncNativeEventType =
  | 'leftMouseDown'
  | 'leftMouseUp'
  | 'rightMouseDown'
  | 'rightMouseUp'
  | 'otherMouseDown'
  | 'otherMouseUp'
  | 'mouseMoved'
  | 'leftMouseDragged'
  | 'rightMouseDragged'
  | 'otherMouseDragged'
  | 'scrollWheel'
  | 'keyDown'
  | 'keyUp'
  | 'flagsChanged';

export interface SyncNativeEvent {
  type: SyncNativeEventType;
  x: number;
  y: number;
  button: number;
  clickCount: number;
  deltaX: number;
  deltaY: number;
  keyCode: number;
  flags: number;
  timestamp: number;
  sourcePid: number;
  text?: string;
}

export interface SyncPermissionStatus {
  supported: boolean;
  accessibility: boolean;
  listenEvents: boolean;
  postEvents: boolean;
  ready: boolean;
}

export interface SyncCapabilities {
  supported: boolean;
  platform: string;
  arch: string;
  maxProfiles: number;
  engines: SyncEngine[];
  nativeCapture: boolean;
  cdp: boolean;
}

export interface SyncOptions {
  engine: SyncEngine;
  enableMouseSync: boolean;
  enableKeyboardSync: boolean;
  enableWheelSync: boolean;
  enableTextSync: boolean;
  enableClipboardSync: boolean;
  enableTabSync: boolean;
  enableExtensionSync: boolean;
  allowSensitiveInput: boolean;
  autoArrange: boolean;
  monitorIndex: number;
  columns: number;
  spacing: number;
  height: number;
  mouseMoveThrottleMs: number;
  wheelThrottleMs: number;
  failurePolicy: SyncFailurePolicy;
}

export interface SyncStartRequest {
  masterWindowId: number;
  slaveWindowIds: number[];
  options?: Partial<SyncOptions>;
}

export interface SyncMetrics {
  eventsCaptured: number;
  eventsDispatched: number;
  eventsCoalesced: number;
  eventsFailed: number;
  averageLatencyMs: number;
  p95LatencyMs: number;
}

export interface SyncTargetState {
  windowId: number;
  profileId: string;
  pid: number;
  status: SyncTargetStatus;
  targetCount: number;
  queueDepth: number;
  latencyMs: number;
  consecutiveFailures: number;
  warning?: string;
  error?: string;
}

export interface SyncSessionStatus {
  sessionId?: string;
  active: boolean;
  startedAt?: string;
  masterWindowId?: number;
  masterPid?: number;
  options?: SyncOptions;
  permissions: SyncPermissionStatus;
  targets: SyncTargetState[];
  metrics: SyncMetrics;
  warning?: string;
  error?: string;
}

export interface SyncActionResult {
  success: boolean;
  error?: string;
  status?: SyncSessionStatus;
}
