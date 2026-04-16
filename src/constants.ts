/**
 * MongoDB collection name for pending events awaiting processing.
 *
 * Events are inserted here by {@link publishEvent} and removed after
 * successful archiving by {@link processEventQueue}.
 */
const EVENT_QUEUE = 'event_queue';

/**
 * MongoDB collection name for processed events.
 *
 * After an event has been executed against all users it is moved here from
 * `event_queue`. Provides a persistent audit trail of every event the engine
 * has processed.
 */
const ARCHIVED_EVENTS = 'archived_events';

/**
 * Collection name for Decision Rule execution results.
 *
 * One document is written per Decision Rule per user per event when no custom
 * writer is configured via `JustInEngine.configureDecisionRuleResultWriter`.
 */
const DECISION_RULE_RESULTS = 'decision_rule_results';

/**
 * Collection name for Task execution results.
 *
 * One document is written per Task per user per event when no custom writer
 * is configured via `JustInEngine.configureTaskResultWriter`.
 */
const TASK_RESULTS = 'task_results';

export { EVENT_QUEUE, ARCHIVED_EVENTS, DECISION_RULE_RESULTS, TASK_RESULTS };
