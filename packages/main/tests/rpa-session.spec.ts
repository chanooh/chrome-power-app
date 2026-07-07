import {describe, expect, test, vi} from 'vitest';
import type {SafeAny} from '../../shared/types/db';
import {
  classifyRpaPageUrl,
  getFirstGotoUrl,
  prepareRpaSession,
} from '../src/rpa/session';

const createPage = (url: string, closeShouldFail = false) => ({
  url: vi.fn(() => url),
  isClosed: vi.fn(() => false),
  close: vi.fn(() => (closeShouldFail ? Promise.reject(new Error('cannot close')) : Promise.resolve())),
  bringToFront: vi.fn(() => Promise.resolve()),
  goto: vi.fn((nextUrl: string) => {
    url = nextUrl;
    return Promise.resolve();
  }),
});

const createContext = (pages: SafeAny[]) => ({
  pages: vi.fn(() => pages),
  newPage: vi.fn(async () => {
    const page = createPage('about:blank');
    pages.push(page);
    return page;
  }),
});

describe('rpa session handling', () => {
  test('classifies ordinary, extension, and internal pages', () => {
    expect(classifyRpaPageUrl('https://example.com')).toBe('ordinary');
    expect(classifyRpaPageUrl('about:blank')).toBe('ordinary');
    expect(classifyRpaPageUrl('chrome-extension://abc/popup.html')).toBe('extension');
    expect(classifyRpaPageUrl('chrome://version')).toBe('internal');
    expect(classifyRpaPageUrl('devtools://devtools/bundled/inspector.html')).toBe('internal');
  });

  test('cleanPages closes ordinary pages, keeps extension pages, and opens a clean page', async () => {
    const ordinary = createPage('https://old.example');
    const extension = createPage('chrome-extension://wallet/popup.html');
    const context = createContext([ordinary, extension]);

    const prepared = await prepareRpaSession({
      context: context as never,
      fallbackPage: ordinary as never,
      sessionMode: 'cleanPages',
    });

    expect(ordinary.close).toHaveBeenCalled();
    expect(extension.close).not.toHaveBeenCalled();
    expect(context.newPage).toHaveBeenCalled();
    expect(prepared.result.closedPageCount).toBe(1);
    expect(prepared.result.keptExtensionPageCount).toBe(1);
    expect(prepared.result.sessionMode).toBe('cleanPages');
  });

  test('taskUrlOnly opens the rendered first goto URL', async () => {
    const oldPage = createPage('https://old.example');
    const context = createContext([oldPage]);

    const prepared = await prepareRpaSession({
      context: context as never,
      fallbackPage: oldPage as never,
      sessionMode: 'taskUrlOnly',
      taskUrl: 'https://task.example/start',
    });

    expect(oldPage.close).toHaveBeenCalled();
    expect(prepared.page.goto).toHaveBeenCalledWith('https://task.example/start', {
      waitUntil: 'load',
      timeout: 30000,
    });
    expect(prepared.result.openedUrl).toBe('https://task.example/start');
  });

  test('taskUrlOnly falls back to cleanPages without a goto URL', async () => {
    const oldPage = createPage('https://old.example');
    const context = createContext([oldPage]);

    const prepared = await prepareRpaSession({
      context: context as never,
      fallbackPage: oldPage as never,
      sessionMode: 'taskUrlOnly',
    });

    expect(prepared.result.sessionMode).toBe('cleanPages');
    expect(prepared.result.warningMessages[0]).toContain('fell back to cleanPages');
  });

  test('keepExisting does not close pages', async () => {
    const oldPage = createPage('https://old.example');
    const extension = createPage('chrome-extension://wallet/popup.html');
    const context = createContext([oldPage, extension]);

    const prepared = await prepareRpaSession({
      context: context as never,
      fallbackPage: oldPage as never,
      sessionMode: 'keepExisting',
    });

    expect(oldPage.close).not.toHaveBeenCalled();
    expect(extension.close).not.toHaveBeenCalled();
    expect(prepared.page).toBe(oldPage);
  });

  test('close failures become warnings instead of aborting session preparation', async () => {
    const oldPage = createPage('chrome://version', true);
    const context = createContext([oldPage]);

    const prepared = await prepareRpaSession({
      context: context as never,
      fallbackPage: oldPage as never,
      sessionMode: 'cleanPages',
    });

    expect(prepared.result.warningMessages[0]).toContain('Failed to close internal page');
    expect(context.newPage).toHaveBeenCalled();
  });

  test('keeps unsupported protocol pages and records a warning', async () => {
    const unsupported = createPage('custom-scheme://state');
    const context = createContext([unsupported]);

    const prepared = await prepareRpaSession({
      context: context as never,
      fallbackPage: unsupported as never,
      sessionMode: 'cleanPages',
    });

    expect(unsupported.close).not.toHaveBeenCalled();
    expect(prepared.result.warningMessages[0]).toContain('Kept unsupported page');
  });

  test('gets the first goto URL with variables rendered', () => {
    expect(
      getFirstGotoUrl(
        {
          schemaVersion: 1,
          steps: [{id: 'open', type: 'goto', url: 'https://example.com/{{profile.id}}'}],
        },
        {'profile.id': 'abc'},
      ),
    ).toBe('https://example.com/abc');
  });
});
