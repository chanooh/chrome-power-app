import {describe, expect, test, vi} from 'vitest';
import type {SafeAny} from '../../shared/types/db';
import type {RpaTask} from '../../shared/types/rpa';
import {executeRpaFlow} from '../src/rpa/executor';

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/chrome-power-test',
  },
}));

const createMockAutomation = () => {
  const locator = {
    first: vi.fn(() => locator),
    waitFor: vi.fn(() => Promise.resolve()),
    count: vi.fn(() => Promise.resolve(1)),
    scrollIntoViewIfNeeded: vi.fn(() => Promise.resolve()),
    boundingBox: vi.fn(() => Promise.resolve({x: 10, y: 20, width: 100, height: 40})),
    evaluate: vi.fn(() => Promise.resolve()),
    click: vi.fn(() => Promise.resolve()),
    fill: vi.fn(() => Promise.resolve()),
    innerText: vi.fn(() => Promise.resolve('Welcome Example Domain')),
    getAttribute: vi.fn(() => Promise.resolve('value')),
    selectOption: vi.fn(() => Promise.resolve()),
    check: vi.fn(() => Promise.resolve()),
    uncheck: vi.fn(() => Promise.resolve()),
    hover: vi.fn(() => Promise.resolve()),
  };
  const page: SafeAny = {
    isClosed: () => false,
    bringToFront: vi.fn(() => Promise.resolve()),
    url: () => 'https://example.com',
    title: vi.fn(() => Promise.resolve('Example')),
    frames: () => [],
    waitForSelector: vi.fn(() => Promise.resolve({})),
    locator: vi.fn(() => locator),
    getByRole: vi.fn(() => locator),
    getByText: vi.fn(() => locator),
    getByTestId: vi.fn(() => locator),
    getByLabel: vi.fn(() => locator),
    getByPlaceholder: vi.fn(() => locator),
    goto: vi.fn(() => Promise.resolve()),
    keyboard: {press: vi.fn(() => Promise.resolve())},
    mouse: {wheel: vi.fn(() => Promise.resolve())},
    waitForLoadState: vi.fn(() => Promise.resolve()),
    waitForTimeout: vi.fn(() => Promise.resolve()),
    waitForURL: vi.fn(() => Promise.resolve()),
    screenshot: vi.fn(() => Promise.resolve(Buffer.from('png'))),
    content: vi.fn(() => Promise.resolve('<html>Welcome Example Domain</html>')),
  };
  const context: SafeAny = {
    pages: () => [page],
  };
  return {context, page, locator};
};

const task = (steps: RpaTask['flow']['steps']): RpaTask => ({
  name: 'Executor Test',
  flow: {schemaVersion: 1, steps},
  defaultConcurrency: 1,
  defaultTimeoutMs: 30000,
  defaultRetry: 0,
  screenshotPolicy: 'never',
  closePolicy: 'keepOpen',
  sessionMode: 'taskUrlOnly',
});

describe('rpa executor', () => {
  test('executes structured steps with variable values', async () => {
    const {context, page, locator} = createMockAutomation();
    const records: string[] = [];

    await executeRpaFlow({
      task: task([
        {id: 'goto', type: 'goto', url: 'https://example.com'},
        {id: 'fill', type: 'fill', selector: '[name="email"]', valueFrom: 'profile.email'},
        {id: 'click', type: 'click', selector: '[data-testid="submit"]'},
        {id: 'assert', type: 'assertText', expected: 'Example Domain'},
      ]),
      window: {id: 1, profile_id: 'profile-alpha'},
      context,
      page,
      artifactDir: '/tmp',
      variables: {'profile.email': 'user@example.com'},
      screenshotPolicy: 'never',
      hooks: {
        afterStep: async record => {
          records.push(`${record.step.id}:${record.status}`);
        },
      },
    });

    expect(page.goto).toHaveBeenCalledWith('https://example.com', {
      waitUntil: 'load',
      timeout: 30000,
    });
    expect(locator.fill).toHaveBeenCalledWith('user@example.com', {timeout: 30000});
    expect(locator.click).toHaveBeenCalled();
    expect(records).toEqual([
      'goto:succeeded',
      'fill:succeeded',
      'click:succeeded',
      'assert:succeeded',
    ]);
  });

  test('prefers enhanced locators over brittle css fallback', async () => {
    const {context, page, locator} = createMockAutomation();

    await executeRpaFlow({
      task: task([
        {
          id: 'click-reddit',
          type: 'click',
          selector: 'div > div:nth-of-type(1) > div > span > a',
          locators: [
            {
              type: 'role',
              role: 'link',
              value: 'Reddit',
              name: 'Reddit',
              score: 85,
            },
          ],
          expectedUrl: 'https://www.reddit.com/',
        },
      ]),
      window: {id: 1, profile_id: 'profile-alpha'},
      context,
      page,
      artifactDir: '/tmp',
      variables: {},
      screenshotPolicy: 'never',
    });

    expect(page.getByRole).toHaveBeenCalledWith('link', {name: 'Reddit', exact: undefined});
    expect(page.locator).not.toHaveBeenCalledWith('div > div:nth-of-type(1) > div > span > a');
    expect(locator.click).toHaveBeenCalled();
    expect(page.waitForURL).toHaveBeenCalled();
  });

  test('blocks sensitive fill steps at execution time', async () => {
    const {context, page} = createMockAutomation();

    await expect(
      executeRpaFlow({
        task: task([
          {
            id: 'seed',
            type: 'fill',
            selector: 'input[name="mnemonic"]',
            value: 'secret',
          },
        ]),
        window: {id: 1, profile_id: 'profile-alpha'},
        context,
        page,
        artifactDir: '/tmp',
        variables: {},
        screenshotPolicy: 'never',
      }),
    ).rejects.toThrow('Sensitive recovery/private-key style input is blocked');
  });
});
