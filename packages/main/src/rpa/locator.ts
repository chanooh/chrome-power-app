import type {Frame, Locator, Page} from 'playwright';
import type {
  RpaLocatorCandidate,
  RpaLocatorQuality,
  RpaTaskStep,
} from '../../../shared/types/rpa';

export interface RpaLocatorAttempt {
  candidate: RpaLocatorCandidate;
  label: string;
  status: 'matched' | 'failed' | 'skipped';
  count?: number;
  error?: string;
}

export interface RpaLocatorDebug {
  stepId: string;
  stepType: string;
  pageUrl: string;
  candidates: RpaLocatorCandidate[];
  attempts: RpaLocatorAttempt[];
  matched?: RpaLocatorAttempt;
}

export interface RpaResolvedElement {
  locator: Locator;
  candidate: RpaLocatorCandidate;
  label: string;
  debug: RpaLocatorDebug;
}

export class RpaLocatorError extends Error {
  debug: RpaLocatorDebug;

  constructor(message: string, debug: RpaLocatorDebug) {
    super(message);
    this.name = 'RpaLocatorError';
    this.debug = debug;
  }
}

const SELECTOR_TIMEOUT_FLOOR = 500;

const escapeAttributeValue = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const normalizeText = (value?: string) => (value || '').replace(/\s+/g, ' ').trim();

const locatorKey = (candidate: RpaLocatorCandidate) =>
  [
    candidate.type,
    candidate.value,
    candidate.role || '',
    candidate.name || '',
    candidate.text || '',
  ].join('\u0000');

const dedupeCandidates = (candidates: RpaLocatorCandidate[]) => {
  const seen = new Set<string>();
  return candidates.filter(candidate => {
    if (!candidate.value && candidate.type !== 'bounds') return false;
    const key = locatorKey(candidate);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const legacySelectorToCandidate = (selector: string): RpaLocatorCandidate => {
  if (selector.startsWith('text=')) {
    return {type: 'text', value: selector.slice(5), exact: true, score: 50};
  }
  const roleMatch = selector.match(/^role=([a-zA-Z0-9_-]+)\[name="(.+)"\]$/);
  if (roleMatch) {
    return {
      type: 'role',
      role: roleMatch[1],
      name: roleMatch[2].replace(/\\"/g, '"'),
      value: roleMatch[2].replace(/\\"/g, '"'),
      exact: true,
      score: 80,
    };
  }
  if (selector.startsWith('xpath=')) {
    return {type: 'xpath', value: selector.slice(6), score: 20};
  }
  return {type: 'css', value: selector, score: selector.includes('nth-of-type') ? 10 : 30};
};

export const getRpaLocatorQuality = (step: RpaTaskStep): RpaLocatorQuality | undefined => {
  if (step.quality) return step.quality;
  if (step.element?.quality) return step.element.quality;
  const candidates = getRpaLocatorCandidates(step);
  if (!candidates.length) return undefined;
  if (candidates.some(candidate => (candidate.score || 0) >= 80)) return 'high';
  if (candidates.some(candidate => (candidate.score || 0) >= 45)) return 'medium';
  return 'low';
};

export const getRpaLocatorCandidates = (step: RpaTaskStep) => {
  const candidates: RpaLocatorCandidate[] = [];
  candidates.push(...(step.locators || []));

  if (step.element?.href) {
    candidates.push({
      type: 'href',
      value: step.element.href,
      text: normalizeText(step.element.text || step.text),
      score: 65,
    });
  }
  if (step.element?.ariaLabel) {
    candidates.push({
      type: 'role',
      role: step.element.role || (step.element.tag === 'a' ? 'link' : undefined),
      value: step.element.ariaLabel,
      name: step.element.ariaLabel,
      score: 75,
    });
  }
  if (step.element?.text || step.text) {
    candidates.push({
      type: 'text',
      value: normalizeText(step.element?.text || step.text),
      exact: false,
      score: 45,
    });
  }

  const legacySelectors = [step.selector, ...(step.selectors || [])].filter(Boolean) as string[];
  candidates.push(...legacySelectors.map(legacySelectorToCandidate));
  return dedupeCandidates(candidates).sort((left, right) => (right.score || 0) - (left.score || 0));
};

const getHrefNeedle = (value: string) => {
  try {
    const url = new URL(value);
    return `${url.pathname}${url.search}` !== '/' ? `${url.pathname}${url.search}` : url.hostname;
  } catch {
    return value;
  }
};

const createLocator = (target: Page | Frame, candidate: RpaLocatorCandidate): Locator | undefined => {
  switch (candidate.type) {
    case 'testId':
      return target.getByTestId(candidate.value);
    case 'role':
      if (!candidate.role) return undefined;
      return target.getByRole(candidate.role as never, {
        name: candidate.name || candidate.value,
        exact: candidate.exact,
      });
    case 'label':
      return target.getByLabel(candidate.value, {exact: candidate.exact});
    case 'placeholder':
      return target.getByPlaceholder(candidate.value, {exact: candidate.exact});
    case 'id':
      return target.locator(`[id="${escapeAttributeValue(candidate.value)}"]`);
    case 'name':
      return target.locator(`[name="${escapeAttributeValue(candidate.value)}"]`);
    case 'href': {
      const needle = getHrefNeedle(candidate.value);
      const locator = target.locator(`a[href*="${escapeAttributeValue(needle)}"]`);
      return candidate.text ? locator.filter({hasText: candidate.text}) : locator;
    }
    case 'text':
      return target.getByText(candidate.value, {exact: candidate.exact});
    case 'css':
      return target.locator(candidate.value);
    case 'xpath':
      return target.locator(`xpath=${candidate.value}`);
    case 'bounds':
      return undefined;
    default:
      return undefined;
  }
};

const matchesExpectedUrl = (actual: string, expected: string) => {
  if (actual === expected || actual.startsWith(expected) || actual.includes(expected)) {
    return true;
  }
  try {
    const actualUrl = new URL(actual);
    const expectedUrl = new URL(expected);
    return actualUrl.hostname === expectedUrl.hostname && actualUrl.pathname === expectedUrl.pathname;
  } catch {
    return false;
  }
};

const waitForPostClick = async (
  page: Page,
  step: RpaTaskStep,
  timeoutMs: number,
  expectedUrl?: string,
) => {
  if (expectedUrl) {
    await page.waitForURL(url => matchesExpectedUrl(url.href, expectedUrl), {
      timeout: timeoutMs,
    });
    return;
  }
  if (step.waitAfterClick && step.waitAfterClick !== 'none') {
    await page.waitForLoadState(step.waitAfterClick, {timeout: timeoutMs}).catch(() => undefined);
    return;
  }
  await page.waitForTimeout(250).catch(() => undefined);
};

const runClickAction = async (
  page: Page,
  step: RpaTaskStep,
  timeoutMs: number,
  expectedUrl: string | undefined,
  action: () => Promise<void>,
) => {
  const postClickWait = waitForPostClick(page, step, timeoutMs, expectedUrl).then(
    () => undefined,
    error => error as Error,
  );
  try {
    await action();
  } catch (error) {
    await postClickWait;
    throw error;
  }
  const waitError = await postClickWait;
  if (waitError) {
    throw waitError;
  }
};

export const clickRpaElement = async (
  target: Page | Frame,
  page: Page,
  step: RpaTaskStep,
  timeoutMs: number,
  expectedUrl?: string,
) => {
  const candidates = getRpaLocatorCandidates(step);
  if (!candidates.length) {
    throw new RpaLocatorError(`Click step ${step.id} has no locator candidates.`, {
      stepId: step.id,
      stepType: step.type,
      pageUrl: page.url(),
      candidates,
      attempts: [],
    });
  }
  const perCandidateTimeout = Math.max(SELECTOR_TIMEOUT_FLOOR, Math.floor(timeoutMs / candidates.length));
  const debug: RpaLocatorDebug = {
    stepId: step.id,
    stepType: step.type,
    pageUrl: page.url(),
    candidates,
    attempts: [],
  };

  for (const candidate of candidates) {
    const label = `${candidate.type}:${candidate.role || candidate.value}`;
    const locator = createLocator(target, candidate);
    if (!locator) {
      debug.attempts.push({candidate, label, status: 'skipped', error: 'Unsupported locator candidate.'});
      continue;
    }
    const first = locator.first();
    try {
      await first.waitFor({state: 'visible', timeout: perCandidateTimeout});
      const count = await locator.count().catch(() => undefined);
      await first.scrollIntoViewIfNeeded({timeout: perCandidateTimeout}).catch(() => undefined);
      await runClickAction(page, step, timeoutMs, expectedUrl, () =>
        first.click({timeout: perCandidateTimeout}),
      );
      const attempt: RpaLocatorAttempt = {candidate, label, status: 'matched', count};
      debug.attempts.push(attempt);
      debug.matched = attempt;
      return {label, debug};
    } catch (primaryError) {
      debug.attempts.push({
        candidate,
        label,
        status: 'failed',
        error: `native click: ${(primaryError as Error).message}`,
      });
    }

    try {
      await runClickAction(page, step, timeoutMs, expectedUrl, () =>
        first.evaluate(element => {
          (element as HTMLElement).click();
        }),
      );
      const attempt: RpaLocatorAttempt = {
        candidate,
        label: `${label}:dom`,
        status: 'matched',
      };
      debug.attempts.push(attempt);
      debug.matched = attempt;
      return {label: attempt.label, debug};
    } catch (domError) {
      debug.attempts.push({
        candidate,
        label: `${label}:dom`,
        status: 'failed',
        error: `dom click: ${(domError as Error).message}`,
      });
    }

    try {
      const box = await first.boundingBox();
      if (!box || box.width <= 0 || box.height <= 0) {
        throw new Error('Element has no clickable bounding box.');
      }
      await runClickAction(page, step, timeoutMs, expectedUrl, () =>
        page.mouse.click(box.x + box.width / 2, box.y + box.height / 2),
      );
      const attempt: RpaLocatorAttempt = {
        candidate,
        label: `${label}:bounds`,
        status: 'matched',
      };
      debug.attempts.push(attempt);
      debug.matched = attempt;
      return {label: attempt.label, debug};
    } catch (boundsError) {
      debug.attempts.push({
        candidate,
        label: `${label}:bounds`,
        status: 'failed',
        error: `bounds click: ${(boundsError as Error).message}`,
      });
    }
  }

  throw new RpaLocatorError(
    `Click failed for step ${step.id}. Tried ${candidates.length} locator candidate(s).`,
    debug,
  );
};

export const resolveRpaElement = async (
  target: Page | Frame,
  page: Page,
  step: RpaTaskStep,
  timeoutMs: number,
  state: 'attached' | 'visible' = 'visible',
): Promise<RpaResolvedElement | undefined> => {
  const candidates = getRpaLocatorCandidates(step);
  if (!candidates.length) return undefined;
  const perCandidateTimeout = Math.max(SELECTOR_TIMEOUT_FLOOR, Math.floor(timeoutMs / candidates.length));
  const debug: RpaLocatorDebug = {
    stepId: step.id,
    stepType: step.type,
    pageUrl: page.url(),
    candidates,
    attempts: [],
  };

  for (const candidate of candidates) {
    const label = `${candidate.type}:${candidate.role || candidate.value}`;
    const locator = createLocator(target, candidate);
    if (!locator) {
      debug.attempts.push({candidate, label, status: 'skipped', error: 'Unsupported locator candidate.'});
      continue;
    }
    const first = locator.first();
    try {
      await first.waitFor({state, timeout: perCandidateTimeout});
      const count = await locator.count().catch(() => undefined);
      const attempt: RpaLocatorAttempt = {candidate, label, status: 'matched', count};
      debug.attempts.push(attempt);
      debug.matched = attempt;
      return {locator: first, candidate, label, debug};
    } catch (error) {
      debug.attempts.push({
        candidate,
        label,
        status: 'failed',
        error: (error as Error).message,
      });
    }
  }

  throw new RpaLocatorError(
    `Element not found for step ${step.id}. Tried ${candidates.length} locator candidate(s).`,
    debug,
  );
};

export const getRpaLocatorDebug = (error: unknown) =>
  error instanceof RpaLocatorError ? error.debug : undefined;
