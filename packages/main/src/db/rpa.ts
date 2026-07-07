import {db} from '.';
import type {DB} from '../../../shared/types/db';
import type {
  RpaClosePolicy,
  RpaRun,
  RpaRunOptions,
  RpaRunProfile,
  RpaRunStep,
  RpaRunStatus,
  RpaTask,
  RpaTaskFlow,
  RpaTaskProfileBinding,
} from '../../../shared/types/rpa';
import {WindowDB} from './window';
import {assertValidRpaTask, parseRpaFlow} from '../rpa/validation';
import {
  decryptSensitiveVariables,
  encryptSensitiveVariables,
  maskSensitiveVariables,
} from '../rpa/variables';

const parseJson = <T>(value: unknown, fallback: T): T => {
  if (!value) return fallback;
  if (typeof value !== 'string') return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const stringifyJson = (value: unknown) => JSON.stringify(value || {});

const omitUndefined = <T extends Record<string, unknown>>(value: T) =>
  Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>;

const hydrateBinding = async (
  row: DB.RpaTaskProfile,
  includeSensitive = false,
): Promise<RpaTaskProfileBinding> => ({
  id: row.id,
  task_id: row.task_id,
  window_id: row.window_id,
  variables: parseJson(row.variables_json, {}),
  sensitiveVariables: includeSensitive
    ? decryptSensitiveVariables(row.sensitive_variables_encrypted)
    : maskSensitiveVariables(decryptSensitiveVariables(row.sensitive_variables_encrypted)),
  created_at: row.created_at,
  window: await WindowDB.getById(row.window_id),
});

const hydrateTask = async (
  row: DB.RpaTask,
  includeSensitive = false,
): Promise<RpaTask> => {
  const bindings = await db('rpa_task_profile').where({task_id: row.id});
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    flow: parseRpaFlow(row.flow_json),
    defaultConcurrency: row.default_concurrency || 1,
    defaultTimeoutMs: row.default_timeout_ms || 30000,
    defaultRetry: row.default_retry || 0,
    screenshotPolicy: row.screenshot_policy || 'on-failure',
    closePolicy: row.close_policy || 'keepOpen',
    variables: parseJson(row.variables_json, {}),
    sensitiveVariables: includeSensitive
      ? decryptSensitiveVariables(row.sensitive_variables_encrypted)
      : maskSensitiveVariables(decryptSensitiveVariables(row.sensitive_variables_encrypted)),
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at || undefined,
    profileBindings: await Promise.all(
      bindings.map((binding: DB.RpaTaskProfile) => hydrateBinding(binding, includeSensitive)),
    ),
  };
};

const taskToRow = (task: Partial<RpaTask>): Partial<DB.RpaTask> => {
  if (task.flow) {
    assertValidRpaTask({
      ...task,
      name: task.name || 'RPA Task',
      defaultConcurrency: task.defaultConcurrency || 1,
      defaultTimeoutMs: task.defaultTimeoutMs || 30000,
    });
  }
  return omitUndefined({
    name: task.name,
    description: task.description,
    flow_json: task.flow ? JSON.stringify(task.flow) : undefined,
    default_concurrency: task.defaultConcurrency,
    default_timeout_ms: task.defaultTimeoutMs,
    default_retry: task.defaultRetry,
    screenshot_policy: task.screenshotPolicy,
    close_policy: task.closePolicy,
    variables_json: task.variables ? stringifyJson(task.variables) : undefined,
    sensitive_variables_encrypted: task.sensitiveVariables
      ? encryptSensitiveVariables(task.sensitiveVariables)
      : undefined,
    status: task.status,
  });
};

const saveBindings = async (
  trx: typeof db,
  taskId: number,
  bindings: RpaTaskProfileBinding[] = [],
) => {
  await trx('rpa_task_profile').where({task_id: taskId}).delete();
  for (const binding of bindings) {
    await trx('rpa_task_profile').insert({
      task_id: taskId,
      window_id: binding.window_id,
      variables_json: stringifyJson(binding.variables),
      sensitive_variables_encrypted: encryptSensitiveVariables(binding.sensitiveVariables),
    });
  }
};

const listTasks = async () => {
  const rows = await db('rpa_task').where('status', '>', 0).orderBy('created_at', 'desc');
  return Promise.all(rows.map((row: DB.RpaTask) => hydrateTask(row, false)));
};

const getTask = async (id: number, includeSensitive = false) => {
  const row = await db('rpa_task').where({id}).first();
  if (!row || row.status === 0) return undefined;
  return hydrateTask(row, includeSensitive);
};

const createTask = async (task: RpaTask) => {
  assertValidRpaTask(task);
  const [id] = await db.transaction(async trx => {
    const [taskId] = await trx('rpa_task').insert({
      ...taskToRow({
        ...task,
        defaultConcurrency: task.defaultConcurrency || 1,
        defaultTimeoutMs: task.defaultTimeoutMs || 30000,
        defaultRetry: task.defaultRetry || 0,
        screenshotPolicy: task.screenshotPolicy || 'on-failure',
        closePolicy: task.closePolicy || 'keepOpen',
      }),
      status: 1,
    });
    await saveBindings(trx as typeof db, Number(taskId), task.profileBindings || []);
    return [Number(taskId)];
  });
  return getTask(Number(id));
};

const updateTask = async (id: number, patch: Partial<RpaTask>) => {
  const current = await getTask(id, true);
  if (!current) throw new Error(`RPA task ${id} not found.`);
  const next = {
    ...current,
    ...patch,
    flow: patch.flow || current.flow,
    profileBindings: patch.profileBindings ?? current.profileBindings,
  };
  assertValidRpaTask(next);
  await db.transaction(async trx => {
    await trx('rpa_task')
      .where({id})
      .update({
        ...taskToRow(patch),
        updated_at: trx.fn.now(),
      });
    if (patch.profileBindings) {
      await saveBindings(trx as typeof db, id, patch.profileBindings);
    }
  });
  return getTask(id);
};

const deleteTask = async (id: number) => {
  await db('rpa_task').where({id}).update({status: 0, updated_at: db.fn.now()});
  return {success: true, message: 'RPA task deleted.'};
};

const createRun = async (
  taskId: number,
  totalProfiles: number,
  artifactRoot: string,
  options: RpaRunOptions = {},
) => {
  const [id] = await db('rpa_run').insert({
    task_id: taskId,
    status: 'queued',
    total_profiles: totalProfiles,
    artifact_root: artifactRoot,
    options_json: stringifyJson(options),
  });
  return Number(id);
};

const createRunProfile = async (profile: Omit<RpaRunProfile, 'id' | 'status' | 'current_step_index'>) => {
  const [id] = await db('rpa_run_profile').insert({
    ...profile,
    status: 'queued',
    current_step_index: 0,
  });
  return Number(id);
};

const createRunStep = async (step: Omit<RpaRunStep, 'id' | 'status'>) => {
  const [id] = await db('rpa_run_step').insert({
    ...step,
    status: 'queued',
    output_json: step.output ? JSON.stringify(step.output) : null,
  });
  return Number(id);
};

const updateRun = async (id: number, patch: Partial<DB.RpaRun>) => {
  await db('rpa_run').where({id}).update({...patch, updated_at: db.fn.now()});
};

const updateRunProfile = async (id: number, patch: Partial<DB.RpaRunProfile>) => {
  await db('rpa_run_profile').where({id}).update({...patch, updated_at: db.fn.now()});
};

const updateRunStep = async (id: number, patch: Partial<DB.RpaRunStep>) => {
  await db('rpa_run_step')
    .where({id})
    .update({
      ...patch,
      output_json:
        patch.output_json && typeof patch.output_json !== 'string'
          ? JSON.stringify(patch.output_json)
          : patch.output_json,
      updated_at: db.fn.now(),
    });
};

const hydrateRunProfile = async (row: DB.RpaRunProfile): Promise<RpaRunProfile> => ({
  id: row.id,
  run_id: row.run_id,
  task_id: row.task_id,
  window_id: row.window_id,
  profile_id: row.profile_id,
  status: row.status,
  current_step_index: row.current_step_index || 0,
  artifact_dir: row.artifact_dir,
  error: row.error,
  started_at: row.started_at,
  finished_at: row.finished_at,
  created_at: row.created_at,
  updated_at: row.updated_at,
  window: await WindowDB.getById(row.window_id),
});

const hydrateRunStep = (row: DB.RpaRunStep): RpaRunStep => ({
  id: row.id,
  run_id: row.run_id,
  run_profile_id: row.run_profile_id,
  task_id: row.task_id,
  window_id: row.window_id,
  step_id: row.step_id,
  step_index: row.step_index,
  step_type: row.step_type,
  status: row.status,
  attempt: row.attempt || 0,
  duration_ms: row.duration_ms,
  message: row.message,
  error: row.error,
  artifact_path: row.artifact_path,
  output: parseJson(row.output_json, {}),
  started_at: row.started_at,
  finished_at: row.finished_at,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

const getRun = async (id: number): Promise<RpaRun | undefined> => {
  const row = (await db('rpa_run').where({id}).first()) as DB.RpaRun | undefined;
  if (!row) return undefined;
  const profiles = await db('rpa_run_profile').where({run_id: id}).orderBy('id', 'asc');
  const steps = await db('rpa_run_step').where({run_id: id}).orderBy(['run_profile_id', 'step_index']);
  return {
    id: row.id,
    task_id: row.task_id,
    status: row.status,
    total_profiles: row.total_profiles || 0,
    succeeded_profiles: row.succeeded_profiles || 0,
    failed_profiles: row.failed_profiles || 0,
    artifact_root: row.artifact_root,
    options: parseJson(row.options_json, {}),
    message: row.message,
    started_at: row.started_at,
    finished_at: row.finished_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    profiles: await Promise.all(profiles.map((profile: DB.RpaRunProfile) => hydrateRunProfile(profile))),
    steps: steps.map((step: DB.RpaRunStep) => hydrateRunStep(step)),
  };
};

const listRuns = async (taskId?: number) => {
  const query = db('rpa_run').orderBy('created_at', 'desc').limit(100);
  if (taskId) query.where({task_id: taskId});
  const rows = await query;
  const runs = await Promise.all(rows.map((row: DB.RpaRun) => getRun(row.id!)));
  return runs.filter(Boolean) as RpaRun[];
};

const countRunProfiles = async (runId: number) => {
  const rows = await db('rpa_run_profile')
    .select('status')
    .count<{status: RpaRunStatus; count: number}[]>({count: 'id'})
    .where({run_id: runId})
    .groupBy('status');
  const statusCounts = Object.fromEntries(rows.map(row => [row.status, Number(row.count)]));
  return {
    succeeded: statusCounts.succeeded || 0,
    failed: (statusCounts.failed || 0) + (statusCounts.canceled || 0) + (statusCounts.interrupted || 0),
  };
};

export const RpaDB = {
  listTasks,
  getTask,
  getTaskForRun: (id: number) => getTask(id, true),
  createTask,
  updateTask,
  deleteTask,
  createRun,
  createRunProfile,
  createRunStep,
  updateRun,
  updateRunProfile,
  updateRunStep,
  getRun,
  listRuns,
  countRunProfiles,
};
