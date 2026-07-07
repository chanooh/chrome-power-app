import type {DB} from './db';

export type RpaStepType =
  | 'goto'
  | 'waitForSelector'
  | 'click'
  | 'fill'
  | 'press'
  | 'select'
  | 'check'
  | 'uncheck'
  | 'hover'
  | 'scroll'
  | 'waitForLoadState'
  | 'waitForTimeout'
  | 'waitForURL'
  | 'screenshot'
  | 'extractText'
  | 'extractAttribute'
  | 'assertText'
  | 'switchPage'
  | 'switchFrame'
  | 'manualConfirm';

export type RpaRunStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'stopping'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  | 'interrupted';

export type RpaStepStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'canceled';

export type RpaScreenshotPolicy = 'never' | 'on-failure' | 'every-step';
export type RpaClosePolicy = 'keepOpen' | 'closeOnSuccess' | 'closeAlways';
export type RpaSessionMode = 'keepExisting' | 'cleanPages' | 'taskUrlOnly';
export type RpaLocatorQuality = 'high' | 'medium' | 'low';
export type RpaLocatorType =
  | 'testId'
  | 'role'
  | 'label'
  | 'placeholder'
  | 'id'
  | 'name'
  | 'href'
  | 'text'
  | 'css'
  | 'xpath'
  | 'bounds';

export interface RpaElementBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RpaLocatorCandidate {
  type: RpaLocatorType;
  value: string;
  role?: string;
  name?: string;
  text?: string;
  exact?: boolean;
  score?: number;
}

export interface RpaElementSnapshot {
  tag: string;
  role?: string;
  text?: string;
  ariaLabel?: string;
  href?: string;
  id?: string;
  name?: string;
  inputType?: string;
  placeholder?: string;
  recordedUrl?: string;
  bounds?: RpaElementBounds;
  quality?: RpaLocatorQuality;
}

export interface RpaStepTarget {
  page?: 'current' | 'first' | 'last' | 'popup' | string;
  frame?: 'main' | string;
  urlIncludes?: string;
  titleIncludes?: string;
}

export interface RpaTaskStep {
  id: string;
  type: RpaStepType;
  name?: string;
  url?: string;
  selector?: string;
  selectors?: string[];
  locators?: RpaLocatorCandidate[];
  element?: RpaElementSnapshot;
  quality?: RpaLocatorQuality;
  value?: string;
  valueFrom?: string;
  key?: string;
  text?: string;
  attribute?: string;
  expected?: string;
  timeoutMs?: number;
  retry?: number;
  continueOnError?: boolean;
  screenshot?: boolean;
  target?: RpaStepTarget;
  outputKey?: string;
  note?: string;
  x?: number;
  y?: number;
  behavior?: 'auto' | 'smooth';
  loadState?: 'load' | 'domcontentloaded' | 'networkidle';
  expectedUrl?: string;
  waitAfterClick?: 'none' | 'domcontentloaded' | 'load' | 'networkidle';
}

export interface RpaTaskFlow {
  schemaVersion: 1;
  steps: RpaTaskStep[];
}

export interface RpaTask {
  id?: number;
  name: string;
  description?: string | null;
  flow: RpaTaskFlow;
  profileBindings?: RpaTaskProfileBinding[];
  defaultConcurrency: number;
  defaultTimeoutMs: number;
  defaultRetry: number;
  screenshotPolicy: RpaScreenshotPolicy;
  closePolicy: RpaClosePolicy;
  sessionMode: RpaSessionMode;
  variables?: Record<string, string>;
  sensitiveVariables?: Record<string, string>;
  status?: number;
  created_at?: string;
  updated_at?: string;
}

export interface RpaTaskProfileBinding {
  id?: number;
  task_id?: number;
  window_id: number;
  window?: Partial<DB.Window>;
  variables?: Record<string, string>;
  sensitiveVariables?: Record<string, string>;
  created_at?: string;
}

export interface RpaRunOptions {
  windowIds?: number[];
  concurrency?: number;
  closePolicy?: RpaClosePolicy;
  sessionMode?: RpaSessionMode;
  variables?: Record<string, string>;
}

export interface RpaRecorderOptions {
  sessionMode?: RpaSessionMode;
}

export interface RpaSessionPrepareResult {
  sessionMode: RpaSessionMode;
  requestedSessionMode: RpaSessionMode;
  closedPageCount: number;
  keptExtensionPageCount: number;
  warningMessages: string[];
  openedUrl?: string;
}

export interface RpaRun {
  id?: number;
  task_id: number;
  task?: Partial<RpaTask>;
  status: RpaRunStatus;
  total_profiles: number;
  succeeded_profiles: number;
  failed_profiles: number;
  artifact_root?: string | null;
  options?: RpaRunOptions;
  message?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  created_at?: string;
  updated_at?: string | null;
  profiles?: RpaRunProfile[];
  steps?: RpaRunStep[];
}

export interface RpaRunProfile {
  id?: number;
  run_id: number;
  task_id: number;
  window_id: number;
  profile_id?: string | null;
  status: RpaRunStatus;
  current_step_index: number;
  artifact_dir?: string | null;
  error?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  created_at?: string;
  updated_at?: string | null;
  window?: Partial<DB.Window>;
}

export interface RpaRunStep {
  id?: number;
  run_id: number;
  run_profile_id: number;
  task_id: number;
  window_id: number;
  step_id: string;
  step_index: number;
  step_type: RpaStepType;
  status: RpaStepStatus;
  attempt: number;
  duration_ms?: number;
  message?: string | null;
  error?: string | null;
  artifact_path?: string | null;
  output?: Record<string, unknown>;
  started_at?: string | null;
  finished_at?: string | null;
  created_at?: string;
  updated_at?: string | null;
}

export interface RpaArtifact {
  runId: number;
  runProfileId: number;
  windowId: number;
  profileId?: string;
  kind: 'screenshot' | 'trace' | 'output' | 'log';
  path: string;
  stepId?: string;
  createdAt: string;
}

export interface RpaRecorderEvent {
  sessionId: string;
  windowId: number;
  type: 'navigation' | 'click' | 'fill' | 'select' | 'press';
  url?: string;
  selector?: string;
  selectors?: string[];
  locators?: RpaLocatorCandidate[];
  element?: RpaElementSnapshot;
  quality?: RpaLocatorQuality;
  expectedUrl?: string;
  value?: string;
  key?: string;
  text?: string;
  timestamp: number;
  step?: RpaTaskStep;
}

export interface RpaRecorderSession {
  sessionId: string;
  windowId: number;
  startedAt: string;
  events: RpaRecorderEvent[];
}

export interface RpaValidationIssue {
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface RpaValidationResult {
  valid: boolean;
  issues: RpaValidationIssue[];
}

export interface RpaOperationResult<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
}
