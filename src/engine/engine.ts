import {
  createLogger,
  UserManager,
  shutdownCore,
} from '@just-in/core';
import {
  EventHandlerManager, IntervalTimerEventGenerator,
  publishEvent as _publishEvent,
  processEventQueue,
  startEventQueueProcessing,
  stopEventQueueProcessing,
} from '../event';
import type { IntervalTimerEventGeneratorOptions } from '../event';
import {
  registerTask as _registerTask,
  registerDecisionRule as _registerDecisionRule,
  _clearRegisteredTasks,
  _clearRegisteredDecisionRules,
  __resetResultRecorderForTests,
  setDecisionRuleResultRecorder,
  setTaskResultRecorder,
} from '../handlers';
import type { TaskRegistration, DecisionRuleRegistration, RecordResultFunction } from '../handlers';

const Log = createLogger({
  context: { package: '@just-in/engine', component: 'engine' },
});

let _isInitialized = false;
const _intervalTimers = new Map<string, IntervalTimerEventGenerator>();

/**
 * Internal reference object for core functions that need to be stubbable
 * in unit tests. Plain objects have writable properties — unlike ES module
 * namespace imports which produce getter-only properties that sinon cannot
 * replace. Stays private to this module.
 *
 * Once @just-in/core is linked via `yarn link` and the ES module issue no
 * longer applies in the test environment, this can be replaced with direct
 * calls.
 *
 * @internal
 */
const _core = { UserManager, shutdownCore };

/**
 * The DB-backed JustIn engine.
 *
 * Manages the full JITAI lifecycle for long-running server processes:
 * event queue, change stream listener, interval timers, and handler
 * registration. Users are managed via `UserManager` from `@just-in/core`
 * — the engine does not expose user CRUD directly.
 *
 * ## Prerequisites
 *
 * `configureDB` from `@just-in/core` must be called before `init()`.
 * `UserManager.init()` is called internally by `init()`.
 *
 * ## Startup sequence
 *
 * ```ts
 * import { configureDB, DBType, UserManager } from '@just-in/core';
 * import { JustIn } from '@just-in/engine';
 *
 * configureDB({ dbType: DBType.MONGO, uri: process.env.MONGO_URI });
 *
 * JustIn.registerTask(FitbitUpdaterTask);
 * JustIn.registerDecisionRule(WalkingSuggestionDecisionRule);
 * await JustIn.registerEventHandlers('CLOCK_EVENT', [
 *   FitbitUpdaterTask.name,
 *   WalkingSuggestionDecisionRule.name,
 * ]);
 *
 * await JustIn.init();
 * await JustIn.startEngine();
 * ```
 *
 * ## Shutdown
 *
 * ```ts
 * process.on('SIGTERM', async () => {
 *   await JustIn.shutdown();
 *   process.exit(0);
 * });
 * ```
 */
const JustIn = {

  /**
   * Initialises the engine.
   *
   * Calls `UserManager.init()` which initialises DataManager using the config
   * stored by `configureDB()`, ensures collections exist, populates caches,
   * and wires change listeners.
   *
   * Idempotent — subsequent calls are no-ops with a warning.
   *
   * @throws If `configureDB()` was not called before this method.
   */
  async init(): Promise<void> {
    if (_isInitialized) {
      Log.warn('JustInEngine is already initialized.');
      return;
    }
    await _core.UserManager.init();
    _isInitialized = true;
    Log.info('JustInEngine initialized.');
  },

  /**
   * Gracefully shuts down the engine.
   *
   * Stops the event queue, clears interval timers and event handlers, then
   * delegates to `shutdownCore()` which tears down all registered managers,
   * change listeners, and the DataManager connection in the correct order.
   *
   * Safe to call when not initialized — logs a warning and returns.
   */
  async shutdown(): Promise<void> {
    if (!_isInitialized) {
      Log.warn('JustInEngine is not initialized; skipping shutdown.');
      return;
    }
    try {
      await JustIn.stopEngine();
      _intervalTimers.clear();
      EventHandlerManager.getInstance().clearEventHandlers();
      _isInitialized = false;
      await _core.shutdownCore();
      Log.info('JustInEngine shut down.');
    } catch (error) {
      Log.error('Error during JustInEngine shutdown.', { error });
      throw error;
    }
  },

  /**
   * Starts event queue processing and all registered interval timers.
   *
   * Wires the change stream listener on `event_queue` and drains any
   * pending events. Also starts any interval timers registered via
   * {@link createIntervalTimerEventGenerator}.
   *
   * Call after `init()`.
   */
  async startEngine(): Promise<void> {
    Log.debug('Starting engine...');
    await startEventQueueProcessing();
    _intervalTimers.forEach((timer, eventTypeName) => {
      Log.info('Starting interval timer.', { eventTypeName });
      timer.start();
    });
    await processEventQueue();
    Log.info('Engine started.', { startedAt: new Date().toISOString() });
  },

  /**
   * Stops event queue processing and all interval timers.
   *
   * Can be called without shutting down the application.
   */
  async stopEngine(): Promise<void> {
    _intervalTimers.forEach((timer, eventTypeName) => {
      Log.info('Stopping interval timer.', { eventTypeName });
      timer.stop();
    });
    stopEventQueueProcessing();
    Log.info('Engine stopped.');
  },

  /**
   * Registers a Task with the engine.
   *
   * @param task - The task definition. See {@link TaskRegistration}.
   */
  registerTask(task: TaskRegistration): void {
    _registerTask(task);
  },

  /**
   * Registers a Decision Rule with the engine.
   *
   * @param decisionRule - The decision rule definition. See {@link DecisionRuleRegistration}.
   */
  registerDecisionRule(decisionRule: DecisionRuleRegistration): void {
    _registerDecisionRule(decisionRule);
  },

  /**
   * Registers an ordered array of handler names for an event type.
   *
   * The order of `handlers` is the execution order. Tasks that write data
   * onto `user.attributes` must appear before Decision Rules that read it.
   *
   * @param eventType        - The event type name.
   * @param handlers         - Ordered handler names.
   * @param overwriteExisting - Replace an existing registration. Defaults to `false`.
   * @throws If `eventType` is already registered and `overwriteExisting` is `false`.
   */
  async registerEventHandlers(
    eventType: string,
    handlers: string[],
    overwriteExisting: boolean = false,
  ): Promise<void> {
    await EventHandlerManager.getInstance().registerEventHandlers(
      eventType,
      handlers,
      overwriteExisting,
    );
  },

  /**
   * Removes the handler registration for an event type.
   *
   * @param eventType - The event type to unregister.
   */
  unregisterEventHandlers(eventType: string): void {
    EventHandlerManager.getInstance().unregisterEventHandlers(eventType);
  },

  /**
   * Publishes an event by inserting it into the `event_queue` collection.
   *
   * @param eventType          - The registered event type name.
   * @param generatedTimestamp - The logical event timestamp.
   * @param eventDetails       - Optional payload forwarded to handlers.
   * @throws If DataManager returns a failure or throws.
   */
  async publishEvent(
    eventType: string,
    generatedTimestamp: Date,
    eventDetails?: Record<string, unknown>,
  ): Promise<void> {
    await _publishEvent(eventType, generatedTimestamp, eventDetails);
  },

  /**
   * Creates and registers an interval timer that publishes events on a fixed
   * schedule. Not started until `startEngine()` is called.
   *
   * @param eventTypeName - The event type to publish on each tick.
   * @param intervalInMs  - The interval between ticks in milliseconds.
   * @param options       - Optional simulated mode configuration.
   */
  createIntervalTimerEventGenerator(
    eventTypeName: string,
    intervalInMs: number,
    options: IntervalTimerEventGeneratorOptions = {},
  ): void {
    _intervalTimers.set(
      eventTypeName,
      new IntervalTimerEventGenerator(intervalInMs, eventTypeName, options),
    );
  },

  /**
   * Registers a custom writer for Task results.
   *
   * **Replaces** the default DataManager persistence path — DataManager is
   * never called when a writer is set. Use this to route task execution
   * records to your own analytics pipeline, database, or logging service.
   *
   * @param writer - The result writer function. See {@link RecordResultFunction}.
   */
  configureTaskResultWriter(writer: RecordResultFunction): void {
    setTaskResultRecorder(writer);
  },

  /**
   * Registers a custom writer for Decision Rule results.
   *
   * **Replaces** the default DataManager persistence path. A single decision
   * rule writer also handles Task results when no task writer is configured.
   *
   * @param writer - The result writer function. See {@link RecordResultFunction}.
   */
  configureDecisionRuleResultWriter(writer: RecordResultFunction): void {
    setDecisionRuleResultRecorder(writer);
  },
};

function _resetEngine(): void {
  _isInitialized = false;
  _intervalTimers.clear();
  EventHandlerManager.getInstance().clearEventHandlers();
  _clearRegisteredTasks();
  _clearRegisteredDecisionRules();
  __resetResultRecorderForTests();
}

function _getIntervalTimers(): Map<string, IntervalTimerEventGenerator> {
  return _intervalTimers;
}

export { JustIn, _resetEngine, _getIntervalTimers, _core as _coreForTesting };
