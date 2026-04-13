import { DataManager, createLogger } from '@just-in/core';
import type { RecordResult, RecordResultFunction } from './types';
import { DECISION_RULE_RESULTS, TASK_RESULTS } from '../constants';

const Log = createLogger({
  context: { package: '@just-in/engine', component: 'result-recorder' },
});

let _recordDecisionRuleResultFn: RecordResultFunction | null = null;
let _recordTaskResultFn: RecordResultFunction | null = null;
let _persistenceEnabled = true;

/**
 * Enables or disables DataManager persistence for result recording.
 *
 * Set to `false` in {@link JustInServerless} — the serverless engine never
 * touches DataManager. When disabled and no custom writer is configured, the
 * recorder logs the full result record at INFO so it is captured by the cloud
 * function's stdout stream (e.g. Cloud Run / GCP Logging). This is the
 * expected path for serverless deployments that have not configured a custom
 * writer — the log output is the audit trail.
 *
 * Custom writers registered via {@link setDecisionRuleResultRecorder} or
 * {@link setTaskResultRecorder} are always called regardless of this flag.
 *
 * Defaults to `true`.
 */
function setResultRecorderPersistenceEnabled(enabled: boolean): void {
  _persistenceEnabled = enabled;
}

/**
 * Registers a custom writer for Decision Rule results.
 *
 * When set, **completely replaces** the default persistence path — DataManager
 * is never called. This gives the DB-backed engine consumer full control over
 * where intervention results go: their own analytics pipeline, a different
 * database, a message queue, etc.
 *
 * If the writer throws, the recorder logs a warning and falls back to the
 * default path (DataManager for the DB-backed engine, INFO log for serverless)
 * so results are never silently lost.
 *
 * Called via `JustIn.configureDecisionRuleResultWriter(fn)` on the engine
 * facade — do not call this directly in application code.
 *
 * @param fn - The writer function. See {@link RecordResultFunction}.
 */
function setDecisionRuleResultRecorder(fn: RecordResultFunction): void {
  _recordDecisionRuleResultFn = fn;
}

/**
 * Registers a custom writer for Task results.
 *
 * When set, **completely replaces** the default persistence path — DataManager
 * is never called. Falls through to the decision rule writer if no task writer
 * is configured, so a single writer registered via
 * `configureDecisionRuleResultWriter` can handle results from both handler types.
 *
 * If the writer throws, the recorder logs a warning and falls back.
 *
 * Called via `JustIn.configureTaskResultWriter(fn)` on the engine facade —
 * do not call this directly in application code.
 *
 * @param fn - The writer function. See {@link RecordResultFunction}.
 */
function setTaskResultRecorder(fn: RecordResultFunction): void {
  _recordTaskResultFn = fn;
}

/**
 * The default persistence path when no custom writer is set.
 *
 * Two cases:
 *
 * **Persistence enabled (DB-backed engine):** attempts DataManager insert.
 * On failure logs at WARN then logs the full record at INFO so no data is
 * silently lost.
 *
 * **Persistence disabled (serverless engine):** skips DataManager entirely
 * and logs the full record at INFO. In a serverless context the cloud
 * function's stdout stream is the audit trail when no custom writer is
 * configured. The full record is intentional — a summary would lose the step
 * results needed for research analysis.
 *
 * Never throws.
 */
async function _persistOrLog(
  collection: string,
  record: RecordResult,
  kind: 'task' | 'decision',
): Promise<void> {
  if (_persistenceEnabled) {
    try {
      const result = await DataManager.getInstance().addItemToCollection(collection, record);
      if (result.ok) return;
      Log.warn('Result recorder: DataManager returned failure — result not persisted.', {
        collection,
        kind,
        failures: result.failures,
      });
    } catch (error) {
      Log.warn('Result recorder: DataManager threw — result not persisted.', {
        collection,
        kind,
        error,
      });
    }
  }

  Log.info('[result-recorder] Handler result.', {
    collection,
    kind,
    record,
  });
}

/**
 * Records the result of a Decision Rule execution for a single user.
 *
 * Resolution order:
 * 1. Custom decision rule writer if set — **replaces** DataManager entirely.
 *    Configure via `JustIn.configureDecisionRuleResultWriter(fn)`.
 * 2. DataManager persistence to `decision_rule_results` (DB-backed engine only).
 * 3. INFO log with the full record — serverless engine default, or DB-backed
 *    engine fallback when DataManager fails.
 *
 * Does nothing if `record.steps` is empty — a handler that did not activate
 * produces no steps and there is nothing to record.
 *
 * Never throws.
 */
async function handleDecisionRuleResult(record: RecordResult): Promise<void> {
  if (!hasResultRecord(record)) return;

  if (_recordDecisionRuleResultFn) {
    try {
      await _recordDecisionRuleResultFn(record);
      return;
    } catch (error) {
      Log.warn('Decision rule result writer failed; falling back to default.', {
        record,
        error,
      });
    }
  }

  await _persistOrLog(DECISION_RULE_RESULTS, record, 'decision');
}

/**
 * Records the result of a Task execution for a single user.
 *
 * Resolution order:
 * 1. Custom task writer if set — **replaces** DataManager entirely.
 *    Configure via `JustIn.configureTaskResultWriter(fn)`.
 * 2. Custom decision rule writer if set — tasks delegate to it when no task
 *    writer is configured, so a single writer can handle all handler results.
 * 3. DataManager persistence to `task_results` (DB-backed engine only).
 * 4. INFO log with the full record — serverless engine default, or DB-backed
 *    engine fallback when DataManager fails.
 *
 * Does nothing if `record.steps` is empty.
 *
 * Never throws.
 */
async function handleTaskResult(record: RecordResult): Promise<void> {
  if (!hasResultRecord(record)) return;

  if (_recordTaskResultFn) {
    try {
      await _recordTaskResultFn(record);
      return;
    } catch (error) {
      Log.warn('Task result writer failed; falling back to default.', {
        record,
        error,
      });
    }
  } else if (_recordDecisionRuleResultFn) {
    try {
      await _recordDecisionRuleResultFn(record);
      return;
    } catch (error) {
      Log.warn('Delegated decision rule writer failed; falling back to default.', {
        record,
        error,
      });
    }
  }

  await _persistOrLog(TASK_RESULTS, record, 'task');
}

/**
 * Returns `true` if `record` has at least one step entry.
 *
 * Used as a guard before recording — a handler that did not activate produces
 * an empty steps array and should not be persisted.
 */
function hasResultRecord(record: RecordResult): boolean {
  return record.steps.length > 0;
}

/**
 * Resets all module-level recorder state to defaults.
 *
 * @internal — exported for use in `@just-in/engine/testing` only.
 */
function __resetResultRecorderForTests(): void {
  _recordDecisionRuleResultFn = null;
  _recordTaskResultFn = null;
  _persistenceEnabled = true;
}

export {
  setResultRecorderPersistenceEnabled,
  setDecisionRuleResultRecorder,
  setTaskResultRecorder,
  handleDecisionRuleResult,
  handleTaskResult,
  hasResultRecord,
  __resetResultRecorderForTests,
};
