import axios from 'axios';
import {BrowserWindow, ipcMain, shell, systemPreferences} from 'electron';
import {randomUUID} from 'node:crypto';
import type {DB} from '../../../shared/types/db';
import type {
  SyncActionResult,
  SyncCapabilities,
  SyncMetrics,
  SyncNativeEvent,
  SyncOptions,
  SyncPermissionStatus,
  SyncSessionStatus,
  SyncStartRequest,
  SyncTargetState,
} from '../../../shared/types/sync';
import {createLogger} from '../../../shared/utils/logger';
import {profileLeaseRegistry} from '../automation/profile-lease';
import {SERVICE_LOGGER_LABEL} from '../constants';
import {WindowDB} from '../db/window';
import {CdpClient} from '../sync/cdp-client';
import {SyncDispatchQueue} from '../sync/dispatch-queue';
import {containsPoint, mapRelativePoint, type Rectangle} from '../sync/geometry';
import {
  getNativeWindowManager,
  getNativeWindowManagerLoadError,
  type NativeWindowBounds,
  type NativeWindowInfo,
  type NativeWindowManager,
} from '../sync/native-addon';
import {
  CdpTargetRegistry,
  type ElementDescriptor,
  type SyncCdpTarget,
  type TextBridgePayload,
} from '../sync/target-registry';

const logger = createLogger(SERVICE_LOGGER_LABEL);
const MAX_SYNC_PROFILES = 30;
const MAX_CONSECUTIVE_FAILURES = 3;

export const DEFAULT_MAC_SYNC_OPTIONS: SyncOptions = {
  engine: 'hybrid',
  enableMouseSync: true,
  enableKeyboardSync: true,
  enableWheelSync: true,
  enableTextSync: true,
  enableClipboardSync: true,
  enableTabSync: true,
  enableExtensionSync: true,
  allowSensitiveInput: true,
  autoArrange: true,
  monitorIndex: 0,
  columns: 3,
  spacing: 10,
  height: 0,
  mouseMoveThrottleMs: 33,
  wheelThrottleMs: 33,
  failurePolicy: 'isolate',
};

interface SyncWindowRuntime {
  windowId: number;
  profileId: string;
  pid: number;
  port: number;
  bounds: Rectangle;
  client: CdpClient;
  registry: CdpTargetRegistry;
  removeDisconnectListener: () => void;
  queue?: SyncDispatchQueue;
  state: SyncTargetState;
}

interface ActiveSyncSession {
  sessionId: string;
  startedAt: string;
  options: SyncOptions;
  master: SyncWindowRuntime;
  slaves: Map<number, SyncWindowRuntime>;
  targetMappings: Map<string, Map<number, string>>;
  masterUrls: Map<string, string>;
  sequence: number;
  metrics: SyncMetrics;
  latencies: number[];
  eventChain: Promise<void>;
  pendingMouseEvent?: SyncNativeEvent;
  pendingWheelEvent?: SyncNativeEvent;
  mouseTimer?: NodeJS.Timeout;
  wheelTimer?: NodeJS.Timeout;
  lastMouseX: number;
  lastMouseY: number;
  lastMasterTargetId?: string;
  masterComposing: boolean;
  healthTimer?: NodeJS.Timeout;
}

const emptyMetrics = (): SyncMetrics => ({
  eventsCaptured: 0,
  eventsDispatched: 0,
  eventsCoalesced: 0,
  eventsFailed: 0,
  averageLatencyMs: 0,
  p95LatencyMs: 0,
});

const toRectangle = (bounds: NativeWindowBounds): Rectangle => ({
  x: bounds.x,
  y: bounds.y,
  width: bounds.width,
  height: bounds.height,
});

const normalizeUrl = (value: string) => {
  try {
    const url = new URL(value);
    if (url.hostname === 'localhost' && url.hash.startsWith('#/start'))
      return `${url.origin}${url.pathname}#/start`;
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return value;
  }
};

const cdpModifiers = (flags: number) =>
  ((flags & 0x80000) !== 0 ? 1 : 0) |
  ((flags & 0x40000) !== 0 ? 2 : 0) |
  ((flags & 0x100000) !== 0 ? 4 : 0) |
  ((flags & 0x20000) !== 0 ? 8 : 0);

const isMouseEvent = (event: SyncNativeEvent) => /Mouse|mouse|Dragged/.test(event.type);

const isMouseDown = (event: SyncNativeEvent) => /MouseDown$/.test(event.type);
const isMouseUp = (event: SyncNativeEvent) => /MouseUp$/.test(event.type);

const cdpButton = (button: number): 'left' | 'middle' | 'right' | 'back' | 'forward' => {
  if (button === 1) return 'right';
  if (button === 2) return 'middle';
  if (button === 3) return 'back';
  if (button === 4) return 'forward';
  return 'left';
};

interface CdpKeyDescriptor {
  key: string;
  code: string;
  windowsVirtualKeyCode: number;
}

const MAC_SPECIAL_KEYS: Record<number, CdpKeyDescriptor> = {
  36: {key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13},
  48: {key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9},
  49: {key: ' ', code: 'Space', windowsVirtualKeyCode: 32},
  51: {key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8},
  53: {key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27},
  114: {key: 'Insert', code: 'Insert', windowsVirtualKeyCode: 45},
  115: {key: 'Home', code: 'Home', windowsVirtualKeyCode: 36},
  116: {key: 'PageUp', code: 'PageUp', windowsVirtualKeyCode: 33},
  117: {key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46},
  119: {key: 'End', code: 'End', windowsVirtualKeyCode: 35},
  121: {key: 'PageDown', code: 'PageDown', windowsVirtualKeyCode: 34},
  123: {key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37},
  124: {key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39},
  125: {key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40},
  126: {key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38},
};

const MAC_LETTER_KEYS: Record<number, string> = {
  0: 'A',
  1: 'S',
  2: 'D',
  3: 'F',
  4: 'H',
  5: 'G',
  6: 'Z',
  7: 'X',
  8: 'C',
  9: 'V',
  11: 'B',
  12: 'Q',
  13: 'W',
  14: 'E',
  15: 'R',
  16: 'Y',
  17: 'T',
  31: 'O',
  32: 'U',
  34: 'I',
  35: 'P',
  37: 'L',
  38: 'J',
  40: 'K',
  45: 'N',
  46: 'M',
};

const describeCdpKey = (event: SyncNativeEvent): CdpKeyDescriptor => {
  const special = MAC_SPECIAL_KEYS[event.keyCode];
  if (special) return special;
  const letter = MAC_LETTER_KEYS[event.keyCode];
  if (letter) {
    return {
      key: event.text || letter.toLowerCase(),
      code: `Key${letter}`,
      windowsVirtualKeyCode: letter.charCodeAt(0),
    };
  }
  return {
    key: event.text || 'Unidentified',
    code: '',
    windowsVirtualKeyCode: 0,
  };
};

const nativeMouseEventName = (event: SyncNativeEvent) => {
  if (event.type === 'leftMouseDown') return 'mousedown';
  if (event.type === 'leftMouseUp') return 'mouseup';
  if (event.type === 'rightMouseDown') return 'rightdown';
  if (event.type === 'rightMouseUp') return 'rightup';
  return 'mousemove';
};

const emit = (channel: string, payload: unknown) => {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channel, payload);
};

class MacWindowSyncService {
  private readonly nativeManager?: NativeWindowManager;
  private session?: ActiveSyncSession;
  private lastStatus?: SyncSessionStatus;
  private statusEmitTimer?: NodeJS.Timeout;

  constructor() {
    this.nativeManager = getNativeWindowManager();
  }

  getCapabilities(): SyncCapabilities {
    return {
      supported: process.platform === 'darwin' && process.arch === 'arm64' && !!this.nativeManager,
      platform: process.platform,
      arch: process.arch,
      maxProfiles: MAX_SYNC_PROFILES,
      engines: ['hybrid', 'native'],
      nativeCapture: !!this.nativeManager,
      cdp: true,
    };
  }

  getPermissionStatus(): SyncPermissionStatus {
    if (process.platform !== 'darwin' || !this.nativeManager) {
      return {
        supported: false,
        accessibility: false,
        listenEvents: false,
        postEvents: false,
        ready: false,
      };
    }
    try {
      const native = this.nativeManager.getPermissionStatus();
      const accessibility =
        native.accessibility && systemPreferences.isTrustedAccessibilityClient(false);
      return {
        ...native,
        accessibility,
        ready: accessibility && native.listenEvents && native.postEvents,
      };
    } catch {
      return {
        supported: true,
        accessibility: false,
        listenEvents: false,
        postEvents: false,
        ready: false,
      };
    }
  }

  async requestPermissions(): Promise<SyncPermissionStatus> {
    if (process.platform !== 'darwin' || !this.nativeManager) return this.getPermissionStatus();
    systemPreferences.isTrustedAccessibilityClient(true);
    this.nativeManager.requestListenAccess();
    this.nativeManager.requestPostAccess();
    await new Promise(resolve => setTimeout(resolve, 300));
    return this.getPermissionStatus();
  }

  async openPermissionSettings(kind: 'accessibility' | 'inputMonitoring'): Promise<void> {
    const target =
      kind === 'inputMonitoring'
        ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent'
        : 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility';
    await shell.openExternal(target);
  }

  async start(request: SyncStartRequest): Promise<SyncActionResult> {
    if (this.session) return {success: false, error: 'Synchronization is already active.'};
    if (!this.getCapabilities().supported || !this.nativeManager) {
      return {
        success: false,
        error:
          getNativeWindowManagerLoadError()?.message ||
          'macOS arm64 synchronization is unavailable.',
      };
    }

    const permissions = this.getPermissionStatus();
    if (!permissions.ready) {
      return {
        success: false,
        error: 'Accessibility, Input Monitoring and event posting permissions are required.',
      };
    }

    const slaveWindowIds = Array.from(new Set(request.slaveWindowIds)).filter(
      windowId => windowId !== request.masterWindowId,
    );
    if (slaveWindowIds.length === 0)
      return {success: false, error: 'Select at least one slave profile.'};
    if (slaveWindowIds.length + 1 > MAX_SYNC_PROFILES) {
      return {
        success: false,
        error: `A sync session supports at most ${MAX_SYNC_PROFILES} profiles.`,
      };
    }

    const options: SyncOptions = {...DEFAULT_MAC_SYNC_OPTIONS, ...request.options};
    const sessionId = `sync-${randomUUID()}`;
    const windowIds = [request.masterWindowId, ...slaveWindowIds];
    try {
      profileLeaseRegistry.acquire(windowIds, 'sync', sessionId);
      const records = await Promise.all(windowIds.map(windowId => WindowDB.getById(windowId)));
      records.forEach((record, index) => this.assertRunningWindow(record, windowIds[index]));

      if (options.autoArrange) {
        const master = records[0]!;
        this.nativeManager.arrangeWindows(
          Number(master.pid),
          records.slice(1).map(record => Number(record!.pid)),
          Math.max(1, Math.min(options.columns, MAX_SYNC_PROFILES)),
          {width: 0, height: Math.max(0, options.height)},
          Math.max(0, options.spacing),
          options.monitorIndex,
        );
        await new Promise(resolve => setTimeout(resolve, 350));
      }

      const master = await this.connectWindow(records[0]!);
      const session: ActiveSyncSession = {
        sessionId,
        startedAt: new Date().toISOString(),
        options,
        master,
        slaves: new Map(),
        targetMappings: new Map(),
        masterUrls: new Map(),
        sequence: 0,
        metrics: emptyMetrics(),
        latencies: [],
        eventChain: Promise.resolve(),
        lastMouseX: master.bounds.x,
        lastMouseY: master.bounds.y,
        masterComposing: false,
      };
      this.session = session;

      for (const record of records.slice(1)) {
        const runtime = await this.connectWindow(record!);
        runtime.queue = this.createQueue(runtime, session);
        session.slaves.set(runtime.windowId, runtime);
      }

      for (const target of master.registry.listVisiblePages(options.enableExtensionSync)) {
        session.masterUrls.set(target.targetId, target.url);
        await this.mapMasterTarget(target);
      }
      await master.registry.installTextBridge(
        `__cpsync_${sessionId.replace(/[^a-zA-Z0-9_]/g, '_')}`,
        `ChromePowerSync_${sessionId.replace(/[^a-zA-Z0-9_]/g, '_')}`,
        (target, payload) => this.handleTextPayload(target, payload),
      );

      const captureStarted = this.nativeManager.startEventCapture(event =>
        this.captureEvent(event),
      );
      if (!captureStarted) throw new Error('The macOS input event tap did not start.');
      for (const runtime of session.slaves.values()) runtime.state.status = 'syncing';
      session.healthTimer = setInterval(() => void this.healthCheck(), 1_000);
      this.publishStatus();
      logger.info('macOS synchronization started', {
        sessionId,
        masterWindowId: master.windowId,
        slaveCount: session.slaves.size,
        engine: options.engine,
      });
      return {success: true, status: this.getStatus()};
    } catch (error) {
      await this.stopInternal();
      profileLeaseRegistry.release(sessionId);
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to start macOS synchronization', {message});
      return {success: false, error: message, status: this.getStatus()};
    }
  }

  async stop(): Promise<SyncActionResult> {
    await this.stopInternal();
    return {success: true, status: this.getStatus()};
  }

  async retryTarget(windowId: number): Promise<SyncActionResult> {
    const session = this.session;
    if (!session) return {success: false, error: 'Synchronization is not active.'};
    const existing = session.slaves.get(windowId);
    if (!existing)
      return {success: false, error: `Profile ${windowId} is not part of this session.`};
    try {
      existing.queue?.stop();
      existing.removeDisconnectListener();
      await existing.registry.dispose();
      const record = await WindowDB.getById(windowId);
      this.assertRunningWindow(record, windowId);
      const runtime = await this.connectWindow(record!);
      runtime.queue = this.createQueue(runtime, session);
      runtime.state.status = 'syncing';
      session.slaves.set(windowId, runtime);
      for (const target of session.master.registry.listVisiblePages(
        session.options.enableExtensionSync,
      )) {
        await this.mapMasterTarget(target, windowId);
      }
      this.publishStatus();
      return {success: true, status: this.getStatus()};
    } catch (error) {
      this.degrade(existing, error instanceof Error ? error.message : String(error), true);
      return {success: false, error: existing.state.error, status: this.getStatus()};
    }
  }

  getStatus(): SyncSessionStatus {
    const session = this.session;
    if (!session) {
      return (
        this.lastStatus || {
          active: false,
          permissions: this.getPermissionStatus(),
          targets: [],
          metrics: emptyMetrics(),
        }
      );
    }
    this.updateLatencyMetrics(session);
    return {
      sessionId: session.sessionId,
      active: true,
      startedAt: session.startedAt,
      masterWindowId: session.master.windowId,
      masterPid: session.master.pid,
      options: session.options,
      permissions: this.getPermissionStatus(),
      targets: Array.from(session.slaves.values()).map(runtime => ({
        ...runtime.state,
        targetCount: runtime.registry.targets.size,
        queueDepth: runtime.queue?.depth || 0,
      })),
      metrics: {...session.metrics},
    };
  }

  private assertRunningWindow(record: DB.Window | undefined, windowId: number): void {
    if (!record || Number(record.status) <= 1 || !record.pid || !record.port) {
      throw new Error(`Profile ${windowId} must already be running with a CDP endpoint.`);
    }
  }

  private async connectWindow(record: DB.Window): Promise<SyncWindowRuntime> {
    const port = Number(record.port);
    const response = await axios.get(`http://127.0.0.1:${port}/json/version`, {timeout: 3_000});
    const endpoint = response.data?.webSocketDebuggerUrl;
    if (!endpoint) throw new Error(`Profile ${record.id} did not return a CDP endpoint.`);
    const client = new CdpClient(endpoint);
    await client.connect();
    const registry = new CdpTargetRegistry(client);
    try {
      await registry.initialize(
        (type, target) => void this.handleTargetChange(record.id!, type, target),
      );
      const bounds = this.nativeManager!.getWindowBounds(Number(record.pid));
      if (!bounds?.success || bounds.width <= 0 || bounds.height <= 0) {
        throw new Error(`Profile ${record.id} does not expose valid window bounds.`);
      }
      const runtime: SyncWindowRuntime = {
        windowId: record.id!,
        profileId: record.profile_id || String(record.id),
        pid: Number(record.pid),
        port,
        bounds: toRectangle(bounds),
        client,
        registry,
        removeDisconnectListener: () => undefined,
        state: {
          windowId: record.id!,
          profileId: record.profile_id || String(record.id),
          pid: Number(record.pid),
          status: 'ready',
          targetCount: registry.targets.size,
          queueDepth: 0,
          latencyMs: 0,
          consecutiveFailures: 0,
        },
      };
      runtime.removeDisconnectListener = client.on('ChromePower.connectionClosed', () =>
        this.handleCdpDisconnect(runtime),
      );
      return runtime;
    } catch (error) {
      await registry.dispose();
      throw error;
    }
  }

  private createQueue(runtime: SyncWindowRuntime, session: ActiveSyncSession): SyncDispatchQueue {
    return new SyncDispatchQueue(512, {
      onSuccess: latencyMs => {
        runtime.state.consecutiveFailures = 0;
        runtime.state.latencyMs = latencyMs;
        session.metrics.eventsDispatched += 1;
        session.latencies.push(latencyMs);
        if (session.latencies.length > 1_000) session.latencies.shift();
        this.scheduleStatusPublish();
      },
      onFailure: error => {
        session.metrics.eventsFailed += 1;
        runtime.state.consecutiveFailures += 1;
        runtime.state.warning = error.message;
        if (runtime.state.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          this.degrade(runtime, error.message);
        }
        this.scheduleStatusPublish();
      },
      onCoalesced: () => {
        session.metrics.eventsCoalesced += 1;
      },
    });
  }

  private captureEvent(event: SyncNativeEvent): void {
    const session = this.session;
    if (!session || !this.nativeManager?.isProcessWindowActive(session.master.pid)) return;
    if (isMouseEvent(event) || event.type === 'scrollWheel') {
      session.lastMouseX = event.x;
      session.lastMouseY = event.y;
    }
    session.metrics.eventsCaptured += 1;

    if (event.type === 'mouseMoved') {
      if (session.pendingMouseEvent) session.metrics.eventsCoalesced += 1;
      session.pendingMouseEvent = event;
      if (!session.mouseTimer) {
        session.mouseTimer = setTimeout(
          () => this.flushPendingEvent(session, 'mouse'),
          session.options.mouseMoveThrottleMs,
        );
      }
      return;
    }

    if (event.type === 'scrollWheel') {
      if (session.pendingWheelEvent) {
        session.metrics.eventsCoalesced += 1;
        session.pendingWheelEvent = {
          ...event,
          deltaX: session.pendingWheelEvent.deltaX + event.deltaX,
          deltaY: session.pendingWheelEvent.deltaY + event.deltaY,
        };
      } else {
        session.pendingWheelEvent = event;
      }
      if (!session.wheelTimer) {
        session.wheelTimer = setTimeout(
          () => this.flushPendingEvent(session, 'wheel'),
          session.options.wheelThrottleMs,
        );
      }
      return;
    }

    this.flushPendingEvents(session);
    this.queueCapturedEvent(session, event);
  }

  private flushPendingEvents(session: ActiveSyncSession): void {
    const pending = [session.pendingMouseEvent, session.pendingWheelEvent]
      .filter((event): event is SyncNativeEvent => !!event)
      .sort((left, right) => left.timestamp - right.timestamp);
    if (session.mouseTimer) clearTimeout(session.mouseTimer);
    if (session.wheelTimer) clearTimeout(session.wheelTimer);
    session.pendingMouseEvent = undefined;
    session.pendingWheelEvent = undefined;
    session.mouseTimer = undefined;
    session.wheelTimer = undefined;
    for (const event of pending) this.queueCapturedEvent(session, event);
  }

  private flushPendingEvent(session: ActiveSyncSession, kind: 'mouse' | 'wheel'): void {
    if (this.session !== session) return;
    const event = kind === 'mouse' ? session.pendingMouseEvent : session.pendingWheelEvent;
    const timer = kind === 'mouse' ? session.mouseTimer : session.wheelTimer;
    if (timer) clearTimeout(timer);
    if (kind === 'mouse') {
      session.pendingMouseEvent = undefined;
      session.mouseTimer = undefined;
    } else {
      session.pendingWheelEvent = undefined;
      session.wheelTimer = undefined;
    }
    if (event) this.queueCapturedEvent(session, event);
  }

  private queueCapturedEvent(session: ActiveSyncSession, event: SyncNativeEvent): void {
    session.eventChain = session.eventChain
      .then(() => this.routeEvent(event))
      .catch(error => {
        logger.warn('Sync event routing failed', {message: (error as Error).message});
      });
  }

  private async routeEvent(event: SyncNativeEvent): Promise<void> {
    const session = this.session;
    if (!session) return;
    if (event.type === 'scrollWheel') {
      if (session.options.enableWheelSync) await this.routePointerEvent(event);
      return;
    }
    if (isMouseEvent(event)) {
      if (session.options.enableMouseSync) await this.routePointerEvent(event);
      return;
    }
    if (session.options.enableKeyboardSync) await this.routeKeyboardEvent(event);
  }

  private async routePointerEvent(event: SyncNativeEvent): Promise<void> {
    const session = this.session!;
    const pageHit =
      session.options.engine === 'hybrid'
        ? await session.master.registry
            .findVisibleTargetAtPoint(event.x, event.y)
            .catch(() => undefined)
        : undefined;
    if (!pageHit) {
      this.routeNativePointer(event);
      return;
    }
    session.lastMasterTargetId = pageHit.target.targetId;
    const descriptor =
      isMouseDown(event) || isMouseUp(event)
        ? await session.master.registry
            .describeElementAt(pageHit.target, pageHit.clientX, pageHit.clientY)
            .catch(() => undefined)
        : undefined;

    for (const runtime of session.slaves.values()) {
      if (runtime.state.status !== 'syncing') continue;
      this.enqueue(
        runtime,
        event.type,
        async () => {
          const target = await this.resolveMappedTarget(pageHit.target, runtime);
          if (!target) throw new Error(`No matching target for ${pageHit.target.url}`);
          const geometry = await runtime.registry.getGeometry(target);
          let x =
            (pageHit.clientX / Math.max(1, pageHit.geometry.innerWidth)) * geometry.innerWidth;
          let y =
            (pageHit.clientY / Math.max(1, pageHit.geometry.innerHeight)) * geometry.innerHeight;
          if (descriptor && (isMouseDown(event) || isMouseUp(event))) {
            const resolved = await runtime.registry
              .resolveElement(target, descriptor)
              .catch(() => undefined);
            if (resolved && resolved.confidence !== 'low') {
              x = resolved.x;
              y = resolved.y;
            } else if (!resolved) {
              runtime.state.warning =
                'Semantic target not found; normalized coordinates were used.';
            }
          }

          const button = cdpButton(event.button);
          if (event.type === 'scrollWheel') {
            await runtime.registry.dispatchMouse(target, 'mouseWheel', {
              x,
              y,
              deltaX: event.deltaX,
              deltaY: event.deltaY,
              modifiers: cdpModifiers(event.flags),
            });
          } else if (isMouseDown(event)) {
            await runtime.registry.dispatchMouse(target, 'mousePressed', {
              x,
              y,
              button,
              buttons: button === 'right' ? 2 : button === 'middle' ? 4 : 1,
              clickCount: Math.max(1, event.clickCount),
              modifiers: cdpModifiers(event.flags),
            });
          } else if (isMouseUp(event)) {
            await runtime.registry.dispatchMouse(target, 'mouseReleased', {
              x,
              y,
              button,
              buttons: 0,
              clickCount: Math.max(1, event.clickCount),
              modifiers: cdpModifiers(event.flags),
            });
          } else {
            const dragging = /Dragged$/.test(event.type);
            await runtime.registry.dispatchMouse(target, 'mouseMoved', {
              x,
              y,
              button,
              buttons: dragging ? (button === 'right' ? 2 : button === 'middle' ? 4 : 1) : 0,
              modifiers: cdpModifiers(event.flags),
            });
          }
        },
        event.type === 'mouseMoved'
          ? 'mouseMoved'
          : event.type === 'scrollWheel'
            ? 'wheel'
            : undefined,
      );
    }
  }

  private routeNativePointer(event: SyncNativeEvent): void {
    const session = this.session!;
    const masterWindows = this.nativeManager!.getAllWindows(session.master.pid);
    const source =
      masterWindows.find(window => containsPoint(window, event.x, event.y)) ||
      ({...session.master.bounds, title: '', isExtension: false} as NativeWindowInfo);

    for (const runtime of session.slaves.values()) {
      if (runtime.state.status !== 'syncing') continue;
      this.enqueue(
        runtime,
        `native:${event.type}`,
        async () => {
          const slaveWindows = this.nativeManager!.getAllWindows(runtime.pid);
          const destination =
            slaveWindows.find(
              window =>
                window.isExtension === source.isExtension &&
                !!source.title &&
                window.title === source.title,
            ) ||
            slaveWindows.find(window => window.isExtension === source.isExtension) ||
            runtime.bounds;
          const point = mapRelativePoint(source, destination, event.x, event.y);
          if (event.type === 'scrollWheel') {
            this.nativeManager!.sendWheelEvent(
              runtime.pid,
              event.deltaX,
              event.deltaY,
              point.x,
              point.y,
            );
          } else {
            this.nativeManager!.sendMouseEvent(
              runtime.pid,
              Math.round(point.x),
              Math.round(point.y),
              nativeMouseEventName(event),
            );
          }
        },
        event.type === 'mouseMoved'
          ? 'nativeMouseMoved'
          : event.type === 'scrollWheel'
            ? 'nativeWheel'
            : undefined,
      );
    }
  }

  private async routeKeyboardEvent(event: SyncNativeEvent): Promise<void> {
    const session = this.session!;
    const target =
      (session.lastMasterTargetId &&
        session.master.registry.targets.get(session.lastMasterTargetId)) ||
      (await this.findVisibleTarget(session.master.registry));
    const meta = (event.flags & 0x100000) !== 0;
    const isClipboardShortcut = meta && [8, 9].includes(event.keyCode);

    if (session.options.engine === 'hybrid' && target?.sessionId && event.type !== 'flagsChanged') {
      if (session.masterComposing) return;
      if (session.options.enableClipboardSync && isClipboardShortcut) return;
      for (const runtime of session.slaves.values()) {
        if (runtime.state.status !== 'syncing') continue;
        this.enqueue(runtime, event.type, async () => {
          const mapped = await this.resolveMappedTarget(target, runtime);
          if (!mapped) throw new Error(`No matching keyboard target for ${target.url}`);
          const isDown = event.type === 'keyDown';
          const modifiers = cdpModifiers(event.flags);
          const descriptor = describeCdpKey(event);
          const text = isDown && modifiers === 0 ? event.text || '' : '';
          await runtime.registry.dispatchKey(mapped, {
            type: isDown ? (text ? 'keyDown' : 'rawKeyDown') : 'keyUp',
            key: descriptor.key,
            code: descriptor.code,
            text,
            unmodifiedText: event.text || '',
            nativeVirtualKeyCode: event.keyCode,
            windowsVirtualKeyCode: descriptor.windowsVirtualKeyCode,
            modifiers,
            autoRepeat: false,
          });
        });
      }
      return;
    }

    for (const runtime of session.slaves.values()) {
      if (runtime.state.status !== 'syncing') continue;
      this.enqueue(runtime, `native:${event.type}`, async () => {
        if (event.type === 'flagsChanged') return;
        this.nativeManager!.sendKeyboardEvent(
          runtime.pid,
          event.keyCode,
          event.type === 'keyDown' ? 'keydown' : 'keyup',
          session.lastMouseX,
          session.lastMouseY,
          event.flags,
          event.text,
        );
      });
    }
  }

  private handleTextPayload(masterTarget: SyncCdpTarget, payload: TextBridgePayload): void {
    const session = this.session;
    if (!session) return;
    if (payload.kind === 'composition') {
      session.masterComposing = !!payload.composing;
      return;
    }
    if (payload.kind === 'active') {
      session.lastMasterTargetId = masterTarget.targetId;
      for (const runtime of session.slaves.values()) {
        if (runtime.state.status !== 'syncing') continue;
        this.enqueue(runtime, 'activateTarget', async () => {
          const target = await this.resolveMappedTarget(masterTarget, runtime);
          if (target) await runtime.registry.activate(target);
        });
      }
      return;
    }
    if (!session.options.enableTextSync || !payload.text) return;
    const text = payload.text;
    for (const runtime of session.slaves.values()) {
      if (runtime.state.status !== 'syncing') continue;
      this.enqueue(runtime, 'insertText', async () => {
        const target = await this.resolveMappedTarget(masterTarget, runtime);
        if (!target) throw new Error(`No matching text target for ${masterTarget.url}`);
        if (payload.descriptor) {
          const focused = await runtime.registry
            .focusElement(target, payload.descriptor)
            .catch(() => false);
          if (!focused) runtime.state.warning = 'Text target focus could not be confirmed.';
        }
        await runtime.registry.insertText(target, text);
      });
    }
  }

  private enqueue(
    runtime: SyncWindowRuntime,
    kind: string,
    execute: () => Promise<void>,
    coalesceKey?: string,
  ): void {
    const session = this.session;
    if (!session || !runtime.queue || runtime.state.status !== 'syncing') return;
    try {
      runtime.queue.enqueue({
        sequence: ++session.sequence,
        kind,
        createdAt: Date.now(),
        coalesceKey,
        execute,
      });
    } catch (error) {
      this.degrade(runtime, error instanceof Error ? error.message : String(error), true);
    }
  }

  private async mapMasterTarget(masterTarget: SyncCdpTarget, onlyWindowId?: number): Promise<void> {
    const session = this.session;
    if (!session || masterTarget.kind === 'internal' || masterTarget.kind === 'other') return;
    const mapping = session.targetMappings.get(masterTarget.targetId) || new Map<number, string>();
    const runtimes = onlyWindowId
      ? [session.slaves.get(onlyWindowId)].filter(
          (runtime): runtime is SyncWindowRuntime => !!runtime,
        )
      : Array.from(session.slaves.values());

    for (const runtime of runtimes) {
      if (runtime.state.status === 'disconnected') continue;
      const used = new Set(
        Array.from(session.targetMappings.values())
          .map(existing => existing.get(runtime.windowId))
          .filter((targetId): targetId is string => !!targetId),
      );
      const candidates = runtime.registry
        .listVisiblePages(session.options.enableExtensionSync)
        .filter(target => target.kind === masterTarget.kind && !used.has(target.targetId));
      let target: SyncCdpTarget | undefined =
        candidates.find(candidate => candidate.url === masterTarget.url) ||
        candidates.find(
          candidate => normalizeUrl(candidate.url) === normalizeUrl(masterTarget.url),
        ) ||
        candidates[0];
      if (!target && session.options.enableTabSync && masterTarget.kind === 'ordinary') {
        target = await runtime.registry.create(masterTarget.url);
      }
      if (target) mapping.set(runtime.windowId, target.targetId);
      else
        runtime.state.warning = `No matching ${masterTarget.kind} target for ${normalizeUrl(masterTarget.url)}`;
    }
    session.targetMappings.set(masterTarget.targetId, mapping);
  }

  private async resolveMappedTarget(
    masterTarget: SyncCdpTarget,
    runtime: SyncWindowRuntime,
  ): Promise<SyncCdpTarget | undefined> {
    let targetId = this.session?.targetMappings.get(masterTarget.targetId)?.get(runtime.windowId);
    let target = targetId ? runtime.registry.targets.get(targetId) : undefined;
    if (!target) {
      await this.mapMasterTarget(masterTarget, runtime.windowId);
      targetId = this.session?.targetMappings.get(masterTarget.targetId)?.get(runtime.windowId);
      target = targetId ? runtime.registry.targets.get(targetId) : undefined;
    }
    return target;
  }

  private async handleTargetChange(
    windowId: number,
    type: 'created' | 'changed' | 'destroyed',
    target: SyncCdpTarget,
  ): Promise<void> {
    const session = this.session;
    if (!session) return;
    if (windowId !== session.master.windowId) {
      const runtime = session.slaves.get(windowId);
      if (runtime) runtime.state.targetCount = runtime.registry.targets.size;
      this.scheduleStatusPublish();
      return;
    }

    if (type === 'destroyed') {
      const mapping = session.targetMappings.get(target.targetId);
      session.targetMappings.delete(target.targetId);
      session.masterUrls.delete(target.targetId);
      if (session.options.enableTabSync && mapping) {
        for (const [slaveWindowId, targetId] of mapping) {
          const runtime = session.slaves.get(slaveWindowId);
          if (runtime?.state.status === 'syncing') {
            this.enqueue(runtime, 'closeTarget', () => runtime.registry.closeTarget(targetId));
          }
        }
      }
      return;
    }

    const previousUrl = session.masterUrls.get(target.targetId);
    session.masterUrls.set(target.targetId, target.url);
    if (type === 'created') {
      await new Promise(resolve => setTimeout(resolve, 150));
      await this.mapMasterTarget(target);
      return;
    }
    if (
      session.options.enableTabSync &&
      previousUrl &&
      previousUrl !== target.url &&
      target.kind !== 'internal' &&
      target.kind !== 'other'
    ) {
      const mapping = session.targetMappings.get(target.targetId);
      if (!mapping) return;
      for (const [slaveWindowId, targetId] of mapping) {
        const runtime = session.slaves.get(slaveWindowId);
        const slaveTarget = runtime?.registry.targets.get(targetId);
        if (
          runtime?.state.status === 'syncing' &&
          slaveTarget &&
          normalizeUrl(slaveTarget.url) !== normalizeUrl(target.url)
        ) {
          this.enqueue(runtime, 'navigate', () =>
            runtime.registry.navigate(slaveTarget, target.url),
          );
        }
      }
    }
  }

  private async findVisibleTarget(registry: CdpTargetRegistry): Promise<SyncCdpTarget | undefined> {
    for (const target of registry.listVisiblePages(true).reverse()) {
      const geometry = await registry.getGeometry(target).catch(() => undefined);
      if (geometry?.visible) return target;
    }
    return registry.listVisiblePages(true)[0];
  }

  private degrade(runtime: SyncWindowRuntime, message: string, immediate = false): void {
    if (runtime.state.status === 'degraded' || runtime.state.status === 'disconnected') return;
    if (!immediate && runtime.state.consecutiveFailures < MAX_CONSECUTIVE_FAILURES) return;
    runtime.state.status = 'degraded';
    runtime.state.error = message;
    runtime.queue?.stop();
    emit('sync-target-updated', {...runtime.state});
    this.publishStatus();
  }

  private async healthCheck(): Promise<void> {
    const session = this.session;
    if (!session) return;
    const master = await WindowDB.getById(session.master.windowId).catch(() => undefined);
    if (!master || Number(master.status) <= 1 || Number(master.pid) !== session.master.pid) {
      this.lastStatus = {...this.getStatus(), active: false, error: 'Master profile closed.'};
      await this.stopInternal();
      return;
    }
    for (const runtime of session.slaves.values()) {
      if (runtime.state.status === 'disconnected') continue;
      const record = await WindowDB.getById(runtime.windowId).catch(() => undefined);
      if (!record || Number(record.status) <= 1 || Number(record.pid) !== runtime.pid) {
        runtime.state.status = 'disconnected';
        runtime.state.error = 'Profile closed.';
        runtime.queue?.stop();
        emit('sync-target-updated', {...runtime.state});
      }
    }
    this.scheduleStatusPublish();
  }

  private handleCdpDisconnect(runtime: SyncWindowRuntime): void {
    const session = this.session;
    if (!session) return;
    if (runtime.windowId === session.master.windowId) {
      this.lastStatus = {...this.getStatus(), active: false, error: 'Master CDP disconnected.'};
      void this.stopInternal();
      return;
    }
    if (session.slaves.get(runtime.windowId) !== runtime) return;
    runtime.state.status = 'disconnected';
    runtime.state.error = 'CDP connection disconnected.';
    runtime.queue?.stop();
    emit('sync-target-updated', {...runtime.state});
    this.publishStatus();
  }

  private async stopInternal(): Promise<void> {
    const session = this.session;
    if (!session) return;
    this.session = undefined;
    if (session.healthTimer) clearInterval(session.healthTimer);
    if (session.mouseTimer) clearTimeout(session.mouseTimer);
    if (session.wheelTimer) clearTimeout(session.wheelTimer);
    this.nativeManager?.stopEventCapture();
    for (const runtime of session.slaves.values()) runtime.queue?.stop();
    session.master.removeDisconnectListener();
    for (const runtime of session.slaves.values()) runtime.removeDisconnectListener();
    await Promise.all([
      session.master.registry.dispose().catch(() => undefined),
      ...Array.from(session.slaves.values()).map(runtime =>
        runtime.registry.dispose().catch(() => undefined),
      ),
    ]);
    profileLeaseRegistry.release(session.sessionId);
    this.updateLatencyMetrics(session);
    this.lastStatus = {
      sessionId: session.sessionId,
      active: false,
      startedAt: session.startedAt,
      masterWindowId: session.master.windowId,
      masterPid: session.master.pid,
      options: session.options,
      permissions: this.getPermissionStatus(),
      targets: Array.from(session.slaves.values()).map(runtime => ({
        ...runtime.state,
        queueDepth: 0,
      })),
      metrics: {...session.metrics},
    };
    emit('sync-status-updated', this.lastStatus);
    logger.info('macOS synchronization stopped', {sessionId: session.sessionId});
  }

  private updateLatencyMetrics(session: ActiveSyncSession): void {
    if (session.latencies.length === 0) return;
    const sorted = [...session.latencies].sort((left, right) => left - right);
    session.metrics.averageLatencyMs = Math.round(
      sorted.reduce((total, value) => total + value, 0) / sorted.length,
    );
    session.metrics.p95LatencyMs =
      sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  }

  private scheduleStatusPublish(): void {
    if (this.statusEmitTimer) return;
    this.statusEmitTimer = setTimeout(() => {
      this.statusEmitTimer = undefined;
      this.publishStatus();
    }, 100);
  }

  private publishStatus(): void {
    emit('sync-status-updated', this.getStatus());
  }
}

const syncService = new MacWindowSyncService();

export const initMultiWindowSyncService = () => {
  ipcMain.handle('multi-window-sync-capabilities', () => syncService.getCapabilities());
  ipcMain.handle('multi-window-sync-permissions', () => syncService.getPermissionStatus());
  ipcMain.handle('multi-window-sync-request-permissions', () => syncService.requestPermissions());
  ipcMain.handle(
    'multi-window-sync-open-permission-settings',
    (_, kind: 'accessibility' | 'inputMonitoring') => syncService.openPermissionSettings(kind),
  );
  ipcMain.handle('multi-window-sync-start', (_, request: SyncStartRequest) =>
    syncService.start(request),
  );
  ipcMain.handle('multi-window-sync-stop', () => syncService.stop());
  ipcMain.handle('multi-window-sync-status', () => syncService.getStatus());
  ipcMain.handle('multi-window-sync-retry-target', (_, windowId: number) =>
    syncService.retryTarget(windowId),
  );
  logger.info('macOS multi-window synchronization service initialized');
};
