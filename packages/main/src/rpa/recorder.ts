import {BrowserWindow} from 'electron';
import type {Page} from 'playwright';
import type {
  RpaRecorderEvent,
  RpaRecorderOptions,
  RpaRecorderSession,
  RpaTaskStep,
} from '../../../shared/types/rpa';
import {openFingerprintWindow} from '../fingerprint';
import {connectRpaBrowser, type RpaConnectedBrowser} from './automation';
import {DEFAULT_RPA_RECORDER_SESSION_MODE, prepareRpaSession} from './session';

interface InternalRecorderSession extends RpaRecorderSession {
  connected: RpaConnectedBrowser;
}

const emitRecorderEvent = (event: RpaRecorderEvent) => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('rpa-recorder-event', event);
  }
};

const isSensitiveSelector = (selector?: string) =>
  /(password|seed|mnemonic|private\s*key|privateKey|recovery\s*phrase|助记词|私钥|恢复短语)/i.test(
    selector || '',
  );

const shouldRecordNavigation = (url?: string) => !!url && url !== 'about:blank';

const toStep = (event: RpaRecorderEvent): RpaTaskStep => {
  const id = `${event.type}-${event.timestamp}`;
  if (event.type === 'navigation') {
    return {id, type: 'goto', url: event.url};
  }
  if (event.type === 'fill') {
    if (!event.value || isSensitiveSelector(event.selector)) {
      return {
        id,
        type: 'manualConfirm',
        text: `Manually fill sensitive field: ${event.selector || 'selected field'}`,
      };
    }
    return {
      id,
      type: 'fill',
      selector: event.selector,
      selectors: event.selectors,
      value: event.value,
    };
  }
  if (event.type === 'select') {
    return {
      id,
      type: 'select',
      selector: event.selector,
      selectors: event.selectors,
      value: event.value,
    };
  }
  if (event.type === 'press') {
    return {id, type: 'press', key: event.key};
  }
  return {
    id,
    type: 'click',
    selector: event.selector,
    selectors: event.selectors,
    text: event.text,
  };
};

const recorderScript = (bindingName: string) => `
(() => {
  if (window.__chromePowerRpaRecorderInstalled) return;
  window.__chromePowerRpaRecorderInstalled = true;
  const emit = payload => {
    const send = window['${bindingName}'];
    if (typeof send === 'function') {
      send({
        ...payload,
        url: location.href,
        timestamp: Date.now()
      }).catch(() => {});
    }
  };
  const cssEscape = value => {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\\\$&');
  };
  const textOf = element => (element.innerText || element.value || element.textContent || '').trim().slice(0, 80);
  const cssPath = element => {
    const parts = [];
    let node = element;
    while (node && node.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
      let part = node.nodeName.toLowerCase();
      if (node.id) {
        parts.unshift('#' + cssEscape(node.id));
        break;
      }
      const parent = node.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter(child => child.nodeName === node.nodeName);
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(' > ');
  };
  const selectorsFor = element => {
    const selectors = [];
    const testId = element.getAttribute('data-testid') || element.getAttribute('data-test');
    const aria = element.getAttribute('aria-label');
    const name = element.getAttribute('name');
    const id = element.id;
    const role = element.getAttribute('role');
    const text = textOf(element);
    if (testId) selectors.push('[data-testid="' + testId.replace(/"/g, '\\\\"') + '"]');
    if (aria && role) selectors.push('role=' + role + '[name="' + aria.replace(/"/g, '\\\\"') + '"]');
    if (name) selectors.push('[name="' + name.replace(/"/g, '\\\\"') + '"]');
    if (id) selectors.push('#' + cssEscape(id));
    if (text && text.length <= 60) selectors.push('text=' + text);
    selectors.push(cssPath(element));
    return Array.from(new Set(selectors.filter(Boolean)));
  };
  const isSensitive = element => {
    const haystack = [
      element.type,
      element.name,
      element.id,
      element.placeholder,
      element.getAttribute('aria-label')
    ].filter(Boolean).join(' ');
    return /(password|seed|mnemonic|private\\s*key|privateKey|recovery\\s*phrase|助记词|私钥|恢复短语)/i.test(haystack);
  };
  document.addEventListener('click', event => {
    const target = event.target && event.target.closest ? event.target.closest('button,a,input,textarea,select,[role="button"],[onclick]') : event.target;
    if (!target || target === document) return;
    const selectors = selectorsFor(target);
    emit({type: 'click', selector: selectors[0], selectors, text: textOf(target)});
  }, true);
  document.addEventListener('change', event => {
    const target = event.target;
    if (!target || !target.matches || !target.matches('input,textarea,select')) return;
    const selectors = selectorsFor(target);
    emit({
      type: target.tagName.toLowerCase() === 'select' ? 'select' : 'fill',
      selector: selectors[0],
      selectors,
      value: isSensitive(target) ? undefined : target.value,
      text: textOf(target)
    });
  }, true);
  document.addEventListener('keydown', event => {
    if (!['Enter', 'Tab', 'Escape'].includes(event.key)) return;
    emit({type: 'press', key: event.key});
  }, true);
  emit({type: 'navigation', url: location.href});
})();
`;

class RpaRecorder {
  private sessions = new Map<string, InternalRecorderSession>();

  async startRecorder(windowId: number, options: RpaRecorderOptions = {}): Promise<RpaRecorderSession> {
    const openResult = await openFingerprintWindow(windowId);
    if (!openResult?.webSocketDebuggerUrl) {
      throw new Error(
        `Profile ${windowId} failed to start or did not expose a CDP endpoint. Check the launch warning shown before this RPA error.`,
      );
    }
    const connected = await connectRpaBrowser(openResult.webSocketDebuggerUrl);
    const prepared = await prepareRpaSession({
      context: connected.context,
      fallbackPage: connected.page,
      sessionMode: options.sessionMode || DEFAULT_RPA_RECORDER_SESSION_MODE,
    });
    connected.page = prepared.page;
    const sessionId = `rec-${windowId}-${Date.now()}`;
    const session: InternalRecorderSession = {
      sessionId,
      windowId,
      startedAt: new Date().toISOString(),
      events: [],
      connected,
    };
    this.sessions.set(sessionId, session);
    await this.setupPage(session, connected.page);
    connected.context.on('page', page => {
      void this.setupPage(session, page);
    });
    return this.publicSession(session);
  }

  async stopRecorder(sessionId: string): Promise<RpaRecorderSession> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`RPA recorder session ${sessionId} not found.`);
    }
    this.sessions.delete(sessionId);
    await session.connected.disconnect().catch(() => undefined);
    return this.publicSession(session);
  }

  private async setupPage(session: InternalRecorderSession, page: Page) {
    const bindingName = `__chromePowerRpaRecord_${session.sessionId.replace(/[^a-zA-Z0-9_]/g, '_')}`;
    await page.exposeBinding(bindingName, async (_source, payload: Omit<RpaRecorderEvent, 'sessionId' | 'windowId' | 'step'>) => {
      const event: RpaRecorderEvent = {
        ...payload,
        sessionId: session.sessionId,
        windowId: session.windowId,
        timestamp: payload.timestamp || Date.now(),
      };
      if (event.type === 'navigation' && !shouldRecordNavigation(event.url)) {
        return;
      }
      event.step = toStep(event);
      session.events.push(event);
      emitRecorderEvent(event);
    }).catch(() => undefined);
    await page.addInitScript({content: recorderScript(bindingName)}).catch(() => undefined);
    await page.evaluate(recorderScript(bindingName)).catch(() => undefined);
    page.on('framenavigated', frame => {
      if (frame !== page.mainFrame()) return;
      if (!shouldRecordNavigation(frame.url())) return;
      const event: RpaRecorderEvent = {
        sessionId: session.sessionId,
        windowId: session.windowId,
        type: 'navigation',
        url: frame.url(),
        timestamp: Date.now(),
      };
      event.step = toStep(event);
      session.events.push(event);
      emitRecorderEvent(event);
    });
  }

  private publicSession(session: InternalRecorderSession): RpaRecorderSession {
    return {
      sessionId: session.sessionId,
      windowId: session.windowId,
      startedAt: session.startedAt,
      events: session.events,
    };
  }
}

export const rpaRecorder = new RpaRecorder();
