import {beforeEach, describe, expect, test, vi} from 'vitest';

const mockState = vi.hoisted(() => ({
  nextRunId: 1,
  releaseExecutor: undefined as undefined | (() => void),
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/chrome-power-test',
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
}));

vi.mock('../src/db/rpa', () => ({
  RpaDB: {
    getTaskForRun: vi.fn(() =>
      Promise.resolve({
        id: 1,
        name: 'Scheduler Test',
        flow: {schemaVersion: 1, steps: [{id: 'wait', type: 'waitForTimeout', timeoutMs: 1}]},
        defaultConcurrency: 1,
        defaultTimeoutMs: 30000,
        defaultRetry: 0,
        screenshotPolicy: 'never',
        closePolicy: 'keepOpen',
        sessionMode: 'taskUrlOnly',
        variables: {},
        sensitiveVariables: {},
        profileBindings: [{window_id: 10}],
      }),
    ),
    createRun: vi.fn(() => Promise.resolve(mockState.nextRunId++)),
    updateRun: vi.fn(() => Promise.resolve()),
    createRunProfile: vi.fn(() => Promise.resolve(100)),
    updateRunProfile: vi.fn(() => Promise.resolve()),
    createRunStep: vi.fn(() => Promise.resolve(200)),
    updateRunStep: vi.fn(() => Promise.resolve()),
    getRun: vi.fn((id: number) => Promise.resolve({id, task_id: 1, status: 'running'})),
    countRunProfiles: vi.fn(() => Promise.resolve({succeeded: 1, failed: 0})),
  },
}));

vi.mock('../src/db/window', () => ({
  WindowDB: {
    getById: vi.fn(() => Promise.resolve({id: 10, profile_id: 'profile-alpha'})),
  },
}));

vi.mock('../src/fingerprint', () => ({
  openFingerprintWindow: vi.fn(() => Promise.resolve({webSocketDebuggerUrl: 'ws://127.0.0.1/devtools/browser'})),
  closeFingerprintWindow: vi.fn(() => Promise.resolve()),
}));

vi.mock('../src/rpa/automation', () => ({
  connectRpaBrowser: vi.fn(() =>
    Promise.resolve({
      context: {},
      page: {},
      disconnect: vi.fn(() => Promise.resolve()),
    }),
  ),
}));

vi.mock('../src/rpa/artifacts', () => ({
  getRpaArtifactRoot: () => '/tmp/rpa',
  getRpaRunRoot: (runId: number) => `/tmp/rpa/${runId}`,
  getRpaProfileArtifactDir: (runId: number, profileId: string) => `/tmp/rpa/${runId}/${profileId}`,
}));

vi.mock('../src/rpa/session', () => ({
  DEFAULT_RPA_RUN_SESSION_MODE: 'taskUrlOnly',
  getFirstGotoUrl: vi.fn(() => 'https://example.com'),
  prepareRpaSession: vi.fn(({fallbackPage}) =>
    Promise.resolve({
      page: fallbackPage,
      result: {
        sessionMode: 'taskUrlOnly',
        requestedSessionMode: 'taskUrlOnly',
        closedPageCount: 1,
        keptExtensionPageCount: 0,
        warningMessages: [],
        openedUrl: 'https://example.com',
      },
    }),
  ),
}));

vi.mock('../src/rpa/executor', () => ({
  executeRpaFlow: vi.fn(
    () =>
      new Promise<void>(resolve => {
        mockState.releaseExecutor = resolve;
      }),
  ),
}));

describe('rpa scheduler', () => {
  beforeEach(() => {
    mockState.nextRunId = 1;
    mockState.releaseExecutor = undefined;
  });

  test('prevents two active runs from occupying the same profile', async () => {
    const {RpaScheduler} = await import('../src/rpa/scheduler');
    const scheduler = new RpaScheduler();

    await scheduler.startRun(1);
    await new Promise(resolve => setTimeout(resolve, 0));

    await expect(scheduler.startRun(1)).rejects.toThrow('already occupied');
    mockState.releaseExecutor?.();
  });
});
