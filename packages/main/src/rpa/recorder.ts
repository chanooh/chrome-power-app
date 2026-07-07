import {BrowserWindow} from 'electron';
import puppeteer, {
  type Browser as PuppeteerBrowser,
  type Page as PuppeteerPage,
  type Target as PuppeteerTarget,
} from 'puppeteer';
import type {
  RpaRecorderEvent,
  RpaRecorderOptions,
  RpaRecorderSession,
  RpaTaskStep,
} from '../../../shared/types/rpa';
import {openFingerprintWindow} from '../fingerprint';
import {appendRpaRecorderEvent} from './recorder-events';
import {classifyRpaPageUrl, DEFAULT_RPA_RECORDER_SESSION_MODE} from './session';

interface RpaRecorderConnection {
  browser: PuppeteerBrowser;
  page: PuppeteerPage;
  disconnect: () => Promise<void>;
}

interface InternalRecorderSession extends RpaRecorderSession {
  connected: RpaRecorderConnection;
  preparedPages: WeakSet<PuppeteerPage>;
}

type RecorderPayload = Omit<RpaRecorderEvent, 'sessionId' | 'windowId' | 'step'>;

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

const connectRpaRecorderBrowser = async (browserWSEndpoint: string): Promise<RpaRecorderConnection> => {
  const browser = await puppeteer.connect({
    browserWSEndpoint,
    defaultViewport: null,
  });
  const pages = (await browser.pages()).filter(page => !page.isClosed());
  let page = pages.find(candidate => classifyRpaPageUrl(candidate.url()) !== 'internal');
  if (!page) {
    page = await browser.newPage();
  }
  await page.bringToFront().catch(() => undefined);

  return {
    browser,
    page,
    disconnect: async () => {
      browser.disconnect();
    },
  };
};

const chooseExistingRecorderPage = async (browser: PuppeteerBrowser, fallbackPage: PuppeteerPage) => {
  const pages = (await browser.pages()).filter(page => !page.isClosed());
  if (!fallbackPage.isClosed() && classifyRpaPageUrl(fallbackPage.url()) !== 'internal') {
    return fallbackPage;
  }
  return (
    pages.find(page => classifyRpaPageUrl(page.url()) === 'ordinary') ||
    pages.find(page => classifyRpaPageUrl(page.url()) === 'extension') ||
    pages[0] ||
    (await browser.newPage())
  );
};

const prepareRecorderSession = async (
  connected: RpaRecorderConnection,
  sessionMode = DEFAULT_RPA_RECORDER_SESSION_MODE,
) => {
  if (sessionMode === 'keepExisting') {
    connected.page = await chooseExistingRecorderPage(connected.browser, connected.page);
    await connected.page.bringToFront().catch(() => undefined);
    return;
  }

  const pages = (await connected.browser.pages()).filter(page => !page.isClosed());
  for (const page of pages) {
    const kind = classifyRpaPageUrl(page.url());
    if (kind === 'extension' || kind === 'other') continue;
    await page.close({runBeforeUnload: false}).catch(() => undefined);
  }

  connected.page = await connected.browser.newPage();
  await connected.page.goto('about:blank').catch(() => undefined);
  await connected.page.bringToFront().catch(() => undefined);
};

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
      locators: event.locators,
      element: event.element,
      quality: event.quality,
      value: event.value,
    };
  }
  if (event.type === 'select') {
    return {
      id,
      type: 'select',
      selector: event.selector,
      selectors: event.selectors,
      locators: event.locators,
      element: event.element,
      quality: event.quality,
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
    locators: event.locators,
    element: event.element,
    quality: event.quality,
    expectedUrl: event.expectedUrl,
    waitAfterClick: event.expectedUrl ? 'domcontentloaded' : undefined,
    text: event.text,
  };
};

const recorderScript = (bindingName: string) => `
(() => {
  if (window.__chromePowerRpaRecorderInstalled) return;
  window.__chromePowerRpaRecorderInstalled = true;
  const normalizeText = value => String(value || '').replace(/\\s+/g, ' ').trim();
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
  const quoteAttr = value => String(value || '').replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"');
  const textOf = element => normalizeText(element.innerText || element.value || element.textContent || '').slice(0, 160);
  const absoluteUrl = value => {
    try {
      return value ? new URL(value, location.href).href : undefined;
    } catch (_) {
      return value || undefined;
    }
  };
  const roleOf = element => {
    const explicit = element.getAttribute('role');
    if (explicit) return explicit;
    const tag = element.tagName.toLowerCase();
    if (tag === 'a' && element.getAttribute('href')) return 'link';
    if (tag === 'button') return 'button';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'input') {
      const type = (element.getAttribute('type') || 'text').toLowerCase();
      if (['button', 'submit', 'reset'].includes(type)) return 'button';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      return 'textbox';
    }
    return undefined;
  };
  const labelOf = element => {
    const aria = element.getAttribute('aria-label');
    if (aria) return normalizeText(aria);
    if (element.labels && element.labels.length) {
      return normalizeText(Array.from(element.labels).map(label => label.innerText || label.textContent).join(' '));
    }
    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) {
      return normalizeText(labelledBy.split(/\\s+/).map(id => {
        const node = document.getElementById(id);
        return node ? node.innerText || node.textContent : '';
      }).join(' '));
    }
    return undefined;
  };
  const boundsOf = element => {
    const rect = element.getBoundingClientRect();
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
  };
  const cssPath = element => {
    const parts = [];
    let node = element;
    while (node && node.nodeType === Node.ELEMENT_NODE && parts.length < 6) {
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
  const xpathPath = element => {
    const parts = [];
    let node = element;
    while (node && node.nodeType === Node.ELEMENT_NODE && parts.length < 6) {
      let index = 1;
      let sibling = node.previousElementSibling;
      while (sibling) {
        if (sibling.nodeName === node.nodeName) index++;
        sibling = sibling.previousElementSibling;
      }
      parts.unshift(node.nodeName.toLowerCase() + '[' + index + ']');
      node = node.parentElement;
    }
    return '/' + parts.join('/');
  };
  const elementData = element => {
    const locators = [];
    const selectors = [];
    const testId = element.getAttribute('data-testid') || element.getAttribute('data-test');
    const aria = element.getAttribute('aria-label');
    const name = element.getAttribute('name');
    const id = element.id;
    const role = roleOf(element);
    const label = labelOf(element);
    const placeholder = element.getAttribute('placeholder');
    const href = absoluteUrl(element.getAttribute('href'));
    const text = textOf(element);
    if (testId) {
      locators.push({type: 'testId', value: testId, score: 95});
      selectors.push('[data-testid="' + quoteAttr(testId) + '"]');
    }
    if (role && (aria || text || label)) {
      const roleName = aria || label || text;
      locators.push({type: 'role', role, name: roleName, value: roleName, exact: false, score: 85});
      selectors.push('role=' + role + '[name="' + quoteAttr(roleName) + '"]');
    }
    if (label) {
      locators.push({type: 'label', value: label, exact: false, score: 82});
    }
    if (placeholder) {
      locators.push({type: 'placeholder', value: placeholder, exact: false, score: 78});
    }
    if (id) {
      locators.push({type: 'id', value: id, score: id.length > 3 ? 80 : 45});
      selectors.push('#' + cssEscape(id));
    }
    if (name) {
      locators.push({type: 'name', value: name, score: 72});
      selectors.push('[name="' + quoteAttr(name) + '"]');
    }
    if (href) {
      locators.push({type: 'href', value: href, text, score: text ? 68 : 55});
    }
    if (text && text.length <= 120) {
      locators.push({type: 'text', value: text, exact: text.length <= 64, score: href ? 58 : 48});
      selectors.push('text=' + text);
    }
    const css = cssPath(element);
    if (css) {
      locators.push({type: 'css', value: css, score: css.includes('nth-of-type') ? 15 : 35});
      selectors.push(css);
    }
    const xpath = xpathPath(element);
    if (xpath) {
      locators.push({type: 'xpath', value: xpath, score: 12});
    }
    const bounds = boundsOf(element);
    if (bounds.width > 0 && bounds.height > 0) {
      locators.push({type: 'bounds', value: JSON.stringify(bounds), score: 5});
    }
    const bestScore = locators.reduce((score, locator) => Math.max(score, locator.score || 0), 0);
    const quality = bestScore >= 80 ? 'high' : bestScore >= 45 ? 'medium' : 'low';
    return {
      selector: selectors[0],
      selectors: Array.from(new Set(selectors.filter(Boolean))),
      locators,
      element: {
        tag: element.tagName.toLowerCase(),
        role,
        text,
        ariaLabel: aria || label,
        href,
        id: id || undefined,
        name: name || undefined,
        inputType: element.getAttribute('type') || undefined,
        placeholder: placeholder || undefined,
        recordedUrl: location.href,
        bounds,
        quality
      },
      quality,
      text
    };
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
    emit({type: 'click', ...elementData(target)});
  }, true);
  document.addEventListener('change', event => {
    const target = event.target;
    if (!target || !target.matches || !target.matches('input,textarea,select')) return;
    const data = elementData(target);
    emit({
      type: target.tagName.toLowerCase() === 'select' ? 'select' : 'fill',
      ...data,
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
    const connected = await connectRpaRecorderBrowser(openResult.webSocketDebuggerUrl);
    await prepareRecorderSession(connected, options.sessionMode || DEFAULT_RPA_RECORDER_SESSION_MODE);
    const sessionId = `rec-${windowId}-${Date.now()}`;
    const session: InternalRecorderSession = {
      sessionId,
      windowId,
      startedAt: new Date().toISOString(),
      events: [],
      connected,
      preparedPages: new WeakSet<PuppeteerPage>(),
    };
    this.sessions.set(sessionId, session);
    await this.setupPage(session, connected.page);
    connected.browser.on('targetcreated', target => {
      void this.setupTarget(session, target);
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

  private async setupTarget(session: InternalRecorderSession, target: PuppeteerTarget) {
    const page = await target.page().catch(() => undefined);
    if (page) {
      await this.setupPage(session, page);
    }
  }

  private async setupPage(session: InternalRecorderSession, page: PuppeteerPage) {
    if (session.preparedPages.has(page)) {
      return;
    }
    session.preparedPages.add(page);
    const bindingName = `__chromePowerRpaRecord_${session.sessionId.replace(/[^a-zA-Z0-9_]/g, '_')}`;
    await page.exposeFunction(bindingName, async (payload: RecorderPayload) => {
      this.recordPayload(session, payload);
    }).catch(() => undefined);
    await page.evaluateOnNewDocument(recorderScript(bindingName)).catch(() => undefined);
    await page.evaluate(recorderScript(bindingName)).catch(() => undefined);
    page.on('framenavigated', frame => {
      if (frame !== page.mainFrame()) return;
      if (!shouldRecordNavigation(frame.url())) return;
      this.recordPayload(session, {
        type: 'navigation',
        url: frame.url(),
        timestamp: Date.now(),
      });
    });
  }

  private recordPayload(session: InternalRecorderSession, payload: RecorderPayload) {
    const event: RpaRecorderEvent = {
      ...payload,
      sessionId: session.sessionId,
      windowId: session.windowId,
      timestamp: payload.timestamp || Date.now(),
    };
    if (event.type === 'navigation') {
      const result = appendRpaRecorderEvent(session.events, event, toStep);
      if (result.event) {
        emitRecorderEvent(result.event);
      }
      return;
    }
    const result = appendRpaRecorderEvent(session.events, event, toStep);
    if (result.event) {
      emitRecorderEvent(result.event);
    }
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
