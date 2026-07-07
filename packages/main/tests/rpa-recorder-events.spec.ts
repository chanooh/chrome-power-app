import {describe, expect, test} from 'vitest';
import type {RpaRecorderEvent, RpaTaskStep} from '../../shared/types/rpa';
import {appendRpaRecorderEvent} from '../src/rpa/recorder-events';

const toStep = (event: RpaRecorderEvent): RpaTaskStep => ({
  id: `${event.type}-${event.timestamp}`,
  type: event.type === 'navigation' ? 'goto' : 'click',
  url: event.url,
  expectedUrl: event.expectedUrl,
});

const event = (patch: Partial<RpaRecorderEvent>): RpaRecorderEvent => ({
  sessionId: 'session',
  windowId: 1,
  type: 'click',
  timestamp: 1000,
  ...patch,
});

describe('rpa recorder event merge', () => {
  test('merges click navigation into expectedUrl', () => {
    const events: RpaRecorderEvent[] = [];
    appendRpaRecorderEvent(events, event({type: 'click', url: 'https://www.google.com/search?q=reddit'}), toStep);
    const result = appendRpaRecorderEvent(
      events,
      event({type: 'navigation', timestamp: 1400, url: 'https://www.reddit.com/'}),
      toStep,
    );

    expect(result.action).toBe('merged');
    expect(events).toHaveLength(1);
    expect(events[0].expectedUrl).toBe('https://www.reddit.com/');
    expect(events[0].step?.expectedUrl).toBe('https://www.reddit.com/');
  });

  test('skips short duplicate navigation events', () => {
    const events: RpaRecorderEvent[] = [];
    appendRpaRecorderEvent(events, event({type: 'navigation', url: 'https://www.reddit.com/'}), toStep);
    const result = appendRpaRecorderEvent(
      events,
      event({type: 'navigation', timestamp: 1200, url: 'https://www.reddit.com/'}),
      toStep,
    );

    expect(result.action).toBe('skipped');
    expect(events).toHaveLength(1);
  });
});
