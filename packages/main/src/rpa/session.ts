import type {BrowserContext, Page} from 'playwright';
import type {
  RpaSessionMode,
  RpaSessionPrepareResult,
  RpaTaskFlow,
} from '../../../shared/types/rpa';
import {renderTemplateValue} from './variables';

export const DEFAULT_RPA_RUN_SESSION_MODE: RpaSessionMode = 'taskUrlOnly';
export const DEFAULT_RPA_RECORDER_SESSION_MODE: RpaSessionMode = 'cleanPages';

export type RpaPageKind = 'ordinary' | 'extension' | 'internal' | 'other';

export interface RpaSessionPrepareOptions {
  context: BrowserContext;
  fallbackPage: Page;
  sessionMode: RpaSessionMode;
  taskUrl?: string;
}

export interface PreparedRpaSession {
  page: Page;
  result: RpaSessionPrepareResult;
}

const INTERNAL_PROTOCOLS = ['chrome://', 'devtools://', 'edge://', 'chrome-devtools://'];

export const classifyRpaPageUrl = (url: string): RpaPageKind => {
  if (!url || url === 'about:blank') return 'ordinary';
  if (url.startsWith('chrome-extension://')) return 'extension';
  if (INTERNAL_PROTOCOLS.some(protocol => url.startsWith(protocol))) return 'internal';
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('file://')) {
    return 'ordinary';
  }
  return 'other';
};

export const getFirstGotoUrl = (
  flow: RpaTaskFlow,
  variables: Record<string, string>,
) => {
  const gotoStep = flow.steps.find(step => step.type === 'goto' && step.url);
  if (!gotoStep?.url) return undefined;
  return renderTemplateValue(gotoStep.url, variables);
};

const openPreparedPage = async (
  context: BrowserContext,
  requestedMode: RpaSessionMode,
  taskUrl: string | undefined,
  warnings: string[],
) => {
  const page = await context.newPage();
  if (requestedMode === 'taskUrlOnly') {
    if (taskUrl) {
      await page.goto(taskUrl, {waitUntil: 'load', timeout: 30000});
      return {page, effectiveMode: 'taskUrlOnly' as RpaSessionMode, openedUrl: taskUrl};
    }
    warnings.push('taskUrlOnly session mode did not find a goto URL and fell back to cleanPages.');
  }
  await page.goto('about:blank').catch(() => undefined);
  return {page, effectiveMode: 'cleanPages' as RpaSessionMode, openedUrl: undefined};
};

const chooseExistingPage = async (context: BrowserContext, fallbackPage: Page) => {
  const pages = context.pages().filter(page => !page.isClosed());
  if (!fallbackPage.isClosed() && classifyRpaPageUrl(fallbackPage.url()) !== 'internal') {
    return fallbackPage;
  }
  return (
    pages.find(page => classifyRpaPageUrl(page.url()) === 'ordinary') ||
    pages.find(page => classifyRpaPageUrl(page.url()) === 'extension') ||
    pages[0] ||
    (await context.newPage())
  );
};

export const prepareRpaSession = async ({
  context,
  fallbackPage,
  sessionMode,
  taskUrl,
}: RpaSessionPrepareOptions): Promise<PreparedRpaSession> => {
  const pages = context.pages().filter(page => !page.isClosed());
  const warnings: string[] = [];
  const keptExtensionPageCount = pages.filter(page => classifyRpaPageUrl(page.url()) === 'extension').length;

  if (sessionMode === 'keepExisting') {
    const page = await chooseExistingPage(context, fallbackPage);
    await page.bringToFront().catch(() => undefined);
    return {
      page,
      result: {
        sessionMode: 'keepExisting',
        requestedSessionMode: sessionMode,
        closedPageCount: 0,
        keptExtensionPageCount,
        warningMessages: warnings,
      },
    };
  }

  let closedPageCount = 0;
  for (const page of pages) {
    const kind = classifyRpaPageUrl(page.url());
    if (kind === 'extension') continue;
    if (kind === 'other') {
      warnings.push(`Kept unsupported page ${page.url()} while preparing RPA session.`);
      continue;
    }
    try {
      await page.close({runBeforeUnload: false});
      closedPageCount++;
    } catch (error) {
      warnings.push(`Failed to close ${kind} page ${page.url()}: ${(error as Error).message}`);
    }
  }

  const opened = await openPreparedPage(context, sessionMode, taskUrl, warnings);
  await opened.page.bringToFront().catch(() => undefined);
  return {
    page: opened.page,
    result: {
      sessionMode: opened.effectiveMode,
      requestedSessionMode: sessionMode,
      closedPageCount,
      keptExtensionPageCount,
      warningMessages: warnings,
      openedUrl: opened.openedUrl,
    },
  };
};
