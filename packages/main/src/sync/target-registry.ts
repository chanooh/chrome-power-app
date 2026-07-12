import {CdpClient, type CdpEvent} from './cdp-client';

export type SyncPageKind = 'ordinary' | 'extension' | 'internal' | 'other';

export interface CdpTargetInfo {
  targetId: string;
  type: string;
  title: string;
  url: string;
  attached?: boolean;
  openerId?: string;
  browserContextId?: string;
}

export interface SyncCdpTarget extends CdpTargetInfo {
  kind: SyncPageKind;
  sessionId?: string;
  createdAt: number;
}

export interface PageGeometry {
  screenX: number;
  screenY: number;
  outerWidth: number;
  outerHeight: number;
  innerWidth: number;
  innerHeight: number;
  devicePixelRatio: number;
  visible: boolean;
}

export interface ElementDescriptor {
  tag: string;
  id?: string;
  name?: string;
  type?: string;
  testId?: string;
  ariaLabel?: string;
  role?: string;
  href?: string;
  text?: string;
  clientX?: number;
  clientY?: number;
}

export interface TextBridgePayload {
  kind: 'text' | 'active' | 'composition';
  text?: string;
  inputType?: string;
  composing?: boolean;
  url: string;
  descriptor?: ElementDescriptor;
  at: number;
}

const classifyUrl = (url: string): SyncPageKind => {
  if (/^chrome-extension:\/\//i.test(url)) return 'extension';
  if (/^(https?|file):\/\//i.test(url) || url === 'about:blank') return 'ordinary';
  if (/^(chrome|devtools):\/\//i.test(url)) return 'internal';
  return 'other';
};

const attachableTarget = (target: CdpTargetInfo) =>
  ['page', 'iframe', 'webview'].includes(target.type) && classifyUrl(target.url) !== 'internal';

const descriptorScript = `
function chromePowerDescribe(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return undefined;
  const text = String(element.innerText || element.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 200);
  const rect = element.getBoundingClientRect();
  return {
    tag: element.tagName.toLowerCase(),
    id: element.id || undefined,
    name: element.getAttribute('name') || undefined,
    type: element.getAttribute('type') || undefined,
    testId: element.getAttribute('data-testid') || element.getAttribute('data-test') || undefined,
    ariaLabel: element.getAttribute('aria-label') || undefined,
    role: element.getAttribute('role') || undefined,
    href: element.href || element.getAttribute('href') || undefined,
    text: text || undefined,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2
  };
}
`;

export class CdpTargetRegistry {
  readonly targets = new Map<string, SyncCdpTarget>();
  private readonly detachListeners: Array<() => void> = [];
  private readonly bridgeScripts = new Map<string, string>();
  private targetChanged?: (
    type: 'created' | 'changed' | 'destroyed',
    target: SyncCdpTarget,
  ) => void;
  private bridgeBindingName?: string;
  private bridgeWorldName?: string;
  private bridgePayload?: (target: SyncCdpTarget, payload: TextBridgePayload) => void;

  constructor(readonly client: CdpClient) {}

  async initialize(
    onTargetChanged?: (type: 'created' | 'changed' | 'destroyed', target: SyncCdpTarget) => void,
  ): Promise<void> {
    this.targetChanged = onTargetChanged;
    this.detachListeners.push(
      this.client.on('Target.targetCreated', event => void this.handleTargetCreated(event)),
      this.client.on('Target.targetInfoChanged', event => void this.handleTargetChanged(event)),
      this.client.on('Target.targetDestroyed', event => this.handleTargetDestroyed(event)),
      this.client.on('Runtime.bindingCalled', event => this.handleBindingCalled(event)),
    );
    await this.client.send('Target.setDiscoverTargets', {discover: true});
    const {targetInfos} = await this.client.send<{targetInfos: CdpTargetInfo[]}>(
      'Target.getTargets',
    );
    for (const target of targetInfos) await this.upsertTarget(target, false);
  }

  listVisiblePages(includeExtensions = true): SyncCdpTarget[] {
    return Array.from(this.targets.values()).filter(
      target =>
        !!target.sessionId &&
        target.type === 'page' &&
        (target.kind === 'ordinary' || (includeExtensions && target.kind === 'extension')),
    );
  }

  async findVisibleTargetAtPoint(
    x: number,
    y: number,
  ): Promise<
    | {
        target: SyncCdpTarget;
        geometry: PageGeometry;
        clientX: number;
        clientY: number;
      }
    | undefined
  > {
    for (const target of this.listVisiblePages(true).reverse()) {
      const geometry = await this.getGeometry(target).catch(() => undefined);
      if (!geometry?.visible) continue;
      const horizontalInset = Math.max(0, (geometry.outerWidth - geometry.innerWidth) / 2);
      const contentX = geometry.screenX + horizontalInset;
      const contentY = geometry.screenY + Math.max(0, geometry.outerHeight - geometry.innerHeight);
      if (
        x >= contentX &&
        x <= contentX + geometry.innerWidth &&
        y >= contentY &&
        y <= contentY + geometry.innerHeight
      ) {
        return {target, geometry, clientX: x - contentX, clientY: y - contentY};
      }
    }
    return undefined;
  }

  async getGeometry(target: SyncCdpTarget): Promise<PageGeometry> {
    return this.evaluateValue<PageGeometry>(
      target,
      `({screenX, screenY, outerWidth, outerHeight, innerWidth, innerHeight, devicePixelRatio, visible: document.visibilityState === 'visible'})`,
    );
  }

  async describeElementAt(
    target: SyncCdpTarget,
    clientX: number,
    clientY: number,
  ): Promise<ElementDescriptor | undefined> {
    return this.evaluateValue<ElementDescriptor | undefined>(
      target,
      `(() => { ${descriptorScript}; return chromePowerDescribe(document.elementFromPoint(${JSON.stringify(clientX)}, ${JSON.stringify(clientY)})); })()`,
    );
  }

  async resolveElement(
    target: SyncCdpTarget,
    descriptor: ElementDescriptor,
  ): Promise<{x: number; y: number; confidence: 'high' | 'medium' | 'low'} | undefined> {
    const encoded = JSON.stringify(descriptor);
    return this.evaluateValue(
      target,
      `(() => {
        const wanted = ${encoded};
        const visible = element => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        };
        const center = (element, confidence) => {
          if (!element || !visible(element)) return undefined;
          const rect = element.getBoundingClientRect();
          return {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, confidence};
        };
        const escape = value => CSS.escape(String(value));
        if (wanted.testId) {
          const found = document.querySelector('[data-testid="' + escape(wanted.testId) + '"], [data-test="' + escape(wanted.testId) + '"]');
          const result = center(found, 'high'); if (result) return result;
        }
        if (wanted.id) { const result = center(document.getElementById(wanted.id), 'high'); if (result) return result; }
        if (wanted.name) {
          const found = document.querySelector((wanted.tag || '*') + '[name="' + escape(wanted.name) + '"]');
          const result = center(found, 'high'); if (result) return result;
        }
        const candidates = Array.from(document.querySelectorAll(wanted.tag || 'button,a,input,textarea,select,[role]'));
        const normalized = value => String(value || '').replace(/\\s+/g, ' ').trim();
        for (const candidate of candidates) {
          if (wanted.href && candidate.href && new URL(candidate.href, location.href).href === new URL(wanted.href, location.href).href) {
            const result = center(candidate, 'high'); if (result) return result;
          }
          if (wanted.ariaLabel && candidate.getAttribute('aria-label') === wanted.ariaLabel) {
            const result = center(candidate, 'high'); if (result) return result;
          }
        }
        if (wanted.text) {
          const exact = candidates.find(candidate => normalized(candidate.innerText || candidate.textContent) === normalized(wanted.text));
          const result = center(exact, 'medium'); if (result) return result;
          const fuzzy = candidates.find(candidate => normalized(candidate.innerText || candidate.textContent).includes(normalized(wanted.text)));
          const fuzzyResult = center(fuzzy, 'low'); if (fuzzyResult) return fuzzyResult;
        }
        return undefined;
      })()`,
    );
  }

  async focusElement(target: SyncCdpTarget, descriptor: ElementDescriptor): Promise<boolean> {
    const encoded = JSON.stringify(descriptor);
    return this.evaluateValue<boolean>(
      target,
      `(() => {
        const wanted = ${encoded};
        const escape = value => CSS.escape(String(value));
        let element;
        if (wanted.testId) element = document.querySelector('[data-testid="' + escape(wanted.testId) + '"], [data-test="' + escape(wanted.testId) + '"]');
        if (!element && wanted.id) element = document.getElementById(wanted.id);
        if (!element && wanted.name) element = document.querySelector((wanted.tag || '*') + '[name="' + escape(wanted.name) + '"]');
        if (!element && wanted.ariaLabel) element = Array.from(document.querySelectorAll(wanted.tag || 'input,textarea,[contenteditable="true"]')).find(candidate => candidate.getAttribute('aria-label') === wanted.ariaLabel);
        if (!element || typeof element.focus !== 'function') return false;
        element.focus({preventScroll: true});
        return document.activeElement === element;
      })()`,
    );
  }

  async evaluateValue<T>(target: SyncCdpTarget, expression: string): Promise<T> {
    if (!target.sessionId) throw new Error(`Target ${target.targetId} is not attached`);
    const response = await this.client.send<{
      result: {value?: T; description?: string};
      exceptionDetails?: {text?: string};
    }>('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true}, target.sessionId);
    if (response.exceptionDetails) {
      throw new Error(
        response.exceptionDetails.text ||
          response.result.description ||
          'Runtime evaluation failed',
      );
    }
    return response.result.value as T;
  }

  async dispatchMouse(
    target: SyncCdpTarget,
    type: 'mouseMoved' | 'mousePressed' | 'mouseReleased' | 'mouseWheel',
    params: Record<string, unknown>,
  ): Promise<void> {
    await this.sendToTarget(target, 'Input.dispatchMouseEvent', {type, ...params});
  }

  async dispatchKey(target: SyncCdpTarget, params: Record<string, unknown>): Promise<void> {
    await this.sendToTarget(target, 'Input.dispatchKeyEvent', params);
  }

  async insertText(target: SyncCdpTarget, text: string): Promise<void> {
    await this.sendToTarget(target, 'Input.insertText', {text});
  }

  async activate(target: SyncCdpTarget): Promise<void> {
    await this.client.send('Target.activateTarget', {targetId: target.targetId});
  }

  async create(url: string): Promise<SyncCdpTarget | undefined> {
    const {targetId} = await this.client.send<{targetId: string}>('Target.createTarget', {url});
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const target = this.targets.get(targetId);
      if (target?.sessionId) return target;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return this.targets.get(targetId);
  }

  async closeTarget(targetId: string): Promise<void> {
    await this.client.send('Target.closeTarget', {targetId});
  }

  async navigate(target: SyncCdpTarget, url: string): Promise<void> {
    await this.sendToTarget(target, 'Page.navigate', {url}, 5_000);
  }

  async installTextBridge(
    bindingName: string,
    worldName: string,
    onPayload: (target: SyncCdpTarget, payload: TextBridgePayload) => void,
  ): Promise<void> {
    this.bridgeBindingName = bindingName;
    this.bridgeWorldName = worldName;
    this.bridgePayload = onPayload;
    for (const target of this.listVisiblePages(true)) await this.installBridgeOnTarget(target);
  }

  async dispose(): Promise<void> {
    for (const target of this.targets.values()) {
      if (!target.sessionId) continue;
      const scriptId = this.bridgeScripts.get(target.targetId);
      if (scriptId) {
        await this.client
          .send(
            'Page.removeScriptToEvaluateOnNewDocument',
            {identifier: scriptId},
            target.sessionId,
          )
          .catch(() => undefined);
      }
      if (this.bridgeBindingName) {
        await this.client
          .send('Runtime.removeBinding', {name: this.bridgeBindingName}, target.sessionId)
          .catch(() => undefined);
      }
    }
    this.detachListeners.splice(0).forEach(detach => detach());
    this.client.close();
  }

  private async sendToTarget(
    target: SyncCdpTarget,
    method: string,
    params: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<void> {
    if (!target.sessionId) throw new Error(`Target ${target.targetId} is not attached`);
    await this.client.send(method, params, target.sessionId, timeoutMs);
  }

  private async upsertTarget(info: CdpTargetInfo, notify = true): Promise<SyncCdpTarget> {
    const existing = this.targets.get(info.targetId);
    const target: SyncCdpTarget = {
      ...existing,
      ...info,
      kind: classifyUrl(info.url),
      createdAt: existing?.createdAt || Date.now(),
    };
    this.targets.set(info.targetId, target);
    if (attachableTarget(info) && !target.sessionId) {
      const result = await this.client
        .send<{sessionId: string}>('Target.attachToTarget', {
          targetId: info.targetId,
          flatten: true,
        })
        .catch(() => undefined);
      if (result?.sessionId) {
        target.sessionId = result.sessionId;
        await this.client.send('Runtime.enable', {}, target.sessionId).catch(() => undefined);
        await this.client.send('Page.enable', {}, target.sessionId).catch(() => undefined);
        if (this.bridgeBindingName) await this.installBridgeOnTarget(target);
      }
    }
    if (notify) this.targetChanged?.(existing ? 'changed' : 'created', target);
    return target;
  }

  private async handleTargetCreated(event: CdpEvent): Promise<void> {
    const info = (event.params as {targetInfo?: CdpTargetInfo}).targetInfo;
    if (info) await this.upsertTarget(info);
  }

  private async handleTargetChanged(event: CdpEvent): Promise<void> {
    const info = (event.params as {targetInfo?: CdpTargetInfo}).targetInfo;
    if (info) await this.upsertTarget(info);
  }

  private handleTargetDestroyed(event: CdpEvent): void {
    const targetId = (event.params as {targetId?: string}).targetId;
    if (!targetId) return;
    const target = this.targets.get(targetId);
    if (!target) return;
    this.targets.delete(targetId);
    this.targetChanged?.('destroyed', target);
  }

  private handleBindingCalled(event: CdpEvent): void {
    const params = event.params as {name?: string; payload?: string};
    if (!event.sessionId || params.name !== this.bridgeBindingName || !params.payload) return;
    const target = Array.from(this.targets.values()).find(
      candidate => candidate.sessionId === event.sessionId,
    );
    if (!target) return;
    try {
      this.bridgePayload?.(target, JSON.parse(params.payload));
    } catch {
      // Invalid page payloads are ignored and never logged with their contents.
    }
  }

  private async installBridgeOnTarget(target: SyncCdpTarget): Promise<void> {
    if (!target.sessionId || !this.bridgeBindingName || !this.bridgeWorldName) return;
    if (this.bridgeScripts.has(target.targetId)) return;
    const bindingName = this.bridgeBindingName;
    const markerName = `__chromePowerSync_${bindingName}`;
    const source = `(() => {
      if (globalThis[${JSON.stringify(markerName)}]) return;
      const controller = new AbortController();
      globalThis[${JSON.stringify(markerName)}] = controller;
      ${descriptorScript}
      let lastText = ''; let lastAt = 0;
      const emit = payload => {
        try { globalThis[${JSON.stringify(bindingName)}](JSON.stringify({...payload, url: location.href, at: Date.now()})); } catch {}
      };
      const emitText = (text, inputType, target) => {
        if (typeof text !== 'string' || !text) return;
        const now = Date.now();
        if (text === lastText && now - lastAt < 40) return;
        lastText = text; lastAt = now;
        emit({kind: 'text', text, inputType, descriptor: chromePowerDescribe(target)});
      };
      document.addEventListener('beforeinput', event => {
        if (!event.isComposing && (event.inputType === 'insertFromPaste' || String(event.data || '').length > 1)) {
          emitText(event.data, event.inputType, event.target);
        }
      }, {capture: true, signal: controller.signal});
      document.addEventListener('compositionstart', () => emit({kind: 'composition', composing: true}), {capture: true, signal: controller.signal});
      document.addEventListener('compositionend', event => {
        emitText(event.data, 'insertCompositionText', event.target);
        emit({kind: 'composition', composing: false});
      }, {capture: true, signal: controller.signal});
      document.addEventListener('paste', event => emitText(event.clipboardData && event.clipboardData.getData('text/plain'), 'insertFromPaste', event.target), {capture: true, signal: controller.signal});
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') emit({kind: 'active'}); }, {signal: controller.signal});
    })()`;
    await this.client.send(
      'Runtime.addBinding',
      {name: bindingName, executionContextName: this.bridgeWorldName},
      target.sessionId,
    );
    const result = await this.client.send<{identifier: string}>(
      'Page.addScriptToEvaluateOnNewDocument',
      {source, worldName: this.bridgeWorldName, runImmediately: true},
      target.sessionId,
    );
    this.bridgeScripts.set(target.targetId, result.identifier);
  }
}
