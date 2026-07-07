import {chromium, type Browser, type BrowserContext, type Page} from 'playwright';

export interface RpaConnectedBrowser {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  disconnect: () => Promise<void>;
}

export const connectRpaBrowser = async (browserWSEndpoint: string): Promise<RpaConnectedBrowser> => {
  const browser = await chromium.connectOverCDP(browserWSEndpoint);
  const context = browser.contexts()[0] || (await browser.newContext());
  let page = context.pages().find(candidate => !candidate.isClosed());
  if (!page) {
    page = await context.newPage();
  }
  await page.bringToFront().catch(() => undefined);

  return {
    browser,
    context,
    page,
    disconnect: async () => {
      await browser.close().catch(() => undefined);
    },
  };
};

export const findPageByTarget = async (
  context: BrowserContext,
  fallback: Page,
  target?: {
    page?: 'current' | 'first' | 'last' | 'popup' | string;
    urlIncludes?: string;
    titleIncludes?: string;
  },
) => {
  const pages = context.pages().filter(page => !page.isClosed());
  if (!target || target.page === 'current') return fallback;
  if (target.page === 'first') return pages[0] || fallback;
  if (target.page === 'last' || target.page === 'popup') return pages[pages.length - 1] || fallback;

  for (const page of pages) {
    const title = await page.title().catch(() => '');
    const matchesUrl = target.urlIncludes ? page.url().includes(target.urlIncludes) : true;
    const matchesTitle = target.titleIncludes ? title.includes(target.titleIncludes) : true;
    const matchesPage =
      typeof target.page === 'string' && !['current', 'first', 'last', 'popup'].includes(target.page)
        ? page.url().includes(target.page) || title.includes(target.page)
        : true;
    if (matchesUrl && matchesTitle && matchesPage) return page;
  }
  return fallback;
};
