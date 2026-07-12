import {BrowserWindow} from 'electron';
import type {DB} from '../../../shared/types/db';
import type {
  RpaClosePolicy,
  RpaRunOptions,
  RpaTask,
  RpaTaskProfileBinding,
  RpaTaskStep,
} from '../../../shared/types/rpa';
import {WindowDB} from '../db/window';
import {RpaDB} from '../db/rpa';
import {closeFingerprintWindow, openFingerprintWindow} from '../fingerprint';
import {connectRpaBrowser} from './automation';
import {getRpaArtifactRoot, getRpaProfileArtifactDir, getRpaRunRoot} from './artifacts';
import {executeRpaFlow, type RpaStepExecutionRecord} from './executor';
import {DEFAULT_RPA_RUN_SESSION_MODE, getFirstGotoUrl, prepareRpaSession} from './session';
import {mergeVariables} from './variables';
import {createLogger} from '../../../shared/utils/logger';
import {SERVICE_LOGGER_LABEL} from '../constants';
import {profileLeaseRegistry} from '../automation/profile-lease';

const logger = createLogger(SERVICE_LOGGER_LABEL);

interface RunControl {
  runId: number;
  paused: boolean;
  stopRequested: boolean;
  waiters: Array<() => void>;
}

const now = () => new Date().toISOString();

const emit = (channel: string, payload: unknown) => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload);
  }
};

const createControl = (runId: number): RunControl => ({
  runId,
  paused: false,
  stopRequested: false,
  waiters: [],
});

export class RpaScheduler {
  private controls = new Map<number, RunControl>();

  async startRun(taskId: number, options: RpaRunOptions = {}) {
    const task = await RpaDB.getTaskForRun(taskId);
    if (!task) {
      throw new Error(`RPA task ${taskId} not found.`);
    }
    const bindings = this.resolveBindings(task, options);
    if (!bindings.length) {
      throw new Error('RPA task has no selected profiles.');
    }
    const locked = bindings.filter(binding => profileLeaseRegistry.get(binding.window_id));
    if (locked.length) {
      throw new Error(`Profiles are already occupied: ${locked.map(b => b.window_id).join(', ')}`);
    }

    const runId = await RpaDB.createRun(taskId, bindings.length, getRpaArtifactRoot(), options);
    profileLeaseRegistry.acquire(
      bindings.map(binding => binding.window_id),
      'rpa',
      `rpa:${runId}`,
    );
    const artifactRoot = getRpaRunRoot(runId);
    await RpaDB.updateRun(runId, {artifact_root: artifactRoot});
    const control = createControl(runId);
    this.controls.set(runId, control);
    emit('rpa-run-updated', await RpaDB.getRun(runId));
    void this.executeRun(runId, task, bindings, options, control);
    return RpaDB.getRun(runId);
  }

  async pauseRun(runId: number) {
    const control = this.controls.get(runId);
    if (control) control.paused = true;
    await RpaDB.updateRun(runId, {status: 'paused', message: 'Paused by user.'});
    emit('rpa-run-updated', await RpaDB.getRun(runId));
    return RpaDB.getRun(runId);
  }

  async resumeRun(runId: number) {
    const control = this.controls.get(runId);
    if (control) {
      control.paused = false;
      control.waiters.splice(0).forEach(resolve => resolve());
    }
    await RpaDB.updateRun(runId, {status: 'running', message: 'Running.'});
    emit('rpa-run-updated', await RpaDB.getRun(runId));
    return RpaDB.getRun(runId);
  }

  async stopRun(runId: number) {
    const control = this.controls.get(runId);
    if (control) {
      control.stopRequested = true;
      control.paused = false;
      control.waiters.splice(0).forEach(resolve => resolve());
    }
    await RpaDB.updateRun(runId, {status: 'stopping', message: 'Stopping by user.'});
    emit('rpa-run-updated', await RpaDB.getRun(runId));
    return RpaDB.getRun(runId);
  }

  private resolveBindings(task: RpaTask, options: RpaRunOptions) {
    const bindings = task.profileBindings || [];
    if (!options.windowIds?.length) return bindings;
    const existingByWindow = new Map(bindings.map(binding => [binding.window_id, binding]));
    return options.windowIds.map(
      windowId => existingByWindow.get(windowId) || {window_id: windowId},
    );
  }

  private async executeRun(
    runId: number,
    task: RpaTask,
    bindings: RpaTaskProfileBinding[],
    options: RpaRunOptions,
    control: RunControl,
  ) {
    await RpaDB.updateRun(runId, {status: 'running', started_at: now(), message: 'Running.'});
    const queue = [...bindings];
    const concurrency = Math.max(
      1,
      Math.min(options.concurrency || task.defaultConcurrency || 1, bindings.length),
    );

    const workers = Array.from({length: concurrency}).map(async () => {
      while (queue.length && !control.stopRequested) {
        const binding = queue.shift();
        if (binding) await this.executeProfile(runId, task, binding, options, control);
      }
    });

    try {
      await Promise.all(workers);
      const counts = await RpaDB.countRunProfiles(runId);
      const finalStatus = control.stopRequested
        ? 'canceled'
        : counts.failed > 0
          ? 'failed'
          : 'succeeded';
      await RpaDB.updateRun(runId, {
        status: finalStatus,
        succeeded_profiles: counts.succeeded,
        failed_profiles: counts.failed,
        finished_at: now(),
        message: finalStatus === 'succeeded' ? 'Run completed.' : 'Run finished with failures.',
      });
    } catch (error) {
      logger.error('RPA run failed', error);
      await RpaDB.updateRun(runId, {
        status: 'failed',
        finished_at: now(),
        message: (error as Error).message,
      });
    } finally {
      profileLeaseRegistry.release(`rpa:${runId}`);
      this.controls.delete(runId);
      emit('rpa-run-updated', await RpaDB.getRun(runId));
    }
  }

  private async waitIfPaused(control: RunControl) {
    while (control.paused && !control.stopRequested) {
      await new Promise<void>(resolve => control.waiters.push(resolve));
    }
  }

  private async executeProfile(
    runId: number,
    task: RpaTask,
    binding: RpaTaskProfileBinding,
    options: RpaRunOptions,
    control: RunControl,
  ) {
    const windowData = await WindowDB.getById(binding.window_id);
    if (!windowData) {
      throw new Error(`Window ${binding.window_id} not found.`);
    }
    const profileId = windowData.profile_id || String(binding.window_id);
    const artifactDir = getRpaProfileArtifactDir(runId, profileId);
    const runProfileId = await RpaDB.createRunProfile({
      run_id: runId,
      task_id: task.id!,
      window_id: binding.window_id,
      profile_id: profileId,
      artifact_dir: artifactDir,
    });
    await RpaDB.updateRunProfile(runProfileId, {status: 'running', started_at: now()});
    emit('rpa-run-updated', await RpaDB.getRun(runId));

    let connected: Awaited<ReturnType<typeof connectRpaBrowser>> | undefined;
    let success = false;
    try {
      await this.waitIfPaused(control);
      if (control.stopRequested) throw new Error('Run stopped before profile execution.');
      const openResult = await openFingerprintWindow(binding.window_id);
      const browserWSEndpoint = openResult?.webSocketDebuggerUrl;
      if (!browserWSEndpoint) {
        throw new Error(
          `Profile ${binding.window_id} failed to start or did not expose a CDP endpoint. Check the launch warning shown before this RPA error.`,
        );
      }
      const variables = mergeVariables(
        task.variables,
        task.sensitiveVariables,
        binding.variables,
        binding.sensitiveVariables,
        options.variables,
        {
          'profile.id': profileId,
          'window.id': String(binding.window_id),
        },
      );
      connected = await connectRpaBrowser(browserWSEndpoint);
      const requestedSessionMode =
        options.sessionMode || task.sessionMode || DEFAULT_RPA_RUN_SESSION_MODE;
      const prepared = await prepareRpaSession({
        context: connected.context,
        fallbackPage: connected.page,
        sessionMode: requestedSessionMode,
        taskUrl: getFirstGotoUrl(task.flow, variables),
      });
      connected.page = prepared.page;
      await RpaDB.updateRun(runId, {
        message: `Session ${prepared.result.sessionMode}: closed ${prepared.result.closedPageCount} page(s), kept ${prepared.result.keptExtensionPageCount} extension page(s).${prepared.result.warningMessages.length ? ` ${prepared.result.warningMessages.join(' ')}` : ''}`,
      });
      emit('rpa-run-updated', await RpaDB.getRun(runId));
      const stepRowIds = new Map<string, number>();
      const stepKey = (step: RpaTaskStep, stepIndex: number, attempt: number) =>
        `${step.id}:${stepIndex}:${attempt}`;
      await executeRpaFlow({
        task,
        window: windowData,
        context: connected.context,
        page: connected.page,
        artifactDir,
        variables,
        screenshotPolicy: task.screenshotPolicy,
        hooks: {
          beforeStep: async (step, stepIndex, attempt) => {
            const stepRowId = await RpaDB.createRunStep({
              run_id: runId,
              run_profile_id: runProfileId,
              task_id: task.id!,
              window_id: binding.window_id,
              step_id: step.id,
              step_index: stepIndex,
              step_type: step.type,
              attempt,
            });
            await RpaDB.updateRunProfile(runProfileId, {current_step_index: stepIndex});
            await RpaDB.updateRunStep(stepRowId, {status: 'running', started_at: now()});
            stepRowIds.set(stepKey(step, stepIndex, attempt), stepRowId);
            emit('rpa-step-updated', await RpaDB.getRun(runId));
          },
          afterStep: async record => {
            await this.persistStepRecord(
              record,
              stepRowIds.get(stepKey(record.step, record.stepIndex, record.attempt)),
              runId,
              runProfileId,
              binding.window_id,
            );
            emit('rpa-step-updated', await RpaDB.getRun(runId));
          },
          waitIfPaused: () => this.waitIfPaused(control),
          shouldStop: () => control.stopRequested,
          requestManualConfirm: async step => {
            control.paused = true;
            await RpaDB.updateRun(runId, {
              status: 'paused',
              message: step.text || step.note || 'Manual confirmation required.',
            });
            emit('rpa-run-updated', await RpaDB.getRun(runId));
            await this.waitIfPaused(control);
          },
        },
      });
      success = true;
      await RpaDB.updateRunProfile(runProfileId, {
        status: control.stopRequested ? 'canceled' : 'succeeded',
        finished_at: now(),
      });
    } catch (error) {
      await RpaDB.updateRunProfile(runProfileId, {
        status: control.stopRequested ? 'canceled' : 'failed',
        error: (error as Error).message,
        finished_at: now(),
      });
    } finally {
      profileLeaseRegistry.releaseWindow(binding.window_id, `rpa:${runId}`);
      if (connected) await connected.disconnect().catch(() => undefined);
      const closePolicy = options.closePolicy || task.closePolicy || 'keepOpen';
      if (this.shouldCloseProfile(closePolicy, success)) {
        await closeFingerprintWindow(binding.window_id, true).catch(error =>
          logger.warn('Failed to close RPA profile', error),
        );
      }
      const counts = await RpaDB.countRunProfiles(runId);
      await RpaDB.updateRun(runId, {
        succeeded_profiles: counts.succeeded,
        failed_profiles: counts.failed,
      });
      emit('rpa-run-updated', await RpaDB.getRun(runId));
    }
  }

  private shouldCloseProfile(closePolicy: RpaClosePolicy, success: boolean) {
    return closePolicy === 'closeAlways' || (closePolicy === 'closeOnSuccess' && success);
  }

  private async persistStepRecord(
    record: RpaStepExecutionRecord,
    stepRowId: number | undefined,
    runId: number,
    runProfileId: number,
    windowId: number,
  ) {
    if (!stepRowId) return;
    await RpaDB.updateRunStep(stepRowId, {
      status: record.status,
      duration_ms: record.finishedAt - record.startedAt,
      message: record.message,
      error: record.error,
      artifact_path: record.artifactPath,
      output_json: record.output ? JSON.stringify(record.output) : null,
      finished_at: now(),
      run_id: runId,
      run_profile_id: runProfileId,
      window_id: windowId,
    } as Partial<DB.RpaRunStep>);
  }
}

export const rpaScheduler = new RpaScheduler();
