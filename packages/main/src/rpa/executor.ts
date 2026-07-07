import type {BrowserContext, Frame, Page} from 'playwright';
import type {DB, SafeAny} from '../../../shared/types/db';
import type {
  RpaScreenshotPolicy,
  RpaTask,
  RpaTaskStep,
} from '../../../shared/types/rpa';
import {findPageByTarget} from './automation';
import {resolveRpaArtifactPath, writeRpaJsonArtifact} from './artifacts';
import {isSensitiveFillStep} from './validation';
import {renderTemplateValue, resolveVariablePath} from './variables';

export interface RpaStepExecutionRecord {
  step: RpaTaskStep;
  stepIndex: number;
  attempt: number;
  startedAt: number;
  finishedAt: number;
  status: 'succeeded' | 'failed' | 'skipped' | 'canceled';
  message?: string;
  error?: string;
  artifactPath?: string;
  output?: Record<string, unknown>;
}

export interface RpaExecutionHooks {
  beforeStep?: (step: RpaTaskStep, stepIndex: number, attempt: number) => Promise<void>;
  afterStep?: (record: RpaStepExecutionRecord) => Promise<void>;
  waitIfPaused?: () => Promise<void>;
  shouldStop?: () => boolean;
  requestManualConfirm?: (step: RpaTaskStep) => Promise<void>;
}

export interface RpaExecutionContext {
  task: RpaTask;
  window: DB.Window;
  context: BrowserContext;
  page: Page;
  artifactDir: string;
  variables: Record<string, string>;
  screenshotPolicy: RpaScreenshotPolicy;
  hooks?: RpaExecutionHooks;
}

const SELECTOR_TIMEOUT_FLOOR = 500;

const getStepTimeout = (task: RpaTask, step: RpaTaskStep) =>
  step.timeoutMs || task.defaultTimeoutMs || 30000;

const getStepRetry = (task: RpaTask, step: RpaTaskStep) =>
  step.retry ?? task.defaultRetry ?? 0;

const getTargetFrame = (page: Page, step: RpaTaskStep): Page | Frame => {
  const frameTarget = step.target?.frame;
  if (!frameTarget || frameTarget === 'main') return page;
  const frame = page
    .frames()
    .find(candidate => candidate.name().includes(frameTarget) || candidate.url().includes(frameTarget));
  if (!frame) {
    throw new Error(`Frame not found: ${frameTarget}`);
  }
  return frame;
};

const resolveSelector = async (
  target: Page | Frame,
  step: RpaTaskStep,
  timeoutMs: number,
) => {
  const selectors = [step.selector, ...(step.selectors || [])].filter(Boolean) as string[];
  if (!selectors.length) return undefined;
  const perSelectorTimeout = Math.max(SELECTOR_TIMEOUT_FLOOR, Math.floor(timeoutMs / selectors.length));
  let lastError: Error | undefined;
  for (const selector of selectors) {
    try {
      await target.waitForSelector(selector, {timeout: perSelectorTimeout, state: 'attached'});
      return selector;
    } catch (error) {
      lastError = error as Error;
    }
  }
  throw lastError || new Error(`Selector not found: ${selectors.join(', ')}`);
};

const textMatches = (actual: string, expected: string) => {
  if (expected.startsWith('/') && expected.endsWith('/')) {
    return new RegExp(expected.slice(1, -1)).test(actual);
  }
  return actual.includes(expected);
};

const screenshot = async (
  page: Page,
  artifactDir: string,
  step: RpaTaskStep,
  stepIndex: number,
  suffix = 'screenshot',
) => {
  const fileName = `${String(stepIndex + 1).padStart(3, '0')}-${step.id}-${suffix}.png`;
  const path = resolveRpaArtifactPath(artifactDir, fileName);
  await page.screenshot({path, fullPage: true});
  return path;
};

const executeSingleStep = async (
  execution: RpaExecutionContext,
  step: RpaTaskStep,
  stepIndex: number,
): Promise<{message?: string; artifactPath?: string; output?: Record<string, unknown>}> => {
  const timeoutMs = getStepTimeout(execution.task, step);
  let page = await findPageByTarget(execution.context, execution.page, step.target);
  execution.page = page;
  await page.bringToFront().catch(() => undefined);
  const target = getTargetFrame(page, step);
  const selector = await resolveSelector(target, step, timeoutMs);
  const renderedValue = renderTemplateValue(
    step.valueFrom ? resolveVariablePath(step.valueFrom, execution.variables) : step.value,
    execution.variables,
  );

  switch (step.type) {
    case 'goto':
      await page.goto(renderTemplateValue(step.url, execution.variables)!, {
        waitUntil: step.loadState || 'load',
        timeout: timeoutMs,
      });
      return {message: `Navigated to ${page.url()}`};
    case 'waitForSelector':
      return {message: `Selector ready: ${selector}`};
    case 'click':
      await target.locator(selector!).click({timeout: timeoutMs});
      return {message: `Clicked ${selector}`};
    case 'fill':
      if (isSensitiveFillStep(step)) {
        throw new Error('Sensitive recovery/private-key style input is blocked. Use manualConfirm.');
      }
      await target.locator(selector!).fill(renderedValue || '', {timeout: timeoutMs});
      return {message: `Filled ${selector}`};
    case 'press':
      await page.keyboard.press(step.key!, {delay: 20});
      return {message: `Pressed ${step.key}`};
    case 'select':
      await target.locator(selector!).selectOption(renderedValue || step.value || '', {timeout: timeoutMs});
      return {message: `Selected ${selector}`};
    case 'check':
      await target.locator(selector!).check({timeout: timeoutMs});
      return {message: `Checked ${selector}`};
    case 'uncheck':
      await target.locator(selector!).uncheck({timeout: timeoutMs});
      return {message: `Unchecked ${selector}`};
    case 'hover':
      await target.locator(selector!).hover({timeout: timeoutMs});
      return {message: `Hovered ${selector}`};
    case 'scroll':
      await page.mouse.wheel(step.x || 0, step.y || 600);
      return {message: 'Scrolled page'};
    case 'waitForLoadState':
      await page.waitForLoadState(step.loadState || 'load', {timeout: timeoutMs});
      return {message: `Load state reached: ${step.loadState || 'load'}`};
    case 'waitForTimeout':
      await page.waitForTimeout(step.timeoutMs || timeoutMs);
      return {message: `Waited ${step.timeoutMs || timeoutMs}ms`};
    case 'waitForURL':
      await page.waitForURL(step.url || step.expected || '**', {timeout: timeoutMs});
      return {message: `URL matched ${step.url || step.expected}`};
    case 'screenshot': {
      const artifactPath = await screenshot(page, execution.artifactDir, step, stepIndex, 'manual');
      return {message: 'Screenshot saved', artifactPath};
    }
    case 'extractText': {
      const text = selector ? await target.locator(selector).innerText({timeout: timeoutMs}) : await page.title();
      const output = {[step.outputKey || step.id]: text};
      writeRpaJsonArtifact(execution.artifactDir, `${step.id}-output.json`, output);
      return {message: 'Text extracted', output};
    }
    case 'extractAttribute': {
      const value = await target.locator(selector!).getAttribute(step.attribute!, {timeout: timeoutMs});
      const output = {[step.outputKey || step.id]: value};
      writeRpaJsonArtifact(execution.artifactDir, `${step.id}-output.json`, output);
      return {message: `Attribute extracted: ${step.attribute}`, output};
    }
    case 'assertText': {
      const actual = selector ? await target.locator(selector).innerText({timeout: timeoutMs}) : await page.content();
      if (!textMatches(actual, renderTemplateValue(step.expected || step.text, execution.variables) || '')) {
        throw new Error(`Text assertion failed for ${selector || 'page'}`);
      }
      return {message: 'Text assertion passed'};
    }
    case 'switchPage':
      page = await findPageByTarget(execution.context, page, {
        page: step.target?.page || step.url || step.expected || 'last',
        urlIncludes: step.target?.urlIncludes || step.url,
        titleIncludes: step.target?.titleIncludes || step.text,
      });
      execution.page = page;
      await page.bringToFront().catch(() => undefined);
      return {message: `Switched page: ${page.url()}`};
    case 'switchFrame':
      getTargetFrame(page, {...step, target: {...step.target, frame: step.target?.frame || step.text}});
      return {message: `Frame ready: ${step.target?.frame || step.text}`};
    case 'manualConfirm':
      await execution.hooks?.requestManualConfirm?.(step);
      return {message: step.text || step.note || 'Manual confirmation completed'};
    default:
      throw new Error(`Unsupported RPA step type: ${(step as SafeAny).type}`);
  }
};

export const executeRpaFlow = async (execution: RpaExecutionContext) => {
  const records: RpaStepExecutionRecord[] = [];
  for (let stepIndex = 0; stepIndex < execution.task.flow.steps.length; stepIndex++) {
    const step = execution.task.flow.steps[stepIndex];
    const maxAttempts = getStepRetry(execution.task, step) + 1;
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await execution.hooks?.waitIfPaused?.();
      if (execution.hooks?.shouldStop?.()) {
        const record: RpaStepExecutionRecord = {
          step,
          stepIndex,
          attempt,
          startedAt: Date.now(),
          finishedAt: Date.now(),
          status: 'canceled',
          message: 'Run stopped before step execution.',
        };
        await execution.hooks?.afterStep?.(record);
        records.push(record);
        return records;
      }

      const startedAt = Date.now();
      await execution.hooks?.beforeStep?.(step, stepIndex, attempt);
      try {
        const result = await executeSingleStep(execution, step, stepIndex);
        let artifactPath = result.artifactPath;
        if (!artifactPath && execution.screenshotPolicy === 'every-step') {
          artifactPath = await screenshot(execution.page, execution.artifactDir, step, stepIndex, 'step');
        }
        const record: RpaStepExecutionRecord = {
          step,
          stepIndex,
          attempt,
          startedAt,
          finishedAt: Date.now(),
          status: 'succeeded',
          message: result.message,
          artifactPath,
          output: result.output,
        };
        await execution.hooks?.afterStep?.(record);
        records.push(record);
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error as Error;
        const isLastAttempt = attempt >= maxAttempts;
        let artifactPath: string | undefined;
        if (isLastAttempt && execution.screenshotPolicy !== 'never') {
          artifactPath = await screenshot(execution.page, execution.artifactDir, step, stepIndex, 'failure').catch(
            () => undefined,
          );
        }
        const record: RpaStepExecutionRecord = {
          step,
          stepIndex,
          attempt,
          startedAt,
          finishedAt: Date.now(),
          status: isLastAttempt ? (step.continueOnError ? 'skipped' : 'failed') : 'failed',
          error: lastError.message,
          artifactPath,
        };
        await execution.hooks?.afterStep?.(record);
        records.push(record);
        if (isLastAttempt && !step.continueOnError) {
          throw lastError;
        }
        if (isLastAttempt && step.continueOnError) {
          break;
        }
      }
    }
  }
  return records;
};
