import { createLogger } from '@just-in/core';
import type { JUser, NewUserRecord, ProtectedAttributesRecord } from '@just-in/core';
import { EventHandlerManager, executeEventForUsers } from '../event';
import type { JEvent } from '../event';
import { registerTask as _registerTask, _clearRegisteredTasks, registerDecisionRule as _registerDecisionRule, _clearRegisteredDecisionRules, __resetResultRecorderForTests,   _setDecisionRuleResultRecorder,
  _setTaskResultRecorder,
  setResultRecorderPersistenceEnabled, } from '../handlers';
import type { TaskRegistration, DecisionRuleRegistration, RecordResultFunction } from '../handlers';
import type { NamespacedProtectedAttributesInput, ServerlessUserInput} from "./types";

const Log = createLogger({
  context: { package: '@just-in/engine', component: 'justin-serverless' },
});

setResultRecorderPersistenceEnabled(false);


// Module-level state — reset between invocations via JustInServerless.reset()
let _users = new Map<string, JUser>();
let _userIdByUniqueIdentifier = new Map<string, string>();
let _protectedAttributes = new Map<string, Map<string, ProtectedAttributesRecord>>();
let _processedKeys = new Set<string>();

function _buildProtectedAttributesRecordId(
  uniqueIdentifier: string,
  namespace: string,
): string {
  return `${uniqueIdentifier}:${namespace}`;
}

/**
 * Loads users into the in-memory store for the current invocation.
 *
 * Accepts either fully persisted {@link JUser} objects or
 * {@link NewUserRecord} shapes from `@just-in/core`. Both may include an
 * optional `protectedAttributes` array.
 *
 * **Atomic replace:** each call completely replaces the previous user set.
 *
 * **`id` derivation:** for `NewUserRecord` inputs without an `id` field the
 * engine uses `uniqueIdentifier` as the `id`.
 *
 * **`attributes` shape:** the engine does not flatten `attributes`. A
 * `NewUserRecord` with `{ attributes: { demographics, customFields } }` is
 * stored as `{ id, uniqueIdentifier, attributes: { demographics, customFields } }`.
 * Handler authors access user data via `user.attributes.x`.
 *
 * **Uniqueness:** both `uniqueIdentifier` and the derived `id` must be unique
 * within the batch. Duplicates throw immediately — the entire load is aborted
 * and the previous user set is preserved.
 *
 * @param users - Array of user inputs.
 * @returns The normalised `JUser[]` loaded into memory.
 * @throws If `users` is not an array, any `uniqueIdentifier` is missing or
 *   empty, or any `uniqueIdentifier` / `id` is duplicated within the batch.
 *
 * @example
 * ```ts
 * const participants = await getAllParticipants();
 * const users = transformParticipants(participants); // → JUser[]
 * await JustInServerless.loadUsers(users);
 * ```
 */
async function loadUsers(users: ServerlessUserInput[]): Promise<JUser[]> {
  if (!Array.isArray(users)) {
    throw new Error('loadUsers: expects an array.');
  }

  const nextUsers = new Map<string, JUser>();
  const nextByUniqueIdentifier = new Map<string, string>();
  const nextProtectedAttributes = new Map<string, Map<string, ProtectedAttributesRecord>>();
  const normalized: JUser[] = [];

  for (const item of users) {
    const raw = item as Record<string, unknown>;

    const uniqueIdentifier =
      typeof raw['uniqueIdentifier'] === 'string' ? raw['uniqueIdentifier'].trim() : '';

    if (!uniqueIdentifier) {
      const msg = 'loadUsers: uniqueIdentifier is missing or empty.';
      Log.error(msg);
      throw new Error(msg);
    }

    if (nextByUniqueIdentifier.has(uniqueIdentifier)) {
      const msg = `loadUsers: duplicate uniqueIdentifier "${uniqueIdentifier}".`;
      Log.error(msg);
      throw new Error(msg);
    }

    const id =
      typeof raw['id'] === 'string' && raw['id'].trim() !== ''
        ? raw['id'].trim()
        : uniqueIdentifier;

    if (nextUsers.has(id)) {
      const msg = `loadUsers: duplicate id "${id}" (derived from uniqueIdentifier "${uniqueIdentifier}").`;
      Log.error(msg);
      throw new Error(msg);
    }

    // JUser has `id` and no `attributes` key.
    // NewUserRecord has `attributes` key — keep nested, never flatten.
    const isNewUserRecord = 'attributes' in raw;

    const normalizedUser: JUser = isNewUserRecord
      ? ({
        id,
        uniqueIdentifier,
        attributes: (raw['attributes'] as Record<string, unknown>) ?? {},
      } as JUser)
      : ({ ...raw, id, uniqueIdentifier } as JUser);

    nextUsers.set(id, normalizedUser);
    nextByUniqueIdentifier.set(uniqueIdentifier, id);
    normalized.push(normalizedUser);

    const incomingPA = raw['protectedAttributes'];
    if (Array.isArray(incomingPA)) {
      const byNamespace = new Map<string, ProtectedAttributesRecord>();

      for (const entry of incomingPA as NamespacedProtectedAttributesInput[]) {
        const namespace =
          typeof entry?.namespace === 'string' ? entry.namespace.trim() : '';

        if (!namespace) {
          const msg = `loadUsers: protected attribute namespace is missing for user "${uniqueIdentifier}".`;
          Log.error(msg);
          throw new Error(msg);
        }

        if (byNamespace.has(namespace)) {
          const msg = `loadUsers: duplicate namespace "${namespace}" for user "${uniqueIdentifier}".`;
          Log.error(msg);
          throw new Error(msg);
        }

        const payload: Record<string, unknown> =
          entry.protectedAttributes &&
          typeof entry.protectedAttributes === 'object' &&
          !Array.isArray(entry.protectedAttributes)
            ? (entry.protectedAttributes as Record<string, unknown>)
            : {};

        byNamespace.set(namespace, {
          id: _buildProtectedAttributesRecordId(uniqueIdentifier, namespace),
          uniqueIdentifier,
          namespace,
          protectedAttributes: payload,
        });
      }

      if (byNamespace.size > 0) {
        nextProtectedAttributes.set(uniqueIdentifier, byNamespace);
      }
    }
  }

  _users = nextUsers;
  _userIdByUniqueIdentifier = nextByUniqueIdentifier;
  _protectedAttributes = nextProtectedAttributes;

  Log.info(`Loaded ${nextUsers.size} users into memory.`);
  return normalized;
}

/** Returns all users currently loaded in memory. */
function getAllUsers(): JUser[] {
  return Array.from(_users.values());
}

/**
 * Returns a user by their `id`.
 *
 * For users loaded from `NewUserRecord` inputs the `id` equals their
 * `uniqueIdentifier`.
 *
 * @param userId - The user's `id` field.
 * @returns The user, or `null` if not found.
 */
function getUserById(userId: string): JUser | null {
  return _users.get(userId) ?? null;
}

/**
 * Returns a user by their `uniqueIdentifier`.
 *
 * @param uniqueIdentifier - The user's unique identifier.
 * @returns The user, or `null` if not found.
 */
function getUserByUniqueIdentifier(uniqueIdentifier: string): JUser | null {
  const userId = _userIdByUniqueIdentifier.get(uniqueIdentifier);
  return userId ? (_users.get(userId) ?? null) : null;
}

/**
 * Returns protected attribute records for a user filtered by namespace.
 *
 * Missing namespaces are silently omitted — requesting a namespace that was
 * not loaded does not throw.
 *
 * @param userId     - The user's `id` field.
 * @param namespaces - The namespaces to retrieve.
 * @returns Matching {@link ProtectedAttributesRecord} objects, or `[]`.
 *
 * @example
 * ```ts
 * doAction: async (user, event, prev) => {
 *   const [health] = JustInServerless.getProtectedAttributesByNamespace(user.id, ['health']);
 *   const steps = health?.protectedAttributes?.steps;
 * }
 * ```
 */
function getProtectedAttributesByNamespace(
  userId: string,
  namespaces: string[],
): ProtectedAttributesRecord[] {
  if (!userId || typeof userId !== 'string') return [];
  if (!Array.isArray(namespaces) || namespaces.length === 0) return [];

  const user = _users.get(userId);
  if (!user) return [];

  const byNamespace = _protectedAttributes.get(user.uniqueIdentifier);
  if (!byNamespace) return [];

  return namespaces
    .filter((ns): ns is string => typeof ns === 'string' && ns.trim().length > 0)
    .map((ns) => byNamespace.get(ns.trim()))
    .filter((r): r is ProtectedAttributesRecord => r !== undefined);
}

/**
 * Returns all protected attribute records for a user across every namespace.
 *
 * @param userId - The user's `id` field.
 * @returns All loaded {@link ProtectedAttributesRecord} objects, or `[]`.
 */
function getAllProtectedAttributesForUser(userId: string): ProtectedAttributesRecord[] {
  if (!userId || typeof userId !== 'string') return [];
  const user = _users.get(userId);
  if (!user) return [];
  const byNamespace = _protectedAttributes.get(user.uniqueIdentifier);
  return byNamespace ? Array.from(byNamespace.values()) : [];
}

/**
 * Registers a Task with the engine.
 *
 * @param task - The task definition. See {@link TaskRegistration}.
 */
function registerTask(task: TaskRegistration): void {
  _registerTask(task);
}

/**
 * Registers a Decision Rule with the engine.
 *
 * @param decisionRule - The decision rule definition. See {@link DecisionRuleRegistration}.
 */
function registerDecisionRule(decisionRule: DecisionRuleRegistration): void {
  _registerDecisionRule(decisionRule);
}

/**
 * Registers an ordered array of handler names for an event type.
 *
 * The order of `handlers` is the execution order. Tasks that write data onto
 * `user.attributes` must appear before Decision Rules that read it.
 *
 * @param eventType        - The event type name.
 * @param handlers         - Ordered handler names.
 * @param overwriteExisting - Replace an existing registration. Defaults to `false`.
 * @throws If `eventType` is already registered and `overwriteExisting` is `false`.
 */
async function registerEventHandlers(
  eventType: string,
  handlers: string[],
  overwriteExisting: boolean = false,
): Promise<void> {
  await EventHandlerManager.getInstance().registerEventHandlers(
    eventType,
    handlers,
    overwriteExisting,
  );
}

/**
 * Removes the handler registration for an event type.
 *
 * @param eventType - The event type to unregister.
 */
function unregisterEventHandlers(eventType: string): void {
  EventHandlerManager.getInstance().unregisterEventHandlers(eventType);
}

/**
 * Executes all handlers registered for `eventType` against all loaded users.
 *
 * **Synchronous execution:** unlike the DB-backed engine, `publishEvent`
 * executes the full handler pipeline inline. When this call resolves, every
 * handler has completed its full user sweep. There is no queue to drain.
 *
 * **Idempotency key:** cloud platforms can invoke the same function more than
 * once for a single trigger. Pass `idempotencyKey` (typically the platform's
 * message ID) to deduplicate within a single warm instance. If the same key
 * is seen again the call resolves immediately without executing any handlers.
 * This guard is in-memory only — it resets on `reset()`.
 *
 * @param eventType          - The registered event type to execute.
 * @param generatedTimestamp - The logical event timestamp. Handlers use this
 *   to compute user-local times and decision points.
 * @param eventDetails       - Optional payload forwarded to every handler as
 *   `event.eventDetails`.
 * @param idempotencyKey     - Optional deduplication key.
 * @throws If no handlers are registered for `eventType`.
 * @throws If no users have been loaded via `loadUsers`.
 *
 * @example
 * ```ts
 * await JustInServerless.publishEvent(
 *   'GoogleCloudClockEvent',
 *   cloudEvent.publish_time,
 *   { trigger: 'GCF Pub/Sub' },
 *   cloudEvent.message_id,
 * );
 * ```
 */
async function publishEvent(
  eventType: string,
  generatedTimestamp: Date,
  eventDetails?: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<void> {
  if (idempotencyKey) {
    if (_processedKeys.has(idempotencyKey)) {
      Log.warn(`Duplicate execution skipped for idempotency key: ${idempotencyKey}`);
      return;
    }
    _processedKeys.add(idempotencyKey);
  }

  const handlerManager = EventHandlerManager.getInstance();

  if (!handlerManager.hasHandlersForEventType(eventType)) {
    throw new Error(`publishEvent: no handlers registered for event type "${eventType}".`);
  }

  const users = Array.from(_users.values());
  if (users.length === 0) {
    throw new Error('publishEvent: no users loaded. Call loadUsers before publishEvent.');
  }

  const event: JEvent = {
    eventType,
    generatedTimestamp,
    eventDetails: eventDetails ?? {},
  };

  await executeEventForUsers(event, users, handlerManager);
}

/**
 * Registers a custom writer for Task results.
 *
 * **Replaces** the default path — when set, the INFO log fallback is never
 * reached for tasks. Use this to route task execution records to your own
 * analytics pipeline or database.
 *
 * If the writer throws, the engine logs a warning and falls back to the INFO
 * log.
 *
 * @param writer - The result writer function. See {@link RecordResultFunction}.
 */
function configureTaskResultWriter(writer: RecordResultFunction): void {
  _setTaskResultRecorder(writer);
}

/**
 * Registers a custom writer for Decision Rule results.
 *
 * **Replaces** the default INFO log path. A single decision rule writer also
 * handles Task results when no task writer is configured — register only this
 * writer if you want a single sink for all handler results.
 *
 * If the writer throws, the engine logs a warning and falls back to the INFO
 * log.
 *
 * @param writer - The result writer function. See {@link RecordResultFunction}.
 */
function configureDecisionRuleResultWriter(writer: RecordResultFunction): void {
  _setDecisionRuleResultRecorder(writer);
}

/**
 * Resets all engine state for the current invocation.
 *
 * Clears: in-memory users, protected attributes, processed idempotency keys,
 * registered event handlers, tasks, and decision rules.
 *
 * **Call this in your `finally` block** at the end of every invocation.
 * Failing to reset between warm-instance executions can cause stale users,
 * duplicate idempotency key hits, or handler registration errors.
 *
 * @example
 * ```ts
 * try {
 *   await JustInServerless.loadUsers(users);
 *   await JustInServerless.publishEvent(eventType, eventTime, details, key);
 * } catch (error) {
 *   logger.warn('Fatal error:', error);
 *   throw error;
 * } finally {
 *   JustInServerless.reset();
 *   await myLogger.flush();
 * }
 * ```
 */
function reset(): void {
  _users.clear();
  _userIdByUniqueIdentifier.clear();
  _protectedAttributes.clear();
  _processedKeys.clear();
  EventHandlerManager.getInstance().clearEventHandlers();
  _clearRegisteredTasks();
  _clearRegisteredDecisionRules();
  __resetResultRecorderForTests();
  // Re-apply — reset clears persistence flag, serverless always disables it.
  setResultRecorderPersistenceEnabled(false);
  Log.debug('JustInServerless reset.');
}

/**
 * The serverless engine.
 *
 * Designed for short-lived execution contexts — Cloud Run functions, AWS
 * Lambda, scheduled jobs — where there is no persistent database connection.
 * Users are loaded into memory at the start of each invocation and discarded
 * when `reset` is called. Events are executed immediately with no queue.
 *
 * No `configureDB` or `init()` call is needed.
 *
 * ## Typical invocation pattern
 *
 * ```ts
 * import { JustInServerless } from '@just-in/engine';
 *
 * export const runApp = async (cloudEvent) => {
 *   try {
 *     const users = await getAllParticipants();
 *     await JustInServerless.loadUsers(transformParticipants(users));
 *
 *     JustInServerless.registerTask(FitbitUpdaterTask);
 *     JustInServerless.registerDecisionRule(WalkingSuggestionDecisionRule);
 *
 *     await JustInServerless.registerEventHandlers('ClockEvent', [
 *       FitbitUpdaterTask.name,
 *       WalkingSuggestionDecisionRule.name,
 *     ]);
 *
 *     await JustInServerless.publishEvent(
 *       'ClockEvent',
 *       cloudEvent.publish_time,
 *       { trigger: 'GCF Pub/Sub' },
 *       cloudEvent.message_id,
 *     );
 *   } finally {
 *     JustInServerless.reset();
 *   }
 * };
 * ```
 */
const JustInServerless = {
  loadUsers,
  getAllUsers,
  getUserById,
  getUserByUniqueIdentifier,
  getProtectedAttributesByNamespace,
  getAllProtectedAttributesForUser,
  registerTask,
  registerDecisionRule,
  registerEventHandlers,
  unregisterEventHandlers,
  publishEvent,
  configureTaskResultWriter,
  configureDecisionRuleResultWriter,
  reset,
};

/**
 * Resets all serverless engine module-level state.
 *
 * @internal — exported for use in `@just-in/engine/testing` only.
 */
function _resetServerless(): void {
  reset();
}

export { JustInServerless, _resetServerless };
