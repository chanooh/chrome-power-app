import {describe, expect, test} from 'vitest';
import type {RpaTask} from '../../shared/types/rpa';
import {validateRpaTask} from '../src/rpa/validation';

const baseTask = (steps: RpaTask['flow']['steps']): RpaTask => ({
  name: 'Test RPA',
  flow: {schemaVersion: 1, steps},
  defaultConcurrency: 1,
  defaultTimeoutMs: 30000,
  defaultRetry: 0,
  screenshotPolicy: 'on-failure',
  closePolicy: 'keepOpen',
  sessionMode: 'taskUrlOnly',
});

describe('rpa validation', () => {
  test('accepts a valid structured task', () => {
    const result = validateRpaTask(
      baseTask([
        {id: 'goto', type: 'goto', url: 'https://example.com'},
        {id: 'click', type: 'click', selector: '[data-testid="submit"]'},
      ]),
    );

    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  test('rejects selector steps without selectors', () => {
    const result = validateRpaTask(baseTask([{id: 'click', type: 'click'}]));

    expect(result.valid).toBe(false);
    expect(result.issues.map(issue => issue.path)).toContain('flow.steps[0].selector');
  });

  test('rejects sensitive fill steps', () => {
    const result = validateRpaTask(
      baseTask([
        {
          id: 'seed',
          type: 'fill',
          selector: 'input[name="mnemonic"]',
          value: 'not-saved',
        },
      ]),
    );

    expect(result.valid).toBe(false);
    expect(result.issues.some(issue => issue.message.includes('manualConfirm'))).toBe(true);
  });

  test('allows assertText without a selector to check the whole page', () => {
    const result = validateRpaTask(baseTask([{id: 'assert-page', type: 'assertText', expected: 'Welcome'}]));

    expect(result.valid).toBe(true);
  });

  test('rejects duplicate step ids and invalid variable references', () => {
    const result = validateRpaTask(
      baseTask([
        {id: 'same', type: 'goto', url: 'https://example.com'},
        {id: 'same', type: 'fill', selector: '#email', valueFrom: 'bad ref!'},
      ]),
    );

    expect(result.valid).toBe(false);
    expect(result.issues.some(issue => issue.message.includes('Duplicate'))).toBe(true);
    expect(result.issues.some(issue => issue.path.endsWith('.valueFrom'))).toBe(true);
  });

  test('rejects unsupported session modes', () => {
    const result = validateRpaTask({
      ...baseTask([{id: 'goto', type: 'goto', url: 'https://example.com'}]),
      sessionMode: 'bad-mode' as never,
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some(issue => issue.path === 'sessionMode')).toBe(true);
  });
});
