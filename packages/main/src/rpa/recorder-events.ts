import type {RpaRecorderEvent, RpaTaskStep} from '../../../shared/types/rpa';

export type RpaRecorderEventMergeAction = 'appended' | 'merged' | 'skipped';

export interface RpaRecorderEventMergeResult {
  action: RpaRecorderEventMergeAction;
  event?: RpaRecorderEvent;
}

const shouldRecordNavigation = (url?: string) => !!url && url !== 'about:blank';

const isActionEvent = (event: RpaRecorderEvent) => ['click', 'fill', 'select'].includes(event.type);

export const appendRpaRecorderEvent = (
  events: RpaRecorderEvent[],
  event: RpaRecorderEvent,
  toStep: (event: RpaRecorderEvent) => RpaTaskStep,
): RpaRecorderEventMergeResult => {
  if (event.type === 'navigation') {
    if (!shouldRecordNavigation(event.url)) {
      return {action: 'skipped'};
    }
    const last = events[events.length - 1];
    if (last?.type === 'navigation' && last.url === event.url && event.timestamp - last.timestamp < 2000) {
      return {action: 'skipped'};
    }
    if (
      last &&
      isActionEvent(last) &&
      event.url &&
      event.url !== last.url &&
      event.timestamp - last.timestamp < 8000
    ) {
      last.expectedUrl = event.url;
      last.step = toStep(last);
      return {action: 'merged', event: last};
    }
  }

  event.step = toStep(event);
  events.push(event);
  return {action: 'appended', event};
};
