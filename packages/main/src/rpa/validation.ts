import type {
  RpaTask,
  RpaTaskFlow,
  RpaTaskStep,
  RpaValidationIssue,
  RpaValidationResult,
} from '../../../shared/types/rpa';

export const RPA_STEP_TYPES = new Set([
  'goto',
  'waitForSelector',
  'click',
  'fill',
  'press',
  'select',
  'check',
  'uncheck',
  'hover',
  'scroll',
  'waitForLoadState',
  'waitForTimeout',
  'waitForURL',
  'screenshot',
  'extractText',
  'extractAttribute',
  'assertText',
  'switchPage',
  'switchFrame',
  'manualConfirm',
]);

export const SELECTOR_STEP_TYPES = new Set([
  'waitForSelector',
  'click',
  'fill',
  'select',
  'check',
  'uncheck',
  'hover',
  'extractText',
  'extractAttribute',
  'assertText',
]);

export const SENSITIVE_INPUT_PATTERN =
  /(seed|mnemonic|private\s*key|privateKey|recovery\s*phrase|secret\s*phrase|助记词|私钥|恢复短语)/i;

const VARIABLE_REF_PATTERN = /^[a-zA-Z0-9_.-]+$/;

export const parseRpaFlow = (flow: unknown): RpaTaskFlow => {
  if (typeof flow === 'string') return JSON.parse(flow) as RpaTaskFlow;
  return flow as RpaTaskFlow;
};

const push = (
  issues: RpaValidationIssue[],
  path: string,
  message: string,
  severity: RpaValidationIssue['severity'] = 'error',
) => {
  issues.push({path, message, severity});
};

const hasSelector = (step: RpaTaskStep) =>
  typeof step.selector === 'string' || (Array.isArray(step.selectors) && step.selectors.length > 0);

export const isSensitiveFillStep = (step: RpaTaskStep) => {
  if (step.type !== 'fill') return false;
  return [step.selector, ...(step.selectors || []), step.name, step.valueFrom, step.note]
    .filter(Boolean)
    .some(value => SENSITIVE_INPUT_PATTERN.test(String(value)));
};

export const validateRpaTask = (task: Partial<RpaTask>): RpaValidationResult => {
  const issues: RpaValidationIssue[] = [];
  if (!task.name || !task.name.trim()) {
    push(issues, 'name', 'Task name is required.');
  }

  let flow: RpaTaskFlow | undefined;
  try {
    flow = parseRpaFlow(task.flow);
  } catch (error) {
    push(issues, 'flow', `Flow JSON is invalid: ${(error as Error).message}`);
  }

  if (!flow || flow.schemaVersion !== 1 || !Array.isArray(flow.steps)) {
    push(issues, 'flow', 'Flow must use schemaVersion=1 and include a steps array.');
    return {valid: false, issues};
  }

  if (!flow.steps.length) {
    push(issues, 'flow.steps', 'At least one RPA step is required.');
  }

  const seenIds = new Set<string>();
  flow.steps.forEach((step, index) => {
    const path = `flow.steps[${index}]`;
    if (!step.id || typeof step.id !== 'string') {
      push(issues, `${path}.id`, 'Step id is required.');
    } else if (seenIds.has(step.id)) {
      push(issues, `${path}.id`, `Duplicate step id: ${step.id}`);
    } else {
      seenIds.add(step.id);
    }

    if (!RPA_STEP_TYPES.has(step.type)) {
      push(issues, `${path}.type`, `Unsupported step type: ${step.type}`);
    }

    if (SELECTOR_STEP_TYPES.has(step.type) && !hasSelector(step)) {
      push(issues, `${path}.selector`, `${step.type} requires selector or selectors.`);
    }

    if (step.type === 'goto' && !step.url) {
      push(issues, `${path}.url`, 'goto requires url.');
    }

    if (step.type === 'fill' && !step.value && !step.valueFrom) {
      push(issues, `${path}.value`, 'fill requires value or valueFrom.');
    }

    if (step.type === 'press' && !step.key) {
      push(issues, `${path}.key`, 'press requires key.');
    }

    if (step.type === 'extractAttribute' && !step.attribute) {
      push(issues, `${path}.attribute`, 'extractAttribute requires attribute.');
    }

    if (step.type === 'waitForTimeout' && !step.timeoutMs) {
      push(issues, `${path}.timeoutMs`, 'waitForTimeout requires timeoutMs.');
    }

    if (step.valueFrom && !VARIABLE_REF_PATTERN.test(step.valueFrom)) {
      push(issues, `${path}.valueFrom`, `Invalid variable reference: ${step.valueFrom}`);
    }

    if (isSensitiveFillStep(step)) {
      push(
        issues,
        path,
        'Sensitive recovery/private-key style input must use manualConfirm instead of fill.',
      );
    }
  });

  if (task.defaultConcurrency !== undefined && task.defaultConcurrency < 1) {
    push(issues, 'defaultConcurrency', 'Concurrency must be at least 1.');
  }
  if (task.defaultTimeoutMs !== undefined && task.defaultTimeoutMs < 100) {
    push(issues, 'defaultTimeoutMs', 'Default timeout must be at least 100ms.');
  }

  return {
    valid: !issues.some(issue => issue.severity === 'error'),
    issues,
  };
};

export const assertValidRpaTask = (task: Partial<RpaTask>) => {
  const result = validateRpaTask(task);
  if (!result.valid) {
    throw new Error(result.issues.map(issue => `${issue.path}: ${issue.message}`).join('; '));
  }
  return result;
};
