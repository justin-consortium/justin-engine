import type { JUser } from '@just-in/core';
import type { JEvent } from '../event';


/**
 * The three possible outcomes of any handler step.
 *
 * - `'success'` — the step completed successfully. Execution continues to the
 *   next step. The `result` field carries any data the next step needs.
 *
 * - `'stop'` — the step determined that execution should not continue for this
 *   user. This is a **graceful, expected exit** — not an error. Use it when a
 *   user does not meet a condition (wrong phase, wrong time of day, feature
 *   paused). No result is recorded for a handler that stops at `shouldActivate`.
 *
 * - `'error'` — something went wrong during the step. Execution stops for this
 *   user. The `error` field should carry the thrown error or a descriptive
 *   message. The engine catches thrown errors and wraps them in an `'error'`
 *   result automatically, so you only need to return `'error'` explicitly when
 *   you want to signal a known failure condition without throwing.
 *
 * @example
 * ```ts
 * // shouldActivate — graceful stop when user is not in the right phase
 * const [isActive] = checkForPhase(user, 'active');
 * if (!isActive) return { status: 'stop', result: { reason: 'not in active phase' } };
 * return { status: 'success', result: { phase: 'active' } };
 *
 * // doAction — explicit error for a known failure condition
 * if (!data) return { status: 'error', result: { message: 'Missing Fitbit data' } };
 * ```
 */
type StepStatus = 'success' | 'stop' | 'error';


/**
 * The return type for every handler step function.
 *
 * Every `shouldActivate`, `selectAction`, and `doAction` function returns this
 * shape. The `result` field is passed as `previousResult` to the next step,
 * making it the primary mechanism for passing data through the pipeline within
 * a single handler execution.
 *
 * The generic parameter `T` lets authors type their step results precisely.
 * It defaults to `Record<string, unknown>` so existing handlers need no changes,
 * but authors who want typed pipelines can specify it.
 *
 * @typeParam T - The shape of the `result` payload. Defaults to
 *   `Record<string, unknown>`.
 *
 * @example
 * ```ts
 * // Untyped — fine for most handlers
 * const shouldActivate = async (user: JUser, event: JEvent): Promise<StepReturnResult> => {
 *   return { status: 'success', result: { decisionPointType: 'morning' } };
 * };
 *
 * // Typed — for authors who want compile-time safety across steps
 * type ShouldActivateResult = {
 *   decisionPointType: 'morning' | 'midday';
 *   dayOfWeekType: string;
 * };
 *
 * const shouldActivate = async (
 *   user: JUser,
 *   event: JEvent,
 * ): Promise<StepReturnResult<ShouldActivateResult>> => {
 *   return {
 *     status: 'success',
 *     result: { decisionPointType: 'morning', dayOfWeekType: 'weekday' },
 *   };
 * };
 *
 * // The next step receives prev.result typed as ShouldActivateResult
 * const selectAction = async (
 *   user: JUser,
 *   event: JEvent,
 *   prev: StepReturnResult<ShouldActivateResult>,
 * ): Promise<StepReturnResult> => {
 *   const { decisionPointType } = prev.result!;
 *   // ...
 * };
 * ```
 */
type StepReturnResult<T = Record<string, unknown>> = {
  /** The outcome of this step. Determines whether execution continues. */
  status: StepStatus;
  /**
   * The step's output data. Passed as `previousResult` to the next step.
   * Use this to carry computed values, selected actions, or fetched data
   * forward through the handler pipeline.
   */
  result?: T;
  /**
   * The error that caused this step to fail. Present when `status` is
   * `'error'`. The engine also sets this automatically when a step function
   * throws.
   */
  error?: unknown;
};


/**
 * Identifies whether a registered handler is a Task or a Decision Rule.
 * Stamped onto the handler object by the engine at registration time —
 * authors do not set this directly.
 */
enum HandlerType {
  DECISION_RULE = 'DECISION_RULE',
  TASK = 'TASK',
}


/**
 * The named steps of a Decision Rule execution.
 * Used internally by the engine for logging and result recording.
 */
enum DecisionRuleStep {
  SHOULD_ACTIVATE = 'shouldActivate',
  SELECT_ACTION = 'selectAction',
  DO_ACTION = 'doAction',
}

/**
 * The named steps of a Task execution.
 * Used internally by the engine for logging and result recording.
 */
enum TaskStep {
  SHOULD_ACTIVATE = 'shouldActivate',
  DO_ACTION = 'doAction',
}


/**
 * Fields shared by both {@link Task} and {@link DecisionRule}.
 *
 * Authors do not implement `BaseHandler` directly — use {@link TaskRegistration}
 * or {@link DecisionRuleRegistration} instead.
 */
type BaseHandler = {
  /** The unique name used to reference this handler in event registrations. */
  name: string;

  /**
   * Stamped by the engine at registration time. Do not set this in your
   * handler definition — use {@link TaskRegistration} or
   * {@link DecisionRuleRegistration} which omit this field.
   */
  type: HandlerType;

  /**
   * Called once before the handler runs for any users. Use this to reset
   * module-level accumulators (arrays, maps) that `doAction` will populate
   * during the user sweep.
   *
   * **Population sweep model:** the engine runs each handler across all users
   * before moving to the next handler. `beforeExecution` brackets the entire
   * user sweep for this handler — it is called once, not once per user.
   *
   * @param event - The event that triggered this handler sweep.
   *
   * @example
   * ```ts
   * let userUpdates: ParticipantUpdate[] = [];
   *
   * beforeExecution: async (event) => {
   *   userUpdates = []; // reset accumulator before the user sweep
   * }
   * ```
   */
  beforeExecution?: (event: JEvent) => Promise<void> | void;

  /**
   * Determines whether this handler should run for a given user and event.
   *
   * Return `{ status: 'success' }` to proceed to `doAction`.
   * Return `{ status: 'stop' }` to skip this user gracefully — no result
   * is recorded and no error is logged.
   *
   * The `result` field is passed as `previousResult` to `doAction`.
   *
   * @param user  - The user being evaluated.
   * @param event - The event that triggered this handler.
   *
   * @example
   * ```ts
   * shouldActivate: async (user, event) => {
   *   const [isActive] = checkForPhase(user, 'active');
   *   if (!isActive) return { status: 'stop', result: { reason: 'not in active phase' } };
   *
   *   const isCorrectTime = isTimeMatch(getEventMinutes(event), getWakeupMinutes(user));
   *   if (!isCorrectTime) return { status: 'stop', result: { reason: 'not the right time' } };
   *
   *   return { status: 'success', result: { phase: 'active' } };
   * }
   * ```
   */
  shouldActivate: (
    user: JUser,
    event: JEvent,
  ) => Promise<StepReturnResult> | StepReturnResult;

  /**
   * Executes the handler's action for a given user.
   *
   * Called only when `shouldActivate` returned `{ status: 'success' }`.
   * The `previousResult` argument carries the `result` from `shouldActivate`
   * (or `selectAction` for Decision Rules).
   *
   * **Accumulator pattern:** if you need to make bulk API calls after all
   * users have been processed, push to a module-level array here and flush
   * it in `afterExecution`.
   *
   * **User mutation:** you may write data directly onto `user` (e.g.
   * `user.attributes.customFields = { ...user.attributes.customFields, ...newData }`)
   * to make that data available to subsequent handlers in the pipeline for the
   * same user.
   *
   * @param user           - The user being acted on.
   * @param event          - The event that triggered this handler.
   * @param previousResult - The result from the preceding step.
   *
   * @example
   * ```ts
   * doAction: async (user, event, previousResult) => {
   *   const data = await fetchFitbitData(user);
   *
   *   // mutate user so downstream handlers see fresh data
   *   user.attributes.customFields = {
   *     ...user.attributes.customFields,
   *     RecentWearDays: data.wearDays,
   *   };
   *
   *   // accumulate for bulk flush in afterExecution
   *   userUpdates.push(buildUpdate(user, data));
   *
   *   return { status: 'success', result: { wearDays: data.wearDays } };
   * }
   * ```
   */
  doAction: (
    user: JUser,
    event: JEvent,
    previousResult: StepReturnResult,
  ) => Promise<StepReturnResult> | StepReturnResult;

  /**
   * Called once after the handler has run for all users. Use this to flush
   * accumulators populated during the user sweep — bulk API calls, batch
   * database writes, aggregate logging.
   *
   * **Population sweep model:** `afterExecution` is called once after the
   * entire user sweep completes, not once per user. This is the right place
   * for any operation that is more efficient in bulk than per-user.
   *
   * @param event - The event that triggered this handler sweep.
   *
   * @example
   * ```ts
   * afterExecution: async (event) => {
   *   if (userUpdates.length) {
   *     await bulkUpdateParticipants(userUpdates); // one API call for all users
   *   }
   *   await logger.writeHandlerResults(name);
   * }
   * ```
   */
  afterExecution?: (event: JEvent) => Promise<void> | void;
};


/**
 * A registered Task with its `type` field stamped by the engine.
 * Returned by the internal task registry — not used directly by authors.
 * Authors define handlers using {@link TaskRegistration}.
 */
type Task = BaseHandler;

/**
 * The shape a third-party developer authors when defining a Task.
 *
 * A Task is a handler that performs preparatory or side-effectful work across
 * all users before Decision Rules run. Common uses: fetching and caching sensor
 * data, resetting notification state, updating rolling averages, tracking wear
 * time.
 *
 * The `type` field is omitted here — the engine stamps it at registration time
 * via `registerTask`.
 *
 * **Population sweep model:** each Task runs across all users before the next
 * handler starts. A Task that writes data onto `user.attributes` makes that
 * data available to every subsequent handler in the same pipeline run for that
 * user.
 *
 * **Pipeline position:** Tasks typically run before Decision Rules that depend
 * on the data they produce. The order is determined by the array passed to
 * `registerEventHandlers`.
 *
 * @example
 * ```ts
 * const name = 'fitbit-updater';
 * let userUpdates: ParticipantUpdate[] = [];
 *
 * export const FitbitUpdaterTask: TaskRegistration = {
 *   name,
 *
 *   beforeExecution: async () => {
 *     userUpdates = [];
 *   },
 *
 *   shouldActivate: async (user, event) => {
 *     const [isActive] = checkForPhase(user, 'active');
 *     if (!isActive) return { status: 'stop', result: { reason: 'not active' } };
 *     return { status: 'success' };
 *   },
 *
 *   doAction: async (user, event, prev) => {
 *     const data = await retrieveAndProcessFitbitData(user, event);
 *     // write onto user so downstream handlers see fresh Fitbit data
 *     user.attributes.customFields = { ...user.attributes.customFields, ...data };
 *     userUpdates.push(buildUpdate(user, data));
 *     return { status: 'success', result: data };
 *   },
 *
 *   afterExecution: async () => {
 *     await bulkUpdateParticipants(userUpdates);
 *   },
 * };
 * ```
 */
type TaskRegistration = Omit<Task, 'type'>;


/**
 * A registered Decision Rule with its `type` field stamped by the engine.
 * Returned by the internal decision rule registry — not used directly by
 * authors. Authors define handlers using {@link DecisionRuleRegistration}.
 */
type DecisionRule = BaseHandler & {
  /**
   * Selects which action to take for a given user.
   *
   * Called only when `shouldActivate` returned `{ status: 'success' }`.
   * The `previousResult` argument carries the `result` from `shouldActivate`.
   *
   * Return `{ status: 'success' }` to proceed to `doAction` with the selected
   * action in `result`. Return `{ status: 'stop' }` to skip `doAction` for
   * this user gracefully — for example when a probabilistic roll determines no
   * message should be sent, or when no eligible message exists in the bank.
   *
   * The `result` field is passed as `previousResult` to `doAction`.
   *
   * @param user           - The user being evaluated.
   * @param event          - The triggering event.
   * @param previousResult - The result from `shouldActivate`.
   *
   * @example
   * ```ts
   * selectAction: async (user, event, prev) => {
   *   // probabilistic gate — skip some percentage of users
   *   if (Math.random() >= MESSAGE_LIKELIHOOD) {
   *     return { status: 'success', result: { action: 'NO_ACTION', reason: 'dice roll' } };
   *   }
   *
   *   const { messageId } = selectMessageForUser(user, prev.result.decisionPointType);
   *   if (!messageId) {
   *     return { status: 'success', result: { action: 'NO_ACTION', reason: 'empty bank' } };
   *   }
   *
   *   return { status: 'success', result: { action: 'SEND_MESSAGE', messageId } };
   * }
   * ```
   */
  selectAction: (
    user: JUser,
    event: JEvent,
    previousResult: StepReturnResult,
  ) => Promise<StepReturnResult> | StepReturnResult;
};

/**
 * The shape a third-party developer authors when defining a Decision Rule.
 *
 * A Decision Rule is the adaptive core of a JITAI pipeline. It answers three
 * questions in sequence for each user:
 *
 * 1. **Should we act on this user right now?** (`shouldActivate`)
 * 2. **What should we do?** (`selectAction`)
 * 3. **Do it.** (`doAction`)
 *
 * The `type` field is omitted here — the engine stamps it at registration time
 * via `registerDecisionRule`.
 *
 * **Pipeline position:** Decision Rules typically run after Tasks that prepare
 * the data they need. If a Decision Rule reads Fitbit data from
 * `user.attributes.customFields`, the Task that fetches and writes that data
 * must appear earlier in the same event's handler array.
 *
 * @example
 * ```ts
 * const name = 'walking-suggestions';
 * let messagedUsers: ParticipantUpdate[] = [];
 *
 * export const WalkingSuggestionDecisionRule: DecisionRuleRegistration = {
 *   name,
 *
 *   beforeExecution: async () => {
 *     messagedUsers = [];
 *   },
 *
 *   shouldActivate: async (user, event) => {
 *     const [isActive] = checkForPhase(user, 'active');
 *     if (!isActive) return { status: 'stop' };
 *
 *     const isCorrectTime = checkDecisionPoint(user, event);
 *     if (!isCorrectTime) return { status: 'stop', result: { reason: 'not a decision point' } };
 *
 *     return { status: 'success', result: { decisionPointType: 'morning' } };
 *   },
 *
 *   selectAction: async (user, event, prev) => {
 *     if (Math.random() >= MESSAGE_LIKELIHOOD) {
 *       return { status: 'success', result: { action: 'NO_ACTION' } };
 *     }
 *     const { messageId } = selectMessage(user, prev.result.decisionPointType);
 *     return { status: 'success', result: { action: 'SEND_MESSAGE', messageId } };
 *   },
 *
 *   doAction: async (user, event, prev) => {
 *     if (prev.result.action !== 'SEND_MESSAGE') {
 *       return { status: 'success', result: { sent: false } };
 *     }
 *     await sendNotification(user, prev.result.messageId);
 *     messagedUsers.push(buildUpdate(user, prev.result.messageId));
 *     return { status: 'success', result: { sent: true } };
 *   },
 *
 *   afterExecution: async () => {
 *     await bulkUpdateParticipants(messagedUsers);
 *   },
 * };
 * ```
 */
type DecisionRuleRegistration = Omit<DecisionRule, 'type'>;

// ---------------------------------------------------------------------------
// ExecuteStepReturn
// ---------------------------------------------------------------------------

/**
 * A timestamped wrapper around a {@link StepReturnResult}, created by the
 * engine after each step executes.
 *
 * These are collected into the `steps` array on {@link RecordResult} and
 * forwarded to result writers and the default persistence layer. Authors
 * do not create these directly — the engine produces them internally.
 *
 * @typeParam T - The shape of the step result payload.
 */
type ExecuteStepReturn<T = unknown> = {
  /** The name of the step that produced this result (e.g. `'shouldActivate'`). */
  step: string;
  /** The result returned by the step function. */
  result: StepReturnResult<T>;
  /** The wall-clock time at which the step began execution. */
  timestamp: Date;
};


/**
 * The result envelope passed to custom result writers after a handler
 * completes its full execution for a single user.
 *
 * Contains everything needed to reconstruct what happened: which handler ran,
 * which user it ran for, which event triggered it, and the outcome of each
 * step. This is the primary research audit record — one `RecordResult` is
 * produced per handler per user per event.
 *
 * Passed to the function registered via `configureTaskResultWriter` or
 * `configureDecisionRuleResultWriter`. If no custom writer is configured,
 * the engine persists it to the database via DataManager (DB-backed engine)
 * or logs it at DEBUG level (serverless engine).
 *
 * @example
 * ```ts
 * engine.configureDecisionRuleResultWriter(async (record) => {
 *   await myAnalyticsPipeline.ingest({
 *     participant: record.user.uniqueIdentifier,
 *     handler: record.name,
 *     event: record.event.eventType,
 *     timestamp: record.event.generatedTimestamp,
 *     activated: record.steps.some(
 *       s => s.step === 'shouldActivate' && s.result.status === 'success',
 *     ),
 *     steps: record.steps.map(s => ({ step: s.step, status: s.result.status })),
 *   });
 * });
 * ```
 */
type RecordResult = {
  /** The event that triggered this handler execution. */
  event: JEvent;
  /** The registered name of the handler that produced this result. */
  name: string;
  /** The ordered step results from this handler execution for this user. */
  steps: ExecuteStepReturn[];
  /** The user this handler ran for. */
  user: JUser;
};

/**
 * A custom result writer function registered via
 * `configureTaskResultWriter` or `configureDecisionRuleResultWriter`.
 *
 * Called once per handler per user after execution completes. Use this to
 * route intervention results to your own analytics pipeline, research
 * database, or logging service.
 *
 * The function may be async. If it throws, the engine logs the error and
 * falls back to the default persistence path — it does not propagate the
 * error to the caller.
 *
 * @example
 * ```ts
 * const writer: RecordResultFunction = async (record) => {
 *   await myDB.insertInterventionResult({
 *     participantId: record.user.uniqueIdentifier,
 *     handlerName: record.name,
 *     eventType: record.event.eventType,
 *     timestamp: record.event.generatedTimestamp,
 *   });
 * };
 *
 * engine.configureTaskResultWriter(writer);
 * engine.configureDecisionRuleResultWriter(writer);
 * ```
 */
type RecordResultFunction = (record: RecordResult) => Promise<void> | void;


export {
  HandlerType,
  DecisionRuleStep,
  TaskStep,
};

export type {
  StepStatus,
  StepReturnResult,
  BaseHandler,
  Task,
  TaskRegistration,
  DecisionRule,
  DecisionRuleRegistration,
  ExecuteStepReturn,
  RecordResult,
  RecordResultFunction,
};
