/**
 * @just-in/engine
 *
 * The intervention execution layer for the Justin JITAI ecosystem.
 *
 * Provides two engine facades:
 *
 * - {@link JustInEngine} — DB-backed engine for long-running server processes.
 *   Requires `configureDB` from `@just-in/core` to be called before `init()`.
 *
 * - {@link JustInServerless} — in-memory engine for short-lived execution
 *   contexts (Cloud Run, Lambda, scheduled jobs). No database required.
 *
 * ## Typical DB-backed startup
 * ```ts
 * import { configureDB, DBType } from '@just-in/core';
 * import { JustInEngine } from '@just-in/engine';
 *
 * configureDB({ dbType: DBType.MONGO, uri: process.env.MONGO_URI });
 *
 * await JustInEngine.init();
 * await JustInEngine.startEngine();
 * ```
 *
 * ## Typical serverless invocation
 * ```ts
 * import { JustInServerless } from '@just-in/engine';
 *
 * export const runApp = async (cloudEvent) => {
 *   try {
 *     await JustInServerless.loadUsers(users);
 *     await JustInServerless.registerEventHandlers('ClockEvent', [
 *       FitbitUpdaterTask.name,
 *       WalkingSuggestionDecisionRule.name,
 *     ]);
 *     await JustInServerless.publishEvent(
 *       'ClockEvent',
 *       cloudEvent.publish_time,
 *       {},
 *       cloudEvent.message_id,
 *     );
 *   } finally {
 *     JustInServerless.reset();
 *   }
 * };
 * ```
 */

export { JustInEngine } from './engine';
export { JustInServerless } from './serverless';
export type { ServerlessUserInput, NamespacedProtectedAttributesInput } from './serverless';

export type { JEvent, IntervalTimerEventGeneratorOptions } from './event';

export type {
  TaskRegistration,
  DecisionRuleRegistration,
  StepReturnResult,
  StepStatus,
  ExecuteStepReturn,
  RecordResult,
  RecordResultFunction,
} from './handlers';
